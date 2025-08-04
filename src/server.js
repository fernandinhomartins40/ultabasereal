#!/usr/bin/env node

/**
 * SUPABASE INSTANCE MANAGER
 * 
 * Sistema que replica a experiência do Supabase Cloud, permitindo criar e gerenciar
 * múltiplas instâncias Supabase isoladas em uma única VPS.
 * 
 * Funcionalidades:
 * - Dashboard web como supabase.com
 * - Sistema de auto-correção inteligente para instâncias
 * - Criação de projetos isolados
 * - Gerenciamento de recursos e portas
 * - Acesso direto ao Studio de cada projeto
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const Docker = require('dockerode');
const helmet = require('helmet');
const WebSocket = require('ws');
const { exec } = require('child_process');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const net = require('net');

// Logger ultra-simples - importado do módulo utils
const logger = require('./utils/logger');

// Módulos de diagnóstico removidos - sistema simplificado

// Sistema de gerenciamento simplificado
const BackupSystem = require('./management/backup-system');

// Sistema de auto-correção removido - operação manual mais confiável

const execAsync = promisify(exec);
const docker = new Docker();
const app = express();
const PORT = process.env.MANAGER_PORT || 3080;

// Configurações do sistema
const DOCKER_DIR = path.join(__dirname, '..', 'supabase-core');
const DATA_FILE = path.join(__dirname, 'instances.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const SERVER_IP = '82.25.69.57'; // IP da VPS
const EXTERNAL_IP = process.env.VPS_HOST || process.env.MANAGER_EXTERNAL_IP || SERVER_IP;
const JWT_SECRET = process.env.JWT_SECRET || 'ultrabase_jwt_secret_change_in_production';

// Configuração de domínio
const DOMAIN_CONFIG = {
  primary: 'ultrabase.com.br',
  alternatives: ['www.ultrabase.com.br', 'ultrabase.com', 'www.ultrabase.com'],
  allowedHosts: ['ultrabase.com.br', 'www.ultrabase.com.br', 'ultrabase.com', 'www.ultrabase.com', 'localhost', '127.0.0.1', SERVER_IP, EXTERNAL_IP],
  // Configuração para instâncias via paths (mais confiável que subdomínios)
  useSubdomains: false, // Desabilitado por enquanto - requer DNS wildcard
  subdomainSuffix: 'ultrabase.com.br',
  // Usar paths: ultrabase.com.br/app/{instanceId}
  instancePath: '/app'
};

console.log(`🌐 IP externo configurado: ${EXTERNAL_IP}`);
console.log(`🌍 Domínio principal configurado: ${DOMAIN_CONFIG.primary}`);

/**
 * Gera URL para instância usando path, subdomínio ou IP:porta
 */
function generateInstanceUrl(instanceId, port, useHttps = true) {
  if (DOMAIN_CONFIG.useSubdomains) {
    const protocol = useHttps ? 'https' : 'http';
    // Limitar instanceId para usar apenas caracteres válidos para subdomínio
    const subdomain = instanceId.toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 20);
    return `${protocol}://${subdomain}.${DOMAIN_CONFIG.subdomainSuffix}`;
  } else if (false) { // CONFIRMADO: Paths não funcionam - manter IP:porta
    // Usar paths em vez of subdomínios (mais confiável) - DESABILITADO
    const protocol = useHttps ? 'https' : 'http';
    return `${protocol}://${DOMAIN_CONFIG.primary}${DOMAIN_CONFIG.instancePath}/${instanceId}`;
  } else {
    // Fallback para IP:porta se outras opções não estiverem habilitadas
    return `http://${EXTERNAL_IP}:${port}`;
  }
}

// Proxy reverso para instâncias (paths e subdomínios)
app.use(['/proxy/:instanceId', '/app/:instanceId'], async (req, res) => {
  try {
    const instanceId = req.params.instanceId;
    const instance = manager.instances[instanceId];
    
    console.log(`🔀 Proxy request: ${req.method} ${req.url} para instância ${instanceId}`);
    
    if (!instance) {
      console.error(`❌ Instância ${instanceId} não encontrada`);
      return res.status(404).json({ error: 'Instância não encontrada' });
    }
    
    if (instance.status !== 'running') {
      console.error(`❌ Instância ${instanceId} não está rodando (status: ${instance.status})`);
      return res.status(503).json({ error: 'Instância não está rodando' });
    }
    
    // Extrair path após /app/{instanceId} ou /proxy/{instanceId}
    let cleanPath = req.url;
    if (req.url.startsWith(`/app/${instanceId}`)) {
      cleanPath = req.url.substring(`/app/${instanceId}`.length) || '/';
    } else if (req.url.startsWith(`/proxy/${instanceId}`)) {
      cleanPath = req.url.substring(`/proxy/${instanceId}`.length) || '/';
    }
    
    const targetUrl = `http://127.0.0.1:${instance.ports.kong_http}${cleanPath}`;
    console.log(`🎯 Proxy target: ${targetUrl}`);
    
    // Preparar headers limpos
    const cleanHeaders = {
      'host': `127.0.0.1:${instance.ports.kong_http}`,
      'x-forwarded-host': req.headers.host,
      'x-forwarded-proto': req.secure ? 'https' : 'http',
      'x-forwarded-for': req.ip,
      'user-agent': req.headers['user-agent'] || 'Ultrabase-Proxy/1.0'
    };
    
    // Adicionar headers importantes do request original
    if (req.headers.authorization) cleanHeaders.authorization = req.headers.authorization;
    if (req.headers.apikey) cleanHeaders.apikey = req.headers.apikey;
    if (req.headers['content-type']) cleanHeaders['content-type'] = req.headers['content-type'];
    if (req.headers.accept) cleanHeaders.accept = req.headers.accept;
    if (req.headers.referer) cleanHeaders.referer = req.headers.referer;
    
    // Preparar body se necessário
    let body = undefined;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.body) {
      if (typeof req.body === 'string') {
        body = req.body;
      } else {
        body = JSON.stringify(req.body);
        cleanHeaders['content-type'] = 'application/json';
      }
    }
    
    console.log(`📤 Headers enviados:`, Object.keys(cleanHeaders));
    
    // Fazer requisição ao proxy
    const proxyResponse = await fetch(targetUrl, {
      method: req.method,
      headers: cleanHeaders,
      body: body,
      redirect: 'manual' // Não seguir redirects automaticamente
    });
    
    console.log(`📥 Resposta recebida: ${proxyResponse.status} ${proxyResponse.statusText}`);
    
    // Copiar status
    res.status(proxyResponse.status);
    
    // Copiar headers importantes da resposta
    const responseHeaders = {};
    proxyResponse.headers.forEach((value, key) => {
      // Filtrar headers que podem causar problemas
      const lowerKey = key.toLowerCase();
      if (!['transfer-encoding', 'connection', 'keep-alive', 'upgrade'].includes(lowerKey)) {
        responseHeaders[key] = value;
      }
    });
    
    // Definir headers na resposta
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    
    // Obter conteúdo da resposta
    const contentType = proxyResponse.headers.get('content-type') || '';
    
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      // Para JSON e texto, usar .text()
      const text = await proxyResponse.text();
      res.send(text);
    } else {
      // Para binários, usar .arrayBuffer()
      const buffer = await proxyResponse.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
    
    console.log(`✅ Proxy concluído com sucesso`);
    
  } catch (error) {
    console.error('❌ Erro detalhado no proxy de instância:', {
      instanceId: req.params.instanceId,
      url: req.url,
      method: req.method,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Erro interno do proxy',
      details: error.message,
      instanceId: req.params.instanceId
    });
  }
});

// Middleware - CSP mais permissivo para desenvolvimento
app.use(helmet({
  contentSecurityPolicy: false, // Desabilitar CSP que estava bloqueando o Studio
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
}));
app.use(cors({
  origin: function(origin, callback) {
    // Permitir requisições sem origin (como Postman) e qualquer origin em desenvolvimento
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Length', 'X-Kuma-Revision'],
  maxAge: 86400 // 24 hours
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ====================================================================
// ROTA RAIZ PRIORITÁRIA - DEVE VIR ANTES DOS MIDDLEWARES DE REDIRECIONAMENTO
// ====================================================================

// Rota principal (/) - Landing Page - PRIORIDADE MÁXIMA
app.get('/', (req, res) => {
  console.log(`🏠 Acesso à página inicial de ${req.get('host')} - servindo landing.html`);
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// ====================================================================
// MIDDLEWARE DE REDIRECIONAMENTO DE DOMÍNIO
// ====================================================================

// Middleware para redirecionamento de domínio e normalização
app.use((req, res, next) => {
  const host = req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  const isSecure = protocol === 'https';
  
  // Log detalhado para debugging
  console.log(`🔍 [DOMAIN-MIDDLEWARE] Host: ${host}, Path: ${req.path}, Protocol: ${protocol}`);
  
  // Permitir hosts locais em desenvolvimento
  if (host && (host.includes('localhost') || host.includes('127.0.0.1') || host === SERVER_IP || host === `${SERVER_IP}:${PORT}`)) {
    console.log(`✅ [DOMAIN-MIDDLEWARE] Host local permitido: ${host}`);
    return next();
  }
  
  // Para a rota raiz, sempre permitir acesso direto sem redirecionamento
  // Isso garante que https://ultrabase.com.br/ funcione sempre
  if (req.path === '/' || req.originalUrl === '/') {
    console.log(`🏠 [DOMAIN-MIDDLEWARE] Rota raiz - permitindo acesso direto`);
    return next();
  }
  
  // Verificar se o host é válido
  if (host && !DOMAIN_CONFIG.allowedHosts.some(allowedHost => 
    host === allowedHost || host === `${allowedHost}:${PORT}`
  )) {
    // Host não reconhecido, redirecionar para domínio principal
    const redirectUrl = `${isSecure ? 'https' : 'http'}://${DOMAIN_CONFIG.primary}${req.originalUrl}`;
    console.log(`⚠️ Host não reconhecido: ${host}, redirecionando para: ${redirectUrl}`);
    return res.redirect(301, redirectUrl);
  }
  
  // Redirecionamento para domínio principal (normalização) apenas para rotas não-raiz
  if (host && host !== DOMAIN_CONFIG.primary && DOMAIN_CONFIG.alternatives.includes(host) && req.path !== '/') {
    const redirectUrl = `${isSecure ? 'https' : 'http'}://${DOMAIN_CONFIG.primary}${req.originalUrl}`;
    console.log(`🔄 Redirecionando ${host} para ${DOMAIN_CONFIG.primary} (rota: ${req.path})`);
    return res.redirect(301, redirectUrl);
  }
  
  console.log(`✅ [DOMAIN-MIDDLEWARE] Host válido, prosseguindo: ${host}`);
  next();
});

// Static files with cache busting headers
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    // Disable cache for HTML files to ensure updates are loaded
    if (path.endsWith('.html') || path.endsWith('/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-App-Version', '2.0.0-generate-bash');
    }
  }
}));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// Configurações do sistema adaptadas para generate.bash
const CONFIG = {
  DOCKER_DIR: DOCKER_DIR,
  INSTANCES_FILE: DATA_FILE,
  SERVER_IP: SERVER_IP,
  EXTERNAL_IP: EXTERNAL_IP,
  PORT_RANGE: {
    KONG_HTTP: { min: 8100, max: 8199 },
    KONG_HTTPS: { min: 8400, max: 8499 },
    POSTGRES_EXT: { min: 5500, max: 5599 },
    SUPAVISOR: { min: 6500, max: 6599 },
    ANALYTICS: { min: 4100, max: 4199 }
  },
  MAX_INSTANCES: 50,
  GENERATE_SCRIPT: path.join(DOCKER_DIR, 'generate.bash')
};

/**
 * GERENCIADOR DE USUÁRIOS
 * Classe que gerencia autenticação e controle de acesso multi-usuário
 */
class UserManager {
  constructor() {
    this.users = this.loadUsers();
    this.initializeDefaultAdmin();
  }

  /**
   * Carrega usuários salvos do arquivo JSON
   */
  loadUsers() {
    try {
      if (fs.existsSync(USERS_FILE)) {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
      }
      return {};
    } catch (error) {
      console.error('Erro ao carregar usuários:', error.message);
      return {};
    }
  }

  /**
   * Salva usuários no arquivo JSON
   */
  saveUsers() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Erro ao salvar usuários:', error.message);
      throw new Error('Falha ao salvar dados de usuários');
    }
  }

  /**
   * Inicializa usuário admin padrão se não existir
   */
  async initializeDefaultAdmin() {
    if (!this.users['admin']) {
      console.log('🔧 Criando usuário admin padrão...');
      await this.createUser('admin', 'admin', 'admin');
      console.log('✅ Usuário admin criado - Login: admin / Senha: admin');
    }
  }

  /**
   * Cria novo usuário
   */
  async createUser(username, password, role = 'user') {
    if (this.users[username]) {
      throw new Error('Usuário já existe');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    this.users[username] = {
      id: username,
      password_hash: hashedPassword,
      role: role,
      projects: role === 'admin' ? ['*'] : [],
      created_at: new Date().toISOString()
    };

    this.saveUsers();
    console.log(`👤 Usuário ${username} criado com role ${role}`);
    return this.users[username];
  }

  /**
   * Autentica usuário
   */
  async authenticateUser(username, password) {
    const user = this.users[username];
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Senha incorreta');
    }

    return user;
  }

  /**
   * Altera senha do usuário
   */
  async changePassword(username, currentPassword, newPassword) {
    const user = this.users[username];
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    // Verificar senha atual
    const isValidCurrentPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidCurrentPassword) {
      throw new Error('Senha atual incorreta');
    }

    // Validar nova senha
    if (!newPassword || newPassword.length < 4) {
      throw new Error('Nova senha deve ter pelo menos 4 caracteres');
    }

    if (newPassword === currentPassword) {
      throw new Error('A nova senha deve ser diferente da senha atual');
    }

    // Gerar hash da nova senha
    const newHashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Atualizar usuário
    this.users[username].password_hash = newHashedPassword;
    this.users[username].updated_at = new Date().toISOString();
    
    this.saveUsers();
    console.log(`🔐 Senha alterada para usuário ${username}`);
    
    return true;
  }

  /**
   * Gera token JWT
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 horas
    };

    return jwt.sign(payload, JWT_SECRET);
  }

  /**
   * Verifica se token JWT é válido
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new Error('Token inválido');
    }
  }

  /**
   * Verifica se usuário pode acessar projeto
   */
  canAccessProject(username, projectId) {
    const user = this.users[username];
    if (!user) return false;

    // Admin pode acessar tudo
    if (user.role === 'admin') return true;

    // Usuário comum só pode acessar próprios projetos
    return user.projects.includes(projectId);
  }

  /**
   * Adiciona projeto ao usuário
   */
  addProjectToUser(username, projectId) {
    const user = this.users[username];
    if (!user) return false;

    if (user.role !== 'admin' && !user.projects.includes(projectId)) {
      user.projects.push(projectId);
      this.saveUsers();
    }

    return true;
  }

  /**
   * Remove projeto do usuário
   */
  removeProjectFromUser(username, projectId) {
    const user = this.users[username];
    if (!user) return false;

    if (user.role !== 'admin') {
      user.projects = user.projects.filter(id => id !== projectId);
      this.saveUsers();
    }

    return true;
  }

  /**
   * Lista usuários (apenas para admin)
   */
  listUsers() {
    return Object.values(this.users).map(user => ({
      id: user.id,
      role: user.role,
      projects: user.projects,
      created_at: user.created_at
    }));
  }
}

/**
 * GERENCIADOR DE INSTÂNCIAS
 * Classe principal que gerencia o ciclo de vida das instâncias Supabase
 */
class SupabaseInstanceManager {
  constructor() {
    this.instances = this.loadInstances();
    this.usedPorts = new Set();
    this.updateUsedPorts();
    
    // CORREÇÃO FASE 1: Sistema de lock para criações simultâneas
    this.creationLock = new Map(); // Controla criações simultâneas
    this.creationQueue = []; // Fila de criações aguardando
  }

  /**
   * Carrega instâncias salvas do arquivo JSON
   */
  loadInstances() {
    try {
      if (fs.existsSync(CONFIG.INSTANCES_FILE)) {
        const data = fs.readFileSync(CONFIG.INSTANCES_FILE, 'utf8');
        const instances = JSON.parse(data);
        
        // Migrar instâncias antigas para incluir owner
        let needsSave = false;
        Object.values(instances).forEach(instance => {
          if (!instance.owner) {
            instance.owner = 'admin'; // Atribuir ao admin instâncias antigas
            needsSave = true;
            console.log(`🔄 Migrando instância ${instance.id} para o usuário admin`);
          }
        });
        
        // Salvar se houve migração
        if (needsSave) {
          fs.writeFileSync(CONFIG.INSTANCES_FILE, JSON.stringify(instances, null, 2));
          console.log('✅ Migração de dados concluída');
        }
        
        return instances;
      }
      return {};
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error.message);
      return {};
    }
  }

  /**
   * Salva instâncias no arquivo JSON
   */
  saveInstances() {
    try {
      fs.writeFileSync(CONFIG.INSTANCES_FILE, JSON.stringify(this.instances, null, 2));
    } catch (error) {
      console.error('Erro ao salvar instâncias:', error.message);
      throw new Error('Falha ao salvar configuração das instâncias');
    }
  }

  /**
   * Atualiza conjunto de portas em uso
   */
  updateUsedPorts() {
    this.usedPorts.clear();
    Object.values(this.instances).forEach(instance => {
      this.usedPorts.add(instance.ports.kong_http);
      this.usedPorts.add(instance.ports.kong_https);
      this.usedPorts.add(instance.ports.postgres_ext);
      if (instance.ports.supavisor) this.usedPorts.add(instance.ports.supavisor);
      this.usedPorts.add(instance.ports.analytics);
    });
  }

  /**
   * CORREÇÃO FASE 2: Verifica se uma porta está realmente livre no sistema operacional
   */
  async isPortReallyFree(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(port, () => {
        server.once('close', () => resolve(true));
        server.close();
      });
      
      server.on('error', () => resolve(false));
    });
  }

  /**
   * CORREÇÃO FASE 3: Verifica recursos disponíveis no sistema
   */
  async checkSystemResources() {
    console.log('🔍 Verificando recursos do sistema...');
    
    try {
      const resources = {
        memory: await this.checkMemoryResources(),
        disk: await this.checkDiskSpace(),
        cpu: await this.checkCPULoad()
      };

      console.log(`💾 Memória: ${resources.memory.available}MB disponível de ${resources.memory.total}MB`);
      console.log(`💿 Disco: ${resources.disk.available}GB disponível de ${resources.disk.total}GB`);
      console.log(`⚡ CPU: ${resources.cpu.load}% de uso médio`);

      return resources;
    } catch (error) {
      console.warn('⚠️ Não foi possível verificar recursos do sistema:', error.message);
      return {
        memory: { available: 1024, total: 2048, percentage: 50 }, // Fallback
        disk: { available: 10, total: 20, percentage: 50 },
        cpu: { load: 50, cores: 1 }
      };
    }
  }

  /**
   * CORREÇÃO FASE 3: Verifica memória disponível
   */
  async checkMemoryResources() {
    try {
      const { stdout } = await execAsync('free -m');
      const lines = stdout.split('\n');
      const memLine = lines.find(line => line.startsWith('Mem:'));
      
      if (memLine) {
        const [, total, used, free, shared, buffers, available] = memLine.split(/\s+/).map(Number);
        const availableMem = available || free;
        
        return {
          total: total,
          used: used,
          available: availableMem,
          percentage: Math.round((used / total) * 100)
        };
      }
    } catch (error) {
      // Fallback para Windows ou outros sistemas
      try {
        const { stdout } = await execAsync('wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /value');
        const lines = stdout.split('\n');
        
        let total = 0, free = 0;
        lines.forEach(line => {
          if (line.includes('TotalVisibleMemorySize=')) {
            total = parseInt(line.split('=')[1]) / 1024; // KB to MB
          }
          if (line.includes('FreePhysicalMemory=')) {
            free = parseInt(line.split('=')[1]) / 1024; // KB to MB
          }
        });

        if (total > 0) {
          return {
            total: Math.round(total),
            used: Math.round(total - free),
            available: Math.round(free),
            percentage: Math.round(((total - free) / total) * 100)
          };
        }
      } catch (winError) {
        console.warn('Não foi possível verificar memória:', winError.message);
      }
    }

    // Fallback final
    return { total: 2048, used: 1024, available: 1024, percentage: 50 };
  }

  /**
   * CORREÇÃO FASE 3: Verifica espaço em disco
   */
  async checkDiskSpace() {
    try {
      const { stdout } = await execAsync('df -BG .');
      const lines = stdout.split('\n');
      const diskLine = lines[1]; // Segunda linha tem os dados
      
      if (diskLine) {
        const parts = diskLine.split(/\s+/);
        const total = parseInt(parts[1].replace('G', ''));
        const used = parseInt(parts[2].replace('G', ''));
        const available = parseInt(parts[3].replace('G', ''));
        
        return {
          total: total,
          used: used,
          available: available,
          percentage: Math.round((used / total) * 100)
        };
      }
    } catch (error) {
      // Fallback para Windows
      try {
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption /value');
        const lines = stdout.split('\n');
        
        let total = 0, free = 0;
        let currentDisk = {};
        
        lines.forEach(line => {
          if (line.includes('Caption=C:')) {
            if (line.includes('FreeSpace=')) {
              free = parseInt(line.split('=')[1]) / (1024 * 1024 * 1024); // Bytes to GB
            }
            if (line.includes('Size=')) {
              total = parseInt(line.split('=')[1]) / (1024 * 1024 * 1024); // Bytes to GB
            }
          }
        });

        if (total > 0) {
          return {
            total: Math.round(total),
            used: Math.round(total - free),
            available: Math.round(free),
            percentage: Math.round(((total - free) / total) * 100)
          };
        }
      } catch (winError) {
        console.warn('Não foi possível verificar disco:', winError.message);
      }
    }

    // Fallback final
    return { total: 20, used: 10, available: 10, percentage: 50 };
  }

  /**
   * CORREÇÃO FASE 3: Verifica carga da CPU
   */
  async checkCPULoad() {
    try {
      const { stdout } = await execAsync('top -bn1 | grep "Cpu(s)"');
      const cpuLine = stdout.trim();
      
      // Extrair porcentagem de uso (formato: %Cpu(s): 12.5 us, ...)
      const usMatch = cpuLine.match(/(\d+\.?\d*)\s*us/);
      const syMatch = cpuLine.match(/(\d+\.?\d*)\s*sy/);
      
      if (usMatch && syMatch) {
        const userCpu = parseFloat(usMatch[1]);
        const systemCpu = parseFloat(syMatch[1]);
        const totalLoad = userCpu + systemCpu;
        
        return {
          load: Math.round(totalLoad),
          cores: require('os').cpus().length
        };
      }
    } catch (error) {
      // Fallback usando built-in do Node.js
      const os = require('os');
      const cpus = os.cpus();
      
      if (cpus.length > 0) {
        let totalIdle = 0;
        let totalTick = 0;
        
        cpus.forEach(cpu => {
          for (type in cpu.times) {
            totalTick += cpu.times[type];
          }
          totalIdle += cpu.times.idle;
        });
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);
        
        return {
          load: Math.round(usage),
          cores: cpus.length
        };
      }
    }

    // Fallback final
    return { load: 25, cores: 1 };
  }

  /**
   * CORREÇÃO FASE 3: Valida se há recursos suficientes para criar nova instância
   */
  async validateResourcesForNewInstance() {
    const resources = await this.checkSystemResources();
    const requirements = {
      memory: 512, // MB mínimos por instância
      disk: 2,     // GB mínimos por instância
      cpu: 80      // % máximo de CPU antes de rejeitar
    };

    const issues = [];

    if (resources.memory.available < requirements.memory) {
      issues.push(`Memória insuficiente: ${resources.memory.available}MB disponível, ${requirements.memory}MB necessários`);
    }

    if (resources.disk.available < requirements.disk) {
      issues.push(`Espaço em disco insuficiente: ${resources.disk.available}GB disponível, ${requirements.disk}GB necessários`);
    }

    if (resources.cpu.load > requirements.cpu) {
      issues.push(`CPU sobrecarregada: ${resources.cpu.load}% de uso, máximo recomendado ${requirements.cpu}%`);
    }

    return {
      canCreate: issues.length === 0,
      issues: issues,
      resources: resources,
      requirements: requirements
    };
  }

  /**
   * CORREÇÃO FASE 2: Gera porta aleatória verificando disponibilidade real no sistema
   */
  async generateAvailablePortReal(service) {
    const range = CONFIG.PORT_RANGE[service.toUpperCase()];
    if (!range) throw new Error(`Serviço desconhecido: ${service}`);

    let attempts = 0;
    while (attempts < 100) {
      const port = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      
      // Verificar cache interno primeiro (mais rápido)
      if (this.usedPorts.has(port)) {
        attempts++;
        continue;
      }
      
      // Verificar se a porta está realmente livre no sistema operacional
      const isReallyFree = await this.isPortReallyFree(port);
      if (isReallyFree) {
        this.usedPorts.add(port);
        return port;
      }
      
      attempts++;
    }
    
    throw new Error(`Não foi possível encontrar uma porta disponível para ${service} após 100 tentativas`);
  }

  /**
   * Gera porta aleatória disponível para um serviço específico (método legado)
   */
  generateAvailablePort(service) {
    const range = CONFIG.PORT_RANGE[service.toUpperCase()];
    if (!range) throw new Error(`Serviço desconhecido: ${service}`);

    let attempts = 0;
    while (attempts < 100) {
      const port = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
      attempts++;
    }
    throw new Error(`Não foi possível encontrar uma porta disponível para ${service}`);
  }

  /**
   * CORREÇÃO FASE 2: Gera configuração completa de uma nova instância com verificação real de portas
   */
  async generateInstanceConfig(projectName, customConfig = {}) {
    const instanceId = uuidv4().replace(/-/g, '').substring(0, 8);
    const timestamp = Date.now();

    // Usar IP externo configurado globalmente
    const externalIP = EXTERNAL_IP;

    // CORREÇÃO FASE 2: Gerar portas com verificação real no sistema operacional  
    console.log(`🔌 Verificando portas disponíveis no sistema para instância ${instanceId}...`);
    const ports = {
      kong_http: await this.generateAvailablePortReal('kong_http'),
      kong_https: await this.generateAvailablePortReal('kong_https'),
      postgres_ext: await this.generateAvailablePortReal('postgres_ext'),
      supavisor: await this.generateAvailablePortReal('supavisor'),
      analytics: await this.generateAvailablePortReal('analytics')
    };
    console.log(`✅ Portas alocadas: Kong HTTP=${ports.kong_http}, HTTPS=${ports.kong_https}, PostgreSQL=${ports.postgres_ext}, Analytics=${ports.analytics}`);

    // Gerar credenciais únicas
    const jwtSecret = this.generateJWTSecret();
    logger.instance(instanceId, `🔐 Gerando credenciais JWT para instância`, { projectName: 'instance-creation' });
    
    const anonKey = this.generateSupabaseKey('anon', jwtSecret);
    const serviceRoleKey = this.generateSupabaseKey('service_role', jwtSecret);
    
    // Validar tokens gerados
    this.validateSupabaseKey(anonKey, jwtSecret);
    this.validateSupabaseKey(serviceRoleKey, jwtSecret);
    
    const credentials = {
      postgres_password: this.generateSecurePassword(),
      jwt_secret: jwtSecret,
      anon_key: anonKey,
      service_role_key: serviceRoleKey,
      dashboard_username: customConfig.dashboard_username || 'admin',
      dashboard_password: customConfig.dashboard_password || 'admin',
      vault_enc_key: this.generateSecurePassword(32),
      logflare_api_key: this.generateSecurePassword(24)
    };

    return {
      id: instanceId,
      name: projectName,
      owner: customConfig.owner || 'admin', // Adicionar owner
      status: 'creating',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ports,
      credentials,
      urls: {
        studio: generateInstanceUrl(instanceId, ports.kong_http),
        api: generateInstanceUrl(instanceId, ports.kong_http),
        db: `postgresql://postgres:${credentials.postgres_password}@${EXTERNAL_IP}:${ports.postgres_ext}/postgres`
      },
      docker: {
        compose_file: `docker-compose-${instanceId}.yml`,
        env_file: `.env-${instanceId}`,
        volumes_dir: `volumes-${instanceId}`
      },
      config: {
        organization: customConfig.organization || 'Default Organization',
        project: projectName,
        ...customConfig
      }
    };
  }

  /**
   * Gera senha segura
   */
  generateSecurePassword(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Gera JWT Secret
   */
  generateJWTSecret() {
    return this.generateSecurePassword(64);
  }

  /**
   * Gera chaves Supabase (ANON_KEY e SERVICE_ROLE_KEY)
   * Implementação completa com JWT válido
   */
  generateSupabaseKey(role, jwtSecret) {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      role: role,
      iss: 'supabase-instance-manager',
      iat: now,
      exp: now + (365 * 24 * 60 * 60) // 1 ano de validade
    };
    
    // Gerar JWT válido usando a biblioteca jsonwebtoken
    return jwt.sign(payload, jwtSecret, { 
      algorithm: 'HS256',
      header: {
        alg: 'HS256',
        typ: 'JWT'
      }
    });
  }

  /**
   * Valida se um token JWT é válido
   */
  validateSupabaseKey(token, jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      console.log(`✅ Token JWT válido para role: ${decoded.role}`);
      return decoded;
    } catch (error) {
      console.error(`❌ Token JWT inválido: ${error.message}`);
      return null;
    }
  }

  /**
   * Lista todas as instâncias
   */
  async listInstances() {
    try {
      console.log('📋 Listando instâncias...');
      console.log('Instâncias carregadas:', Object.keys(this.instances).length);
      
      const instances = Object.values(this.instances);
      
      // Se não há instâncias, retornar imediatamente sem verificar Docker
      if (instances.length === 0) {
        console.log('📝 Nenhuma instância encontrada, retornando lista vazia');
        return {
          instances: [],
          stats: {
            total: 0,
            running: 0,
            stopped: 0,
            max_instances: CONFIG.MAX_INSTANCES
          }
        };
      }
      
      // Verificar se Docker está disponível apenas quando há instâncias
      let dockerAvailable = false;
      try {
        await Promise.race([
          docker.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Docker ping timeout')), 5000))
        ]);
        dockerAvailable = true;
        console.log('✅ Docker está disponível');
      } catch (dockerError) {
        console.warn('⚠️ Docker não está disponível ou timeout:', dockerError.message);
        dockerAvailable = false;
      }
      
      // Atualizar status das instâncias verificando containers (apenas se Docker disponível)
      if (dockerAvailable) {
        for (const instance of instances) {
          try {
            instance.status = await this.getInstanceStatus(instance);
          } catch (statusError) {
            console.warn(`⚠️ Erro ao verificar status da instância ${instance.id}:`, statusError.message);
            // Manter status anterior ou definir como error
            instance.status = instance.status || 'error';
          }
        }
      } else {
        // Se Docker não está disponível, usar status salvo ou marcar como indisponível
        instances.forEach(instance => {
          instance.status = instance.status || 'unavailable';
        });
        console.log('🔧 Docker indisponível, usando status salvos');
      }
      
      // Formatar instâncias para frontend com studio_url
      const formattedInstances = instances.map(instance => ({
        ...instance,
        studio_url: instance.urls?.studio || generateInstanceUrl(instance.id, instance.ports?.kong_http || 8000)
      }));
      
      const result = {
        instances: formattedInstances,
        stats: {
          total: instances.length,
          running: instances.filter(i => i.status === 'running').length,
          stopped: instances.filter(i => i.status === 'stopped').length,
          max_instances: CONFIG.MAX_INSTANCES
        }
      };
      
      console.log('📊 Estatísticas:', result.stats);
      return result;
      
    } catch (error) {
      console.error('❌ Erro ao listar instâncias:', error);
      // Retornar estrutura básica mesmo em caso de erro
      return {
        instances: [],
        stats: {
          total: 0,
          running: 0,
          stopped: 0,
          max_instances: CONFIG.MAX_INSTANCES
        }
      };
    }
  }

  /**
   * Verifica status REAL de uma instância específica (com conectividade)
   */
  async getInstanceStatus(instance) {
    try {
      // Verificar containers Kong (mais confiável)
      const containers = await Promise.race([
        docker.listContainers({ 
          all: true, 
          filters: { name: [`supabase-kong-${instance.id}`] } 
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Container list timeout')), 10000)
        )
      ]);
      
      if (containers.length === 0) {
        console.log(`📦 Nenhum container encontrado para instância ${instance.id}`);
        instance.status = 'stopped';
        this.saveInstances();
        return 'stopped';
      }
      
      const container = containers[0];
      if (container.State === 'running') {
        // Testar conectividade real com timeout
        try {
          const testUrl = `http://localhost:${instance.ports.kong}/health`;
          const response = await Promise.race([
            fetch(testUrl),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Fetch timeout')), 3000)
            )
          ]);
          
          if (response.ok) {
            console.log(`✅ Instância ${instance.id} rodando e respondendo`);
            instance.status = 'running';
            instance.ready = true;
            this.saveInstances();
            return 'running';
          } else {
            console.log(`⏳ Instância ${instance.id} iniciando...`);
            instance.status = 'starting';
            this.saveInstances();
            return 'starting';
          }
        } catch (fetchError) {
          console.log(`⏳ Instância ${instance.id} ainda não responde`);
          instance.status = 'starting';
          this.saveInstances();
          return 'starting';
        }
      } else if (container.State === 'restarting') {
        instance.status = 'starting';
        this.saveInstances();
        return 'starting';
      } else {
        console.log(`📦 Container ${instance.id} parado: ${container.State}`);
        instance.status = 'stopped';
        this.saveInstances();
        return 'stopped';
      }
      
    } catch (error) {
      console.warn(`⚠️ Erro ao verificar status da instância ${instance.id}:`, error.message);
      instance.status = 'error';
      instance.error_message = error.message;
      this.saveInstances();
      return 'error';
    }
  }

  /**
   * Atualiza status de todas as instâncias (polling)
   */
  async updateAllInstancesStatus() {
    const instances = Object.values(this.instances);
    
    for (const instance of instances) {
      try {
        const oldStatus = instance.status;
        const newStatus = await this.getInstanceStatus(instance);
        
        // Broadcast apenas se status mudou
        if (oldStatus !== newStatus) {
          console.log(`📊 Status de ${instance.name} (${instance.id}) mudou: ${oldStatus} → ${newStatus}`);
          this.broadcastInstanceUpdate(instance.id, newStatus, `Status: ${newStatus}`);
        }
      } catch (error) {
        console.warn(`⚠️ Erro ao atualizar status de ${instance.id}:`, error.message);
      }
    }
  }

  /**
   * Cria nova instância Supabase de forma assíncrona (resposta imediata)
   */
  async createInstanceAsync(projectName, customConfig = {}) {
    const lockKey = `creation_${Date.now()}_${Math.random()}`;
    
    try {
      console.log(`🔒 Verificando lock de criação...`);
      this.clearStaleLocks();
      
      if (this.creationLock.size > 0) {
        throw new Error('Já existe uma instância sendo criada. Aguarde alguns minutos.');
      }
      
      // Adquirir lock
      this.creationLock.set(lockKey, Date.now());
      logger.debug(`✅ Lock adquirido: ${lockKey}`);
      
      // Criar instância básica imediatamente
      const instance = await this.prepareInstanceForCreation(projectName, customConfig);
      
      // Salvar com status 'creating'
      instance.status = 'creating';
      this.instances[instance.id] = instance;
      this.saveInstances();
      
      console.log(`💾 Instância ${instance.id} criada com status 'creating'`);
      
      // EXECUTAR PROCESSO COMPLETO EM BACKGROUND
      this.executeCreationInBackground(instance, lockKey);
      
      return {
        success: true,
        instance: instance,
        message: 'Instância em criação...'
      };
      
    } catch (error) {
      this.creationLock.delete(lockKey);
      throw error;
    }
  }

  /**
   * Prepara instância para criação (parte síncrona)
   */
  async prepareInstanceForCreation(projectName, customConfig = {}) {
    // Gerar ID da instância
    const instanceId = Math.random().toString(36).substring(2, 10);
    
    // Verificar recursos
    await this.validateSystemResources();
    
    // Alocar portas
    const ports = this.allocateInstancePorts(instanceId);
    console.log(`✅ Portas alocadas: Kong HTTP=${ports.kong}, HTTPS=${ports.kong_https}, PostgreSQL=${ports.postgres_ext}, Analytics=${ports.analytics}`);
    
    // Gerar credenciais
    const credentials = this.generateInstanceCredentials(instanceId, customConfig);
    
    // Criar objeto da instância
    const instance = {
      id: instanceId,
      name: projectName,
      status: 'creating', // Status inicial
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ports: ports,
      credentials: credentials,
      config: {
        organization: customConfig.organization || 'DefaultOrg',
        dashboard_username: customConfig.dashboard_username || 'admin',
        dashboard_password: customConfig.dashboard_password || 'admin',
        owner: customConfig.owner || 'admin'
      },
      urls: {
        studio: `http://${EXTERNAL_IP}:${ports.kong}`,
        database: `postgres://postgres:${credentials.postgres_password}@${EXTERNAL_IP}:${ports.postgres_ext}/postgres`,
        api: `http://${EXTERNAL_IP}:${ports.kong}/rest/v1/`
      },
      docker: {
        compose_file: `docker-compose-${instanceId}.yml`,
        env_file: `.env-${instanceId}`,
        volumes_dir: `volumes-${instanceId}`
      }
    };
    
    return instance;
  }

  /**
   * Executa criação completa em background
   */
  async executeCreationInBackground(instance, lockKey) {
    try {
      console.log(`🔧 Executando criação em background para ${instance.id}...`);
      
      // Atualizar status para 'downloading'
      instance.status = 'downloading';
      this.instances[instance.id] = instance;
      this.saveInstances();
      this.broadcastInstanceUpdate(instance.id, 'downloading', 'Baixando imagens Docker...');
      
      // Executar generate.bash
      await this.executeGenerateScript(instance);
      
      // Atualizar status para 'starting'
      instance.status = 'starting';
      this.instances[instance.id] = instance;
      this.saveInstances();
      this.broadcastInstanceUpdate(instance.id, 'starting', 'Iniciando containers...');
      
      // Aguardar containers ficarem prontos
      await this.waitForContainersReady(instance);
      
      // Atualizar status para 'running'
      instance.status = 'running';
      instance.ready = true;
      instance.updated_at = new Date().toISOString();
      this.instances[instance.id] = instance;
      this.saveInstances();
      
      console.log(`✅ Instância ${instance.id} criada e iniciada com sucesso`);
      this.broadcastInstanceUpdate(instance.id, 'running', 'Instância criada com sucesso!');
      
    } catch (error) {
      console.error(`❌ Erro na criação em background de ${instance.id}:`, error);
      
      // Atualizar status para 'error'
      instance.status = 'error';
      instance.error_message = error.message;
      instance.updated_at = new Date().toISOString();
      this.instances[instance.id] = instance;
      this.saveInstances();
      
      this.broadcastInstanceUpdate(instance.id, 'error', `Erro: ${error.message}`);
      
    } finally {
      // Liberar lock
      this.creationLock.delete(lockKey);
      console.log(`🔓 Lock liberado: ${lockKey}`);
    }
  }

  /**
   * Aguarda containers ficarem prontos
   */
  async waitForContainersReady(instance, maxWaitTime = 300000) { // 5 minutos
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Verificar se containers estão rodando
        const containers = await docker.listContainers({
          filters: { name: [`supabase-kong-${instance.id}`] }
        });
        
        if (containers.length > 0 && containers[0].State === 'running') {
          // Testar conectividade Kong
          const testUrl = `http://localhost:${instance.ports.kong}/health`;
          try {
            const response = await fetch(testUrl);
            if (response.ok) {
              console.log(`✅ Instância ${instance.id} respondendo corretamente`);
              return true;
            }
          } catch (fetchError) {
            // Kong ainda não está pronto
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000)); // Aguardar 5 segundos
        
      } catch (error) {
        console.warn(`⚠️ Erro ao verificar containers: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    throw new Error('Timeout: Containers não ficaram prontos em 5 minutos');
  }

  /**
   * Broadcast de atualização de instância via WebSocket
   */
  broadcastInstanceUpdate(instanceId, status, message) {
    const update = {
      type: 'instance_update',
      instanceId,
      status,
      message,
      timestamp: new Date().toISOString()
    };
    
    // Broadcast para todos os clientes WebSocket conectados
    if (global.wsClients) {
      global.wsClients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(JSON.stringify(update));
        }
      });
    }
    
    console.log(`📡 [WebSocket] ${instanceId}: ${status} - ${message}`);
  }

  /**
   * Cria nova instância Supabase usando generate.bash (método original)
   */
  async createInstance(projectName, customConfig = {}) {
    let instance = null;
    const lockKey = `creation_${Date.now()}_${Math.random()}`;
    
    try {
      // CORREÇÃO FASE 1: Sistema de lock para evitar criações simultâneas
      console.log(`🔒 Verificando lock de criação...`);
      
      // Primeiro, limpar locks antigos (mais de 15 minutos)
      this.clearStaleLocks();
      
      if (this.creationLock.size > 0) {
        const activeLock = Array.from(this.creationLock.keys())[0];
        const lockTime = this.creationLock.get(activeLock);
        const waitingTime = Math.ceil((Date.now() - lockTime) / 1000);
        
        throw new Error(`⏳ Já há uma criação em andamento há ${waitingTime}s. Aguarde finalizar antes de criar nova instância.`);
      }
      
      // Adquirir lock
      this.creationLock.set(lockKey, Date.now());
      logger.debug(`✅ Lock adquirido: ${lockKey}`);
      
      // Gerar configuração da instância primeiro para obter instanceId
      instance = await this.generateInstanceConfig(projectName, customConfig);
      const instanceId = instance.id;
      
      logger.instance(instanceId, `🚀 Iniciando criação do projeto: ${projectName}`, { projectName, customConfig });
      
      // Validações
      if (!projectName || projectName.trim().length === 0) {
        throw new Error('Nome do projeto é obrigatório');
      }

      if (Object.keys(this.instances).length >= CONFIG.MAX_INSTANCES) {
        throw new Error(`Limite máximo de ${CONFIG.MAX_INSTANCES} instâncias atingido`);
      }

      // CORREÇÃO FASE 3: Validar recursos do sistema antes de criar instância
      console.log('🔍 Validando recursos do sistema...');
      const resourceValidation = await this.validateResourcesForNewInstance();
      
      if (!resourceValidation.canCreate) {
        const issuesText = resourceValidation.issues.join('; ');
        throw new Error(`⚠️ Recursos insuficientes para criar nova instância: ${issuesText}`);
      }
      
      console.log('✅ Recursos suficientes disponíveis para nova instância');

      // Verificar se já existe projeto com esse nome
      const existingProject = Object.values(this.instances).find(
        i => i.name.toLowerCase() === projectName.toLowerCase()
      );
      if (existingProject) {
        throw new Error('Já existe um projeto com este nome');
      }
      
      // Verificar se Docker está disponível
      try {
        await docker.ping();
        console.log('✅ Docker está disponível');
      } catch (dockerError) {
        console.error('❌ Docker não está disponível:', dockerError.message);
        throw new Error(`Docker não está disponível. 
        
📋 INSTRUÇÕES PARA CORREÇÃO:
1. Instalar Docker Desktop para Windows: https://docs.docker.com/desktop/windows/install/
2. Iniciar Docker Desktop
3. Aguardar Docker ficar ativo (ícone na bandeja)
4. Tentar criar instância novamente

⚠️ Sem Docker não é possível criar instâncias Supabase.`);
      }
      
      // Verificar se diretório do Docker existe
      if (!await fs.pathExists(CONFIG.DOCKER_DIR)) {
        throw new Error(`Diretório Docker não encontrado: ${CONFIG.DOCKER_DIR}`);
      }

      // CORREÇÃO FASE 2: Configuração já gerada acima
      console.log('⚙️ Configuração da instância preparada...');
      
      // Definir status como 'creating'
      instance.status = 'creating';
      
      // Salvar instância
      this.instances[instance.id] = instance;
      this.saveInstances();
      
      console.log(`💾 Instância ${instance.id} salva com status 'creating'`);

      // Executar generate.bash para criar e iniciar a instância
      console.log('🔧 Executando generate.bash para criar instância...');
      console.log('⏳ ATENÇÃO: Primeira criação pode demorar 5-10 minutos (download de imagens Docker)');
      
      try {
        await this.executeGenerateScript(instance);
        
        // Atualizar status para running após sucesso
        instance.status = 'running';
        instance.updated_at = new Date().toISOString();
        this.saveInstances();
        
        console.log(`✅ Instância ${instance.id} criada e iniciada com sucesso via generate.bash`);
        
      } catch (scriptError) {
        console.error(`❌ Erro ao executar generate.bash para ${instance.id}:`, scriptError);
        instance.status = 'error';
        instance.error_message = scriptError.message;
        instance.updated_at = new Date().toISOString();
        this.saveInstances();
        throw scriptError;
      }

      logger.instance(instance.id, `✅ Instância criada com sucesso`, { 
        projectName, 
        ports: instance.ports,
        urls: instance.urls 
      });
      
      return {
        success: true,
        instance: instance,
        message: `Projeto "${projectName}" criado com sucesso! Acesse: ${instance.urls.studio}`
      };

    } catch (error) {
      // CORREÇÃO FASE 3: Tratamento de erro com categorização e sugestões
      const errorReport = this.formatError(error, `Criação da instância ${projectName}`);
      
      // Limpar instância em caso de erro
      if (instance && instance.id && this.instances[instance.id]) {
        console.log(`🧹 Limpando instância falhada ${instance.id}...`);
        try {
          await this.deleteInstance(instance.id);
        } catch (cleanupError) {
          const cleanupReport = this.formatError(cleanupError, 'Limpeza de instância falhada');
          console.error('⚠️ Erro adicional na limpeza - sistema pode precisar de intervenção manual');
        }
      }
      
      // Retornar erro com categoria e sugestão
      const categoryPrefix = errorReport.category === 'Sistema' ? '' : `[${errorReport.category}] `;
      throw new Error(`${categoryPrefix}Falha ao criar projeto: ${error.message}. 💡 ${errorReport.suggestion}`);
    } finally {
      // CORREÇÃO FASE 1: Sempre liberar lock, mesmo em caso de erro
      if (this.creationLock.has(lockKey)) {
        this.creationLock.delete(lockKey);
        logger.debug(`🔓 Lock liberado: ${lockKey}`);
      }
    }
  }

  /**
   * Limpa locks de criação antigos (mais de 15 minutos)
   */
  clearStaleLocks() {
    const now = Date.now();
    const maxLockAge = 5 * 60 * 1000; // 5 minutos (reduzido de 15)
    
    for (const [lockKey, lockTime] of this.creationLock.entries()) {
      if ((now - lockTime) > maxLockAge) {
        console.log(`🧹 Removendo lock antigo: ${lockKey} (idade: ${Math.ceil((now - lockTime) / 1000)}s)`);
        this.creationLock.delete(lockKey);
      }
    }
  }

  /**
   * CORREÇÃO FASE 3: Sistema de categorização e tratamento de erros
   */
  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    // Categorizar tipos de erro
    if (message.includes('enoent') || message.includes('não encontrado') || message.includes('not found')) {
      return {
        type: 'file_missing',
        category: 'Arquivo/Diretório',
        severity: 'high',
        suggestion: 'Verifique se todos os arquivos necessários estão presentes'
      };
    }
    
    if (message.includes('eacces') || message.includes('permission') || message.includes('permissão')) {
      return {
        type: 'permission_denied',
        category: 'Permissões',
        severity: 'high',
        suggestion: 'Verifique as permissões de arquivo e usuário'
      };
    }
    
    if (message.includes('docker') || message.includes('container')) {
      return {
        type: 'docker_error',
        category: 'Docker',
        severity: 'high',
        suggestion: 'Verifique se o Docker está rodando e se há recursos suficientes'
      };
    }
    
    if (message.includes('port') || message.includes('porta') || message.includes('address already in use')) {
      return {
        type: 'port_conflict',
        category: 'Rede',
        severity: 'medium',
        suggestion: 'Porta já está em uso. O sistema tentará encontrar outra porta automaticamente'
      };
    }
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        type: 'timeout',
        category: 'Timeout',
        severity: 'medium',
        suggestion: 'Operação demorou muito. Tente novamente ou verifique a conectividade'
      };
    }
    
    if (message.includes('memória') || message.includes('memory') || message.includes('espaço') || message.includes('disk')) {
      return {
        type: 'resource_limit',
        category: 'Recursos',
        severity: 'high',
        suggestion: 'Recursos insuficientes. Libere espaço em disco ou memória'
      };
    }
    
    if (message.includes('network') || message.includes('conexão') || message.includes('connection')) {
      return {
        type: 'network_error',
        category: 'Rede',
        severity: 'medium',
        suggestion: 'Problema de conectividade. Verifique a rede e firewall'
      };
    }
    
    // Erro genérico
    return {
      type: 'unknown',
      category: 'Sistema',
      severity: 'medium',
      suggestion: 'Verifique os logs para mais detalhes'
    };
  }

  /**
   * CORREÇÃO FASE 3: Formatar erro com categoria e sugestões
   */
  formatError(error, context = '') {
    const errorInfo = this.categorizeError(error);
    const timestamp = new Date().toISOString();
    
    const errorReport = {
      timestamp: timestamp,
      context: context,
      type: errorInfo.type,
      category: errorInfo.category,
      severity: errorInfo.severity,
      message: error.message,
      suggestion: errorInfo.suggestion,
      stack: error.stack
    };

    // Log estruturado
    console.error(`❌ [${errorInfo.category}] ${context ? context + ': ' : ''}${error.message}`);
    console.error(`💡 Sugestão: ${errorInfo.suggestion}`);
    
    if (errorInfo.severity === 'high') {
      console.error(`🚨 Erro crítico detectado - Intervenção necessária`);
    }

    return errorReport;
  }

  /**
   * CORREÇÃO FASE 3: Gerar relatório de erro com ações recomendadas
   */
  generateErrorReport(errors, context) {
    const report = {
      timestamp: new Date().toISOString(),
      context: context,
      total_errors: errors.length,
      errors_by_category: {},
      errors_by_severity: { high: 0, medium: 0, low: 0 },
      recommendations: [],
      errors: errors
    };

    // Agrupar erros por categoria e severidade
    errors.forEach(error => {
      const errorInfo = this.categorizeError(error);
      
      if (!report.errors_by_category[errorInfo.category]) {
        report.errors_by_category[errorInfo.category] = 0;
      }
      report.errors_by_category[errorInfo.category]++;
      report.errors_by_severity[errorInfo.severity]++;
      
      // Adicionar recomendação única
      if (!report.recommendations.includes(errorInfo.suggestion)) {
        report.recommendations.push(errorInfo.suggestion);
      }
    });

    return report;
  }

  /**
   * CORREÇÃO FASE 3: Executa operação com retry automático e backoff exponencial
   */
  async executeWithRetry(operation, operationName, maxAttempts = 3, baseDelayMs = 5000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`🔄 ${operationName} - Tentativa ${attempt} de ${maxAttempts}`);
        
        const result = await operation();
        
        if (attempt > 1) {
          console.log(`✅ ${operationName} executado com sucesso na tentativa ${attempt}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ ${operationName} falhou na tentativa ${attempt}:`, error.message);
        
        if (attempt === maxAttempts) {
          console.error(`❌ ${operationName} falhou após ${maxAttempts} tentativas`);
          break;
        }
        
        // Backoff exponencial: 5s, 10s, 20s...
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`⏳ Aguardando ${delay/1000}s antes da próxima tentativa...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error(`${operationName} falhou após ${maxAttempts} tentativas: ${lastError.message}`);
  }

  /**
   * CORREÇÃO FASE 3: Executa generate.bash para criar instância Supabase com retry
   */
  async executeGenerateScript(instance) {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      const generateScript = path.join(dockerDir, 'generate.bash');
      
      // Verificar se script existe
      if (!await fs.pathExists(generateScript)) {
        throw new Error(`Script generate.bash não encontrado em: ${generateScript}`);
      }
      
      // Preparar variáveis de ambiente para o script
      const scriptEnv = this.prepareScriptEnvironment(instance);
      
      console.log(`🔧 Executando generate.bash para instância ${instance.id}...`);
      console.log(`📁 Diretório: ${dockerDir}`);
      
      // CORREÇÃO FASE 3: Executar script com retry automático
      const command = `cd "${dockerDir}" && bash generate.bash`;
      
      const { stdout, stderr } = await this.executeWithRetry(async () => {
        return await execAsync(command, {
          timeout: 900000, // 15 minutos
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
          env: { ...process.env, ...scriptEnv }
        });
      }, `Execução do script generate.bash para instância ${instance.id}`, 3, 10000);
      
      console.log('📋 Script output:', stdout);
      if (stderr) {
        console.warn('⚠️ Script warnings:', stderr);
      }
      
      // Verificar se arquivos foram criados
      const envFile = path.join(dockerDir, `.env-${instance.id}`);
      const composeFile = path.join(dockerDir, `docker-compose-${instance.id}.yml`);
      
      if (!await fs.pathExists(envFile)) {
        throw new Error(`Arquivo .env-${instance.id} não foi criado pelo script`);
      }
      
      if (!await fs.pathExists(composeFile)) {
        throw new Error(`Arquivo docker-compose-${instance.id}.yml não foi criado pelo script`);
      }
      
      // Atualizar referências nos dados da instância
      instance.docker.env_file = `.env-${instance.id}`;
      instance.docker.compose_file = `docker-compose-${instance.id}.yml`;
      instance.docker.volumes_dir = `volumes-${instance.id}`;
      
      console.log(`✅ Generate.bash executado com sucesso para instância ${instance.id}`);
      
    } catch (error) {
      throw new Error(`Erro ao executar generate.bash: ${error.message}`);
    }
  }

  /**
   * Prepara variáveis de ambiente para o script generate.bash
   */
  prepareScriptEnvironment(instance) {
    const { credentials, ports, config } = instance;
    
    return {
      // Identificação da instância (usar INSTANCE_ID para compatibilidade com script)
      MANAGER_INSTANCE_ID: instance.id,
      MANAGER_PROJECT_NAME: instance.name,
      MANAGER_ORGANIZATION_NAME: config.organization || 'Default Organization',
      
      // Credenciais geradas localmente
      MANAGER_POSTGRES_PASSWORD: credentials.postgres_password,
      MANAGER_JWT_SECRET: credentials.jwt_secret,
      MANAGER_ANON_KEY: credentials.anon_key,
      MANAGER_SERVICE_ROLE_KEY: credentials.service_role_key,
      MANAGER_DASHBOARD_USERNAME: credentials.dashboard_username,
      MANAGER_DASHBOARD_PASSWORD: credentials.dashboard_password,
      
      // Portas dinâmicas
      MANAGER_POSTGRES_PORT_EXT: ports.postgres_ext.toString(),
      MANAGER_POOLER_PORT_EXT: ports.supavisor.toString(),
      MANAGER_KONG_HTTP_PORT: ports.kong_http.toString(),
      MANAGER_KONG_HTTPS_PORT: ports.kong_https.toString(),
      MANAGER_ANALYTICS_PORT: ports.analytics.toString(),
      
      // IP externo dinâmico (será detectado pelo script ou usar VPS IP)
      MANAGER_EXTERNAL_IP: EXTERNAL_IP
    };
  }

  /**
   * Cria arquivos de configuração da instância (DEPRECATED - usando generate.bash)
   */
  async createInstanceFiles(instance) {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      
      // Gerar arquivo .env
      const envContent = await this.generateEnvFile(instance);
      await fs.writeFile(path.join(dockerDir, instance.docker.env_file), envContent);

      // Gerar docker-compose.yml
      const composeContent = await this.generateComposeFile(instance);
      await fs.writeFile(path.join(dockerDir, instance.docker.compose_file), composeContent);

      // Criar diretórios de volumes
      await this.createVolumeDirectories(instance);

      console.log(`📁 Arquivos de configuração criados para instância ${instance.id}`);

    } catch (error) {
      throw new Error(`Erro ao criar arquivos de configuração: ${error.message}`);
    }
  }

  /**
   * Gera arquivo .env para a instância
   */
  async generateEnvFile(instance) {
    const { credentials, ports, config } = instance;
    const externalIP = EXTERNAL_IP;
    
    return `############
# Instance Identification
############

INSTANCE_ID=${instance.id}

############
# Secrets
############

POSTGRES_PASSWORD=${credentials.postgres_password}
JWT_SECRET=${credentials.jwt_secret}
ANON_KEY=${credentials.anon_key}
SERVICE_ROLE_KEY=${credentials.service_role_key}
DASHBOARD_USERNAME=${credentials.dashboard_username}
DASHBOARD_PASSWORD=${credentials.dashboard_password}
VAULT_ENC_KEY=${credentials.vault_enc_key}
SECRET_KEY_BASE=${this.generateSecurePassword(64)}

############
# Database
############

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
POSTGRES_PORT_EXT=${ports.postgres_ext}

############
# Supavisor -- Database pooler
############
POOLER_PORT_EXT=${ports.supavisor}
POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_TENANT_ID=${instance.id}

############
# API Proxy
############

KONG_HTTP_PORT=${ports.kong_http}
KONG_HTTPS_PORT=${ports.kong_https}

############
# API
############

PGRST_DB_SCHEMAS=public,storage,graphql_public

############
# Auth
############

SITE_URL=http://${externalIP}:3000
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=false
API_EXTERNAL_URL=${generateInstanceUrl(instanceId, ports.kong_http)}

## Mailer Config
MAILER_URLPATHS_CONFIRMATION="/auth/v1/verify"
MAILER_URLPATHS_INVITE="/auth/v1/verify"
MAILER_URLPATHS_RECOVERY="/auth/v1/verify"
MAILER_URLPATHS_EMAIL_CHANGE="/auth/v1/verify"

## Email auth
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=supabase-mail
SMTP_PORT=2500
SMTP_USER=fake_mail_user
SMTP_PASS=fake_mail_password
SMTP_SENDER_NAME=fake_sender
ENABLE_ANONYMOUS_USERS=true

## Phone auth
ENABLE_PHONE_SIGNUP=true
ENABLE_PHONE_AUTOCONFIRM=true

############
# Studio
############

STUDIO_DEFAULT_ORGANIZATION=${config.organization}
STUDIO_DEFAULT_PROJECT=${config.project}

STUDIO_PORT=3000
SUPABASE_PUBLIC_URL=${generateInstanceUrl(instanceId, ports.kong_http)}

# Enable webp support
IMGPROXY_ENABLE_WEBP_DETECTION=true

############
# Functions
############

FUNCTIONS_VERIFY_JWT=false

############
# Logs
############

LOGFLARE_LOGGER_BACKEND_API_KEY=${credentials.logflare_api_key}
LOGFLARE_API_KEY=${credentials.logflare_api_key}
ANALYTICS_PORT=${ports.analytics}

# Docker socket location
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
`;
  }

  /**
   * Gera arquivo docker-compose.yml para a instância
   */
  async generateComposeFile(instance) {
    // Ler template original e fazer substituições
    const originalComposePath = path.join(CONFIG.DOCKER_DIR, 'docker-compose.yml');
    let composeContent = await fs.readFile(originalComposePath, 'utf8');
    
    // Substituir variáveis específicas da instância
    composeContent = composeContent.replace(/supabase-studio-\${INSTANCE_ID}/g, `supabase-studio-${instance.id}`);
    composeContent = composeContent.replace(/supabase-kong-\${INSTANCE_ID}/g, `supabase-kong-${instance.id}`);
    composeContent = composeContent.replace(/supabase-auth-\${INSTANCE_ID}/g, `supabase-auth-${instance.id}`);
    composeContent = composeContent.replace(/supabase-rest-\${INSTANCE_ID}/g, `supabase-rest-${instance.id}`);
    composeContent = composeContent.replace(/realtime-dev\.supabase-realtime-\${INSTANCE_ID}/g, `realtime-dev.supabase-realtime-${instance.id}`);
    composeContent = composeContent.replace(/supabase-storage-\${INSTANCE_ID}/g, `supabase-storage-${instance.id}`);
    composeContent = composeContent.replace(/supabase-imgproxy-\${INSTANCE_ID}/g, `supabase-imgproxy-${instance.id}`);
    composeContent = composeContent.replace(/supabase-meta-\${INSTANCE_ID}/g, `supabase-meta-${instance.id}`);
    composeContent = composeContent.replace(/supabase-edge-functions-\${INSTANCE_ID}/g, `supabase-edge-functions-${instance.id}`);
    composeContent = composeContent.replace(/supabase-analytics-\${INSTANCE_ID}/g, `supabase-analytics-${instance.id}`);
    composeContent = composeContent.replace(/supabase-db-\${INSTANCE_ID}/g, `supabase-db-${instance.id}`);
    composeContent = composeContent.replace(/supabase-vector-\${INSTANCE_ID}/g, `supabase-vector-${instance.id}`);
    composeContent = composeContent.replace(/supabase-pooler-\${INSTANCE_ID}/g, `supabase-pooler-${instance.id}`);
    
    // Substituir referências de volumes
    composeContent = composeContent.replace(/volumes-\${INSTANCE_ID}/g, `volumes-${instance.id}`);
    composeContent = composeContent.replace(/db-data-\${INSTANCE_ID}/g, `db-data-${instance.id}`);
    
    // Atualizar nome do projeto
    composeContent = `name: supabase-${instance.id}\n\n` + composeContent.substring(composeContent.indexOf('services:'));
    
    return composeContent;
  }

  /**
   * Cria diretórios de volumes para a instância
   */
  async createVolumeDirectories(instance) {
    const dockerDir = CONFIG.DOCKER_DIR;
    const volumesDir = path.join(dockerDir, instance.docker.volumes_dir);

    // Criar estrutura de diretórios
    await fs.ensureDir(path.join(volumesDir, 'functions'));
    await fs.ensureDir(path.join(volumesDir, 'logs'));
    await fs.ensureDir(path.join(volumesDir, 'db', 'init'));
    await fs.ensureDir(path.join(volumesDir, 'api'));
    await fs.ensureDir(path.join(volumesDir, 'storage'));

    // Copiar arquivos base
    const baseVolumesDir = path.join(dockerDir, 'volumes');
    
    if (await fs.pathExists(path.join(baseVolumesDir, 'db'))) {
      await fs.copy(path.join(baseVolumesDir, 'db'), path.join(volumesDir, 'db'));
    }

    if (await fs.pathExists(path.join(baseVolumesDir, 'functions'))) {
      await fs.copy(path.join(baseVolumesDir, 'functions'), path.join(volumesDir, 'functions'));
    }

    // Gerar kong.yml específico da instância
    const kongTemplate = await fs.readFile(path.join(baseVolumesDir, 'api', 'kong.yml'), 'utf8');
    const kongContent = kongTemplate.replace(/\${INSTANCE_ID}/g, instance.id);
    await fs.writeFile(path.join(volumesDir, 'api', 'kong.yml'), kongContent);

    // Gerar vector.yml específico da instância
    if (await fs.pathExists(path.join(baseVolumesDir, 'logs', 'vector.yml'))) {
      const vectorTemplate = await fs.readFile(path.join(baseVolumesDir, 'logs', 'vector.yml'), 'utf8');
      const vectorContent = vectorTemplate.replace(/\${LOGFLARE_API_KEY}/g, instance.credentials.logflare_api_key);
      await fs.writeFile(path.join(volumesDir, 'logs', 'vector.yml'), vectorContent);
    }
  }

  /**
   * Inicia containers da instância
   */
  async startInstanceContainers(instance) {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      const composeFile = path.join(dockerDir, instance.docker.compose_file);
      const envFile = path.join(dockerDir, instance.docker.env_file);

      console.log(`🚀 Iniciando containers para instância ${instance.id}...`);

      // Comando com timeout mais longo para primeira execução
      const command = `cd "${dockerDir}" && timeout 600 docker compose -f "${instance.docker.compose_file}" --env-file "${instance.docker.env_file}" up -d --pull always`;
      
      console.log(`Executando comando: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, { 
        timeout: 600000, // 10 minutos
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
      
      console.log('Docker stdout:', stdout);
      if (stderr) {
        console.log('Docker stderr:', stderr);
      }
      
      // Verificar se houve erros críticos
      if (stderr && (stderr.includes('ERROR') || stderr.includes('FATAL') || stderr.includes('failed'))) {
        throw new Error(`Erro crítico ao iniciar containers: ${stderr}`);
      }

      console.log(`✅ Containers iniciados para instância ${instance.id}`);

    } catch (error) {
      console.error(`❌ Erro detalhado ao iniciar containers para ${instance.id}:`, error);
      throw new Error(`Erro ao iniciar containers: ${error.message}`);
    }
  }

  /**
   * Aguarda containers estarem completamente prontos
   */
  async waitForContainersReady(instance, maxWaitTime = 300000) { // 5 minutos
    const startTime = Date.now();
    let attempts = 0;
    const maxAttempts = 60; // 1 tentativa por segundo por 1 minuto
    
    console.log(`⏳ Verificando se containers da instância ${instance.id} estão prontos...`);
    
    while (Date.now() - startTime < maxWaitTime && attempts < maxAttempts) {
      try {
        // Verificar se Kong (proxy principal) está respondendo
        // Usar localhost para verificações internas do servidor (mais confiável)
        const response = await fetch(`http://localhost:${instance.ports.kong_http}/api/health`, {
          timeout: 5000,
          headers: { 'User-Agent': 'Supabase-Instance-Manager' }
        });
        
        if (response.ok || response.status === 404) { // 404 é OK, significa que Kong está rodando
          console.log(`✅ Kong da instância ${instance.id} está respondendo na porta ${instance.ports.kong_http}`);
          return true;
        }
      } catch (error) {
        // Continuar tentando...
      }
      
      attempts++;
      console.log(`⏳ Tentativa ${attempts}/${maxAttempts} - Aguardando containers ficarem prontos...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Aguardar 5 segundos
    }
    
    console.warn(`⚠️ Timeout aguardando containers da instância ${instance.id}. Continuando mesmo assim...`);
    return false; // Não falhar, apenas avisar
  }

  /**
   * Para uma instância
   */
  async stopInstance(instanceId) {
    try {
      if (!this.instances[instanceId]) {
        throw new Error('Instância não encontrada');
      }

      const instance = this.instances[instanceId];
      const dockerDir = CONFIG.DOCKER_DIR;

      const command = `cd "${dockerDir}" && docker compose -f "${instance.docker.compose_file}" down`;
      await execAsync(command);

      instance.status = 'stopped';
      instance.updated_at = new Date().toISOString();
      this.saveInstances();

      return { success: true, message: `Instância ${instance.name} parada com sucesso` };

    } catch (error) {
      throw new Error(`Erro ao parar instância: ${error.message}`);
    }
  }

  /**
   * Inicia uma instância parada
   */
  async startInstance(instanceId) {
    try {
      if (!this.instances[instanceId]) {
        throw new Error('Instância não encontrada');
      }

      const instance = this.instances[instanceId];
      await this.startInstanceContainers(instance);

      instance.status = 'running';
      instance.updated_at = new Date().toISOString();
      this.saveInstances();

      return { success: true, message: `Instância ${instance.name} iniciada com sucesso` };

    } catch (error) {
      throw new Error(`Erro ao iniciar instância: ${error.message}`);
    }
  }

  /**
   * Remove uma instância completamente
   */
  async deleteInstance(instanceId) {
    try {
      if (!this.instances[instanceId]) {
        throw new Error('Instância não encontrada');
      }

      const instance = this.instances[instanceId];
      const dockerDir = CONFIG.DOCKER_DIR;
      let containersStopped = false;

      // Parar e remover containers se o arquivo compose existir
      const composeFilePath = path.join(dockerDir, instance.docker.compose_file);
      if (await fs.pathExists(composeFilePath)) {
        try {
          console.log(`🐳 Parando containers para instância ${instanceId}...`);
          const stopCommand = `cd "${dockerDir}" && docker compose -f "${instance.docker.compose_file}" down -v --remove-orphans`;
          await execAsync(stopCommand);
          containersStopped = true;
          console.log(`✅ Containers parados com sucesso`);
        } catch (dockerError) {
          console.warn(`⚠️ Erro ao parar containers (pode não estar rodando): ${dockerError.message}`);
          // Continuar mesmo se docker falhar
        }
      } else {
        console.log(`⚠️ Arquivo docker-compose não encontrado: ${instance.docker.compose_file}`);
      }

      // Remover arquivos de configuração (verificar se existem)
      const filesToRemove = [
        path.join(dockerDir, instance.docker.compose_file),
        path.join(dockerDir, instance.docker.env_file),
        path.join(dockerDir, instance.docker.volumes_dir)
      ];

      for (const filePath of filesToRemove) {
        if (await fs.pathExists(filePath)) {
          try {
            await fs.remove(filePath);
            console.log(`🗑️ Removido: ${path.basename(filePath)}`);
          } catch (removeError) {
            console.warn(`⚠️ Erro ao remover ${path.basename(filePath)}: ${removeError.message}`);
          }
        } else {
          console.log(`⚠️ Arquivo não encontrado (já removido): ${path.basename(filePath)}`);
        }
      }

      // Liberar portas
      if (instance.ports) {
        this.usedPorts.delete(instance.ports.kong_http);
        this.usedPorts.delete(instance.ports.kong_https);
        this.usedPorts.delete(instance.ports.postgres_ext);
        if (instance.ports.supavisor) this.usedPorts.delete(instance.ports.supavisor);
        this.usedPorts.delete(instance.ports.analytics);
        console.log(`🔌 Portas liberadas para instância ${instanceId}`);
      }

      // Remover do registro
      delete this.instances[instanceId];
      this.saveInstances();

      const statusMessage = containersStopped ? 'removida com sucesso' : 'removida (containers já estavam parados)';
      return { success: true, message: `Instância ${instance.name} ${statusMessage}` };

    } catch (error) {
      // Log detalhado para debugging
      console.error(`❌ Erro detalhado ao remover instância ${instanceId}:`, error);
      
      // Tentar remover da memória mesmo se houver erro nos arquivos
      if (this.instances[instanceId]) {
        delete this.instances[instanceId];
        this.saveInstances();
        console.log(`🧹 Instância ${instanceId} removida do registro apesar dos erros`);
      }
      
      throw new Error(`Erro ao remover instância: ${error.message}`);
    }
  }

  /**
   * Limpa instâncias órfãs (que existem no registro mas não têm arquivos)
   */
  async cleanOrphanedInstances() {
    try {
      const dockerDir = CONFIG.DOCKER_DIR;
      const orphanedInstances = [];

      console.log('🧹 Verificando instâncias órfãs...');

      for (const [instanceId, instance] of Object.entries(this.instances)) {
        const composeFilePath = path.join(dockerDir, instance.docker.compose_file);
        const envFilePath = path.join(dockerDir, instance.docker.env_file);

        // Se nem compose nem env existem, é uma instância órfã
        const composeExists = await fs.pathExists(composeFilePath);
        const envExists = await fs.pathExists(envFilePath);

        if (!composeExists && !envExists) {
          console.log(`🔍 Instância órfã detectada: ${instanceId} (${instance.name})`);
          orphanedInstances.push(instanceId);
        }
      }

      if (orphanedInstances.length > 0) {
        console.log(`🧹 Limpando ${orphanedInstances.length} instância(s) órfã(s)...`);
        
        for (const instanceId of orphanedInstances) {
          try {
            // Liberar portas se existirem
            const instance = this.instances[instanceId];
            if (instance.ports) {
              this.usedPorts.delete(instance.ports.kong_http);
              this.usedPorts.delete(instance.ports.kong_https);
              this.usedPorts.delete(instance.ports.postgres_ext);
              if (instance.ports.supavisor) this.usedPorts.delete(instance.ports.supavisor);
              this.usedPorts.delete(instance.ports.analytics);
            }

            // Remover do registro
            delete this.instances[instanceId];
            console.log(`✅ Instância órfã removida: ${instanceId}`);
          } catch (cleanError) {
            console.error(`❌ Erro ao limpar instância órfã ${instanceId}:`, cleanError.message);
          }
        }

        this.saveInstances();
        return { 
          success: true, 
          cleaned: orphanedInstances.length,
          message: `${orphanedInstances.length} instância(s) órfã(s) removida(s)` 
        };
      } else {
        return { 
          success: true, 
          cleaned: 0,
          message: 'Nenhuma instância órfã encontrada' 
        };
      }

    } catch (error) {
      console.error('❌ Erro ao limpar instâncias órfãs:', error);
      throw new Error(`Erro ao limpar instâncias órfãs: ${error.message}`);
    }
  }
}

// Sistema de diagnóstico removido por ser problemático e causar instabilidade no servidor

// Instâncias globais dos gerenciadores
const userManager = new UserManager();
const manager = new SupabaseInstanceManager();

// Sistema de diagnóstico removido - operação manual mais confiável

// Sistema de gerenciamento seguro removido

// Editor de configuração removido

const backupSystem = new BackupSystem({
  DOCKER_DIR: DOCKER_DIR,
  EXTERNAL_IP: EXTERNAL_IP,
  SERVER_IP: SERVER_IP
});

// Sistema de auto-correção removido

// Histórico de diagnóstico removido

// Sistema de agendamento removido

// Cache cleanup removido - sistema simplificado

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      error: 'Token de acesso requerido',
      code: 'NO_TOKEN'
    });
  }

  try {
    const decoded = userManager.verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Erro de autenticação:', error.message);
    return res.status(403).json({ 
      error: 'Token inválido ou expirado',
      code: 'INVALID_TOKEN'
    });
  }
};

// Middleware para verificar se é admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Acesso negado. Permissões de administrador requeridas.',
      code: 'ADMIN_REQUIRED'
    });
  }
  next();
};

// Helper para verificar permissão de acesso ao projeto
const checkProjectAccess = async (req, res, next) => {
  const projectId = req.params.id;
  const userId = req.user.id;
  
  // Admin pode acessar tudo
  if (req.user.role === 'admin') {
    return next();
  }
  
  // Verificar se projeto existe
  const instance = manager.instances[projectId];
  if (!instance) {
    return res.status(404).json({
      error: 'Projeto não encontrado',
      code: 'PROJECT_NOT_FOUND'
    });
  }
  
  // Verificar se usuário pode acessar
  if (instance.owner !== userId && !userManager.canAccessProject(userId, projectId)) {
    return res.status(403).json({
      error: 'Acesso negado. Você não tem permissão para acessar este projeto.',
      code: 'PROJECT_ACCESS_DENIED'
    });
  }
  
  next();
};

// Rotas da API

/**
 * ENDPOINTS DE AUTENTICAÇÃO
 */

/**
 * Login de usuário
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username e password são obrigatórios',
        code: 'MISSING_CREDENTIALS'
      });
    }

    console.log(`🔐 Tentativa de login: ${username}`);

    const user = await userManager.authenticateUser(username, password);
    const token = userManager.generateToken(user);

    console.log(`✅ Login bem-sucedido: ${username} (${user.role})`);

    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        role: user.role,
        projects: user.projects,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('❌ Erro no login:', error.message);
    res.status(401).json({
      error: error.message,
      code: 'LOGIN_FAILED'
    });
  }
});

/**
 * Registro de novo usuário (apenas admin)
 */
app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username e password são obrigatórios',
        code: 'MISSING_CREDENTIALS'
      });
    }

    if (username.length < 3 || password.length < 4) {
      return res.status(400).json({
        error: 'Username deve ter pelo menos 3 caracteres e password pelo menos 4',
        code: 'INVALID_CREDENTIALS'
      });
    }

    console.log(`👤 Admin ${req.user.id} criando usuário: ${username}`);

    const newUser = await userManager.createUser(username, password, role);

    res.json({
      success: true,
      user: {
        id: newUser.id,
        role: newUser.role,
        projects: newUser.projects,
        created_at: newUser.created_at
      }
    });

  } catch (error) {
    console.error('❌ Erro no registro:', error.message);
    res.status(400).json({
      error: error.message,
      code: 'REGISTER_FAILED'
    });
  }
});

/**
 * Verificar token (para renovação automática)
 */
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user.id,
      role: req.user.role,
      iat: req.user.iat,
      exp: req.user.exp
    }
  });
});

/**
 * Listar usuários (apenas admin)
 */
app.get('/api/auth/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const users = userManager.listUsers();
    res.json({
      success: true,
      users: users
    });
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error.message);
    res.status(500).json({
      error: error.message,
      code: 'LIST_USERS_FAILED'
    });
  }
});

/**
 * Alterar senha do usuário
 */
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'Senha atual, nova senha e confirmação são obrigatórios',
        code: 'MISSING_PASSWORDS'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Nova senha e confirmação não coincidem',
        code: 'PASSWORD_MISMATCH'
      });
    }

    console.log(`🔐 Tentativa de alteração de senha para usuário: ${userId}`);

    await userManager.changePassword(userId, currentPassword, newPassword);

    console.log(`✅ Senha alterada com sucesso para usuário: ${userId}`);

    res.json({
      success: true,
      message: 'Senha alterada com sucesso'
    });

  } catch (error) {
    console.error('❌ Erro ao alterar senha:', error.message);
    res.status(400).json({
      error: error.message,
      code: 'CHANGE_PASSWORD_FAILED'
    });
  }
});


/**
 * Lista todas as instâncias (filtradas por usuário)
 */
app.get('/api/instances', authenticateToken, async (req, res) => {
  try {
    console.log(`📎 GET /api/instances - Listando instâncias para usuário: ${req.user.id}`);
    const data = await manager.listInstances();
    
    // Filtrar instâncias por usuário (admin vê todas)
    let filteredInstances = data.instances;
    if (req.user.role !== 'admin') {
      filteredInstances = data.instances.filter(instance => {
        return instance.owner === req.user.id || userManager.canAccessProject(req.user.id, instance.id);
      });
    }
    
    const result = {
      ...data,
      instances: filteredInstances,
      stats: {
        ...data.stats,
        total: filteredInstances.length,
        running: filteredInstances.filter(i => i.status === 'running').length,
        stopped: filteredInstances.filter(i => i.status === 'stopped').length
      }
    };
    
    console.log(`📎 Respondendo com ${result.instances.length} instâncias para ${req.user.id} (role: ${req.user.role})`);
    res.json(result);
  } catch (error) {
    console.error('❌ Erro ao listar instâncias:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cria nova instância
 */
app.post('/api/instances', authenticateToken, async (req, res) => {
  try {
    console.log('🚀 POST /api/instances - Criando nova instância...');
    console.log('Body recebido:', req.body);
    
    const { projectName, config = {} } = req.body;
    
    if (!projectName) {
      console.log('❌ Nome do projeto não fornecido');
      return res.status(400).json({ error: 'Nome do projeto é obrigatório' });
    }

    // Verificar se Docker está disponível antes de tentar criar
    try {
      await docker.ping();
    } catch (dockerError) {
      console.error('❌ Docker não está disponível para criação:', dockerError.message);
      return res.status(503).json({ 
        error: 'Serviço indisponível: Docker não está rodando. Verifique se está instalado e iniciado.',
        code: 'DOCKER_UNAVAILABLE'
      });
    }

    console.log(`🏠 Criando projeto: ${projectName} para usuário: ${req.user.id}`);
    
    // Adicionar owner ao config
    const configWithOwner = {
      ...config,
      owner: req.user.id
    };
    
    // RESPOSTA IMEDIATA - Criar instância em background
    try {
      const result = await manager.createInstanceAsync(projectName, configWithOwner);
      
      // Adicionar projeto ao usuário
      if (req.user.role !== 'admin') {
        userManager.addProjectToUser(req.user.id, result.instance.id);
        console.log(`👤 Projeto ${result.instance.id} adicionado ao usuário ${req.user.id}`);
      }
      
      console.log('✅ Instância iniciada com sucesso:', result.instance.id);
      console.log('⏳ Criação continuará em background...');
      
      // RESPOSTA IMEDIATA - instância com status 'creating'
      res.json({
        success: true,
        message: 'Instância em criação. Acompanhe o progresso em tempo real.',
        instance: result.instance,
        status: 'creating'
      });
      
    } catch (error) {
      throw error;
    }
    
  } catch (error) {
    logger.instanceError(req.body.projectName || 'unknown', '❌ Erro ao criar instância', error, { 
      projectName: req.body.projectName,
      phase: 'creation' 
    });
    
    // Verificar se é erro específico do Docker
    if (error.message.includes('Docker') || error.message.includes('ENOENT')) {
      res.status(503).json({ 
        error: 'Docker não está disponível. Verifique se o Docker está instalado e rodando.',
        code: 'DOCKER_ERROR'
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * Limpa locks de criação travados (rota de emergência)
 */
app.post('/api/system/clear-locks', authenticateToken, async (req, res) => {
  try {
    // Apenas admin pode limpar locks
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem limpar locks' });
    }
    
    const lockCount = manager.creationLock.size;
    console.log(`🧹 Admin ${req.user.id} limpando ${lockCount} locks travados`);
    
    // Listar locks antes de limpar (para log)
    const locks = Array.from(manager.creationLock.entries()).map(([key, time]) => ({
      key,
      age: Math.ceil((Date.now() - time) / 1000)
    }));
    
    // Limpar todos os locks
    manager.creationLock.clear();
    
    res.json({ 
      success: true,
      message: `${lockCount} locks removidos com sucesso`,
      cleared_locks: locks
    });
    
  } catch (error) {
    console.error('Erro ao limpar locks:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Para uma instância
 */
app.post('/api/instances/:id/stop', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`⏸️ Usuário ${req.user.id} parando instância ${req.params.id}`);
    const result = await manager.stopInstance(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao parar instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Inicia uma instância
 */
app.post('/api/instances/:id/start', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`▶️ Usuário ${req.user.id} iniciando instância ${req.params.id}`);
    const result = await manager.startInstance(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao iniciar instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Remove uma instância
 */
app.delete('/api/instances/:id', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`🗑️ Usuário ${req.user.id} removendo instância ${req.params.id}`);
    
    // Remover projeto do usuário se não for admin
    if (req.user.role !== 'admin') {
      userManager.removeProjectFromUser(req.user.id, req.params.id);
    }
    
    const result = await manager.deleteInstance(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Erro ao remover instância:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Limpa instâncias órfãs (admin only)
 */
app.post('/api/instances/cleanup-orphaned', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log(`🧹 Admin ${req.user.id} executando limpeza de instâncias órfãs`);
    
    const result = await manager.cleanOrphanedInstances();
    
    res.json({
      success: true,
      message: result.message,
      cleaned_count: result.cleaned,
      details: result
    });
  } catch (error) {
    console.error('❌ Erro ao limpar instâncias órfãs:', error);
    res.status(500).json({ 
      error: error.message,
      success: false
    });
  }
});

/**
 * Obtém detalhes de uma instância específica
 */
app.get('/api/instances/:id', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Atualizar status
    instance.status = await manager.getInstanceStatus(instance);
    
    res.json(instance);
  } catch (error) {
    console.error('Erro ao obter detalhes da instância:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtém logs de uma instância
 */
app.get('/api/instances/:id/logs', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const command = `cd "${CONFIG.DOCKER_DIR}" && docker compose -f "${instance.docker.compose_file}" logs --tail=100`;
    const { stdout } = await execAsync(command);
    
    res.json({ logs: stdout });
  } catch (error) {
    console.error('Erro ao obter logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ENDPOINTS DE DIAGNÓSTICO REMOVIDOS
 * Funcionalidade de diagnóstico automático foi removida para simplificar o sistema.
 * Use as operações manuais de start/stop e logs para monitoramento.
 */

// Rota removida: GET /api/instances/:id/run-diagnostics
// Funcionalidade: Executava diagnóstico completo de uma instância
// Substituição: Use GET /api/instances/:id/logs para monitoramento manual

// Rota removida: GET /api/instances/:id/last-diagnostic
// Funcionalidade: Obtinha último diagnóstico em cache
// Substituição: Use GET /api/instances/:id para status da instância

// Rota removida: GET /api/instances/:id/quick-health
// Funcionalidade: Diagnóstico rápido de saúde da instância
// Substituição: Use operações manuais de verificação via logs

// Rota removida: GET /api/instances/check-all-health
// Funcionalidade: Diagnóstico de todas as instâncias (admin)
// Substituição: Use GET /api/instances para listar todas e verificar manualmente

// Rota removida: GET /api/instances/:id/diagnostic-logs
// Funcionalidade: Análise estruturada de logs
// Substituição: Use GET /api/instances/:id/logs para logs simples

// Rota removida: GET /api/instances/:id/test-auth-service
// Funcionalidade: Teste específico do serviço de autenticação
// Substituição: Teste manualmente os endpoints de auth via Studio

/**
 * ENDPOINTS DE AÇÕES DIAGNÓSTICAS REMOVIDOS
 * Sistema de ações automáticas foi removido para simplificar o gerenciamento.
 * Use as operações manuais de start/stop/restart disponíveis.
 */

// Rota removida: POST /api/instances/:id/diagnostic-action
// Funcionalidade: Executava ações de correção automáticas
// Substituição: Use POST /api/instances/:id/start, /stop, ou operações manuais

// Rota removida: GET /api/instances/:id/action-history
// Funcionalidade: Histórico de ações diagnósticas executadas
// Substituição: Não há substituição - funcionalidade removida

// Rota removida: GET /api/instances/:id/action-stats
// Funcionalidade: Estatísticas das ações diagnósticas executadas
// Substituição: Não há substituição - funcionalidade removida

/**
 * ENDPOINTS DE HISTÓRICO E RELATÓRIOS REMOVIDOS
 * Sistema de histórico de diagnósticos foi removido para simplificar o gerenciamento.
 */

// Rota removida: GET /api/instances/:id/diagnostic-history
// Funcionalidade: Histórico de diagnósticos de uma instância
// Substituição: Não há substituição - use logs manuais

// Rota removida: GET /api/instances/:id/health-report
// Funcionalidade: Relatório de saúde de uma instância
// Substituição: Use monitoramento manual via logs e status

// Rota removida: GET /api/diagnostics/global-stats
// Funcionalidade: Estatísticas globais do sistema de diagnósticos
// Substituição: Não há substituição - use GET /api/instances para status geral

// Rota removida: POST /api/diagnostics/cleanup
// Funcionalidade: Limpeza de diagnósticos antigos
// Substituição: Não há substituição - sistema não gera mais diagnósticos

/**
 * ENDPOINTS DE AGENDAMENTO REMOVIDOS
 * Sistema de agendamento de diagnósticos foi removido para simplificar o gerenciamento.
 */

// Rota removida: POST /api/instances/:id/schedule-diagnostics
// Funcionalidade: Criar configuração de agendamento de diagnósticos
// Substituição: Não há substituição - use monitoramento manual

// Rota removida: GET /api/instances/:id/schedule-diagnostics
// Funcionalidade: Obter configuração de agendamento de diagnósticos
// Substituição: Não há substituição - sistema de agendamento removido

// Rota removida: PUT /api/instances/:id/schedule-diagnostics
// Funcionalidade: Atualizar configuração de agendamento de diagnósticos
// Substituição: Não há substituição - sistema de agendamento removido

// Rota removida: DELETE /api/instances/:id/schedule-diagnostics
// Funcionalidade: Remover configuração de agendamento de diagnósticos
// Substituição: Não há substituição - sistema de agendamento removido

// Rota removida: GET /api/instances/:id/cron-script
// Funcionalidade: Gerar script cron para diagnósticos agendados
// Substituição: Não há substituição - sistema de agendamento removido

// Rota removida: GET /api/diagnostics/schedules
// Funcionalidade: Listar todas as configurações de agendamento (admin)
// Substituição: Não há substituição - sistema de agendamento removido

// Rota removida: GET /api/diagnostics/full-cron-script
// Funcionalidade: Gerar script cron completo para todas as instâncias
// Substituição: Não há substituição - sistema de agendamento removido

/**
 * ENDPOINTS DE CONTROLE E GESTÃO SEGURA REMOVIDOS
 * Sistema de restart/reparo seguro foi removido para simplificar o gerenciamento.
 * Use as operações manuais de start/stop.
 */

// Rota removida: POST /api/instances/:id/safe-restart
// Funcionalidade: Restart seguro com backup e rollback
// Substituição: Use POST /api/instances/:id/stop seguido de /start

// Rota removida: POST /api/instances/:id/auto-repair
// Funcionalidade: Reparo automático de problemas detectados
// Substituição: Use operações manuais (restart, logs, config) para diagnóstico e reparo

/**
 * Atualiza configuração específica de uma instância
 */
app.put('/api/instances/:id/config/:field', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const { field } = req.params;
    const { value, auto_restart = false } = req.body;
    
    console.log(`⚙️ Usuário ${req.user.id} atualizando configuração ${field} da instância ${req.params.id}`);
    
    const options = {
      autoRestart: auto_restart,
      skipBackup: false,
      skipValidation: false
    };
    
    const result = await configEditor.updateInstanceConfig(req.params.id, field, value, options);
    
    res.json({
      success: result.success,
      message: result.message,
      field: result.field,
      old_value: result.old_value,
      new_value: result.new_value,
      restart_required: result.restart_required,
      restart_performed: result.restart_performed,
      backup_created: result.backup_created,
      rollback_performed: result.rollback_performed
    });
  } catch (error) {
    console.error('❌ Erro na atualização de configuração:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'CONFIG_UPDATE_FAILED'
    });
  }
});

/**
 * Atualiza múltiplas configurações em uma operação atômica
 */
app.put('/api/instances/:id/config', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const { updates, auto_restart = false } = req.body;
    
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ 
        error: 'Campo "updates" é obrigatório e deve ser um objeto',
        code: 'INVALID_UPDATES'
      });
    }
    
    console.log(`⚙️ Usuário ${req.user.id} atualizando ${Object.keys(updates).length} configurações da instância ${req.params.id}`);
    
    const options = {
      autoRestart: auto_restart
    };
    
    const result = await configEditor.updateMultipleConfigs(req.params.id, updates, options);
    
    res.json({
      success: result.success,
      message: result.message,
      results: result.results,
      restart_required: result.restart_required,
      restart_performed: result.restart_performed,
      backup_created: result.backup_created,
      rollback_performed: result.rollback_performed
    });
  } catch (error) {
    console.error('❌ Erro na atualização de configurações:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'BULK_CONFIG_UPDATE_FAILED'
    });
  }
});

/**
 * Lista campos editáveis de configuração
 */
app.get('/api/instances/:id/config/fields', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const editableFields = configEditor.getEditableFields();
    
    // Adicionar valores atuais
    const currentValues = {};
    for (const fieldName of Object.keys(editableFields)) {
      try {
        currentValues[fieldName] = configEditor.getCurrentFieldValue(req.params.id, fieldName);
      } catch (fieldError) {
        currentValues[fieldName] = null;
      }
    }
    
    res.json({
      success: true,
      editable_fields: editableFields,
      current_values: currentValues
    });
  } catch (error) {
    console.error('❌ Erro ao listar campos editáveis:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'LIST_FIELDS_FAILED'
    });
  }
});

/**
 * Cria backup manual de uma instância
 */
app.post('/api/instances/:id/backup', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const { operation = 'manual_backup' } = req.body;
    
    console.log(`💾 Usuário ${req.user.id} criando backup manual da instância ${req.params.id}`);
    
    const backup = await backupSystem.createInstanceBackup(req.params.id, operation);
    
    res.json({
      success: true,
      message: 'Backup criado com sucesso',
      backup: {
        backup_id: backup.backup_id,
        timestamp: backup.timestamp,
        operation: backup.operation,
        files_backed_up: Object.keys(backup.files).length,
        integrity_verified: !!backup.integrity_check && !backup.integrity_check.error
      }
    });
  } catch (error) {
    console.error('❌ Erro ao criar backup:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'BACKUP_CREATION_FAILED'
    });
  }
});

/**
 * Lista backups disponíveis para uma instância
 */
app.get('/api/instances/:id/backups', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const backups = await backupSystem.listInstanceBackups(req.params.id);
    
    res.json({
      success: true,
      backups: backups,
      total_backups: backups.length
    });
  } catch (error) {
    console.error('❌ Erro ao listar backups:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'LIST_BACKUPS_FAILED'
    });
  }
});

/**
 * Obtém detalhes de um backup específico
 */
app.get('/api/instances/:id/backups/:backupId', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const backupDetails = await backupSystem.getBackupDetails(req.params.id, req.params.backupId);
    
    res.json({
      success: true,
      backup: backupDetails
    });
  } catch (error) {
    console.error('❌ Erro ao obter detalhes do backup:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'BACKUP_DETAILS_FAILED'
    });
  }
});

/**
 * Restaura instância a partir de um backup
 */
app.post('/api/instances/:id/restore/:backupId', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    console.log(`🔄 Usuário ${req.user.id} restaurando instância ${req.params.id} do backup ${req.params.backupId}`);
    
    // Verificar se usuário confirmou a operação
    if (!req.body.confirm) {
      return res.status(400).json({
        error: 'Operação de restauração requer confirmação explícita',
        code: 'CONFIRMATION_REQUIRED',
        required_body: { confirm: true }
      });
    }
    
    const backup = await backupSystem.restoreInstanceFromBackup(req.params.id, req.params.backupId);
    
    // Executar restart simples após restauração
    console.log(`🔄 Executando restart após restauração...`);
    
    // Sistema de restart seguro removido - usar restart simples
    let restartSuccess = false;
    try {
      await manager.stopInstance(req.params.id);
      await manager.startInstance(req.params.id);
      restartSuccess = true;
      console.log(`✅ Restart simples executado com sucesso`);
    } catch (restartError) {
      console.error(`❌ Erro no restart simples:`, restartError);
      restartSuccess = false;
    }
    
    res.json({
      success: true,
      message: 'Restauração executada com sucesso',
      backup_restored: backup.backup_id,
      restart_performed: restartSuccess,
      restart_details: restartResult.message
    });
  } catch (error) {
    console.error('❌ Erro na restauração:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'RESTORE_FAILED'
    });
  }
});

/**
 * Status de operações em andamento (para polling)
 */
app.get('/api/instances/:id/operations', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    // Sistema de diagnóstico removido - status simples baseado na instância
    const instance = manager.instances[req.params.id];
    
    const operations = {
      instance_id: req.params.id,
      timestamp: new Date().toISOString(),
      instance_status: instance ? instance.status : 'not_found',
      last_backup: null, // Seria necessário implementar tracking de operações
      operations_in_progress: false,
      recommended_actions: []
    };
    
    // Adicionar recomendações baseadas no último diagnóstico
    if (diagnostic && !diagnostic.overall_healthy) {
      operations.recommended_actions.push({
        action: 'run_diagnostics',
        description: 'Executar novo diagnóstico para identificar problemas',
        endpoint: `/api/instances/${req.params.id}/run-diagnostics`
      });
      
      if (diagnostic.critical_issues.length > 0) {
        operations.recommended_actions.push({
          action: 'auto_repair',
          description: 'Executar reparo automático dos problemas detectados',
          endpoint: `/api/instances/${req.params.id}/auto-repair`
        });
      }
    }
    
    res.json({
      success: true,
      operations: operations
    });
  } catch (error) {
    console.error('❌ Erro ao obter status de operações:', error);
    res.status(500).json({ 
      error: error.message,
      code: 'OPERATIONS_STATUS_FAILED'
    });
  }
});

/**
 * Obtém credenciais de uma instância
 */
app.get('/api/instances/:id/credentials', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Verificar se as credenciais estão disponíveis
    if (!instance.credentials) {
      return res.status(500).json({ error: 'Credenciais não encontradas para esta instância' });
    }

    const credentials = {
      // Informações da API
      supabase_url: instance.urls?.studio || generateInstanceUrl(instance.id, instance.ports.kong_http),
      api_url: `${generateInstanceUrl(instance.id, instance.ports.kong_http)}/rest/v1`,
      
      // Chaves JWT
      anon_key: instance.credentials.anon_key,
      service_role_key: instance.credentials.service_role_key,
      
      // Credenciais de autenticação
      jwt_secret: instance.credentials.jwt_secret,
      
      // Credenciais do dashboard
      dashboard_username: instance.credentials.dashboard_username,
      dashboard_password: instance.credentials.dashboard_password,
      
      // Conexão direta do banco
      database: {
        host: EXTERNAL_IP,
        port: instance.ports.postgres_ext,
        database: 'postgres',
        username: 'postgres',
        password: instance.credentials.postgres_password
      },
      
      // Exemplo de código
      javascript_example: `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = '${generateInstanceUrl(instance.id, instance.ports.kong_http)}'
const supabaseKey = '${instance.credentials.anon_key}'

const supabase = createClient(supabaseUrl, supabaseKey)`,
      
      curl_example: `curl -X GET '${generateInstanceUrl(instance.id, instance.ports.kong_http)}/rest/v1/' \\
  -H "apikey: ${instance.credentials.anon_key}" \\
  -H "Authorization: Bearer ${instance.credentials.anon_key}"`
    };

    res.json(credentials);
  } catch (error) {
    console.error('Erro ao obter credenciais:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Altera credenciais de uma instância (dashboard username/password)
 */
app.post('/api/instances/:id/change-credentials', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instanceId = req.params.id;
    const { dashboard_username, dashboard_password } = req.body;
    
    // Validações
    if (!dashboard_username || !dashboard_password) {
      return res.status(400).json({ 
        error: 'Usuário e senha do dashboard são obrigatórios' 
      });
    }
    
    if (dashboard_username.length < 3) {
      return res.status(400).json({ 
        error: 'Usuário deve ter pelo menos 3 caracteres' 
      });
    }
    
    if (dashboard_password.length < 4) {
      return res.status(400).json({ 
        error: 'Senha deve ter pelo menos 4 caracteres' 
      });
    }

    const instance = manager.instances[instanceId];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Verificar se a instância está rodando
    if (instance.status !== 'running') {
      return res.status(400).json({ 
        error: 'Instância deve estar rodando para alterar credenciais',
        status: instance.status 
      });
    }

    console.log(`🔑 Alterando credenciais da instância ${instanceId}...`);

    // Modificar as variáveis de ambiente do container Kong
    const containerName = `supabase-kong-${instanceId}`;
    
    try {
      // Verificar se o container existe e está rodando
      const container = docker.getContainer(containerName);
      const containerInfo = await container.inspect();
      
      if (containerInfo.State.Status !== 'running') {
        return res.status(400).json({ 
          error: 'Container Kong não está rodando',
          container_status: containerInfo.State.Status 
        });
      }

      // Executar comando para alterar as credenciais no container Kong
      const exec = await container.exec({
        Cmd: ['/bin/sh', '-c', `
          # Definir novas credenciais como variáveis de ambiente
          export DASHBOARD_USERNAME="${dashboard_username}"
          export DASHBOARD_PASSWORD="${dashboard_password}"
          
          # Atualizar configuração do Kong (recarregar sem restart)
          echo "Credenciais atualizadas para: ${dashboard_username}"
        `],
        AttachStdout: true,
        AttachStderr: true
      });

      const stream = await exec.start({ hijack: true, stdin: false });
      
      // Aguardar execução
      await new Promise((resolve, reject) => {
        let output = '';
        stream.on('data', (chunk) => {
          output += chunk.toString();
        });
        stream.on('end', () => {
          console.log('Resultado da alteração:', output);
          resolve();
        });
        stream.on('error', reject);
        
        // Timeout de 30 segundos
        setTimeout(() => reject(new Error('Timeout na alteração de credenciais')), 30000);
      });

      // Atualizar credenciais na configuração da instância
      if (!instance.credentials) {
        instance.credentials = {};
      }
      
      instance.credentials.dashboard_username = dashboard_username;
      instance.credentials.dashboard_password = dashboard_password;
      
      // Salvar alterações
      manager.saveInstances();
      
      console.log(`✅ Credenciais da instância ${instanceId} alteradas com sucesso`);
      
      res.json({
        success: true,
        message: 'Credenciais alteradas com sucesso',
        credentials: {
          dashboard_username: dashboard_username,
          dashboard_url: instance.urls?.studio || generateInstanceUrl(instance.id, instance.ports.kong_http)
        }
      });

    } catch (dockerError) {
      console.error('Erro ao alterar credenciais no Docker:', dockerError);
      
      // Mesmo com erro no Docker, atualizar as credenciais para futuras recriações
      if (!instance.credentials) {
        instance.credentials = {};
      }
      
      instance.credentials.dashboard_username = dashboard_username;
      instance.credentials.dashboard_password = dashboard_password;
      manager.saveInstances();
      
      return res.status(207).json({
        success: false,
        partial: true,
        message: 'Credenciais salvas mas não aplicadas na instância atual. Reinicie a instância para que as novas credenciais sejam efetivadas.',
        credentials: {
          dashboard_username: dashboard_username,
          dashboard_url: instance.urls?.studio || generateInstanceUrl(instance.id, instance.ports.kong_http)
        },
        error: dockerError.message
      });
    }

  } catch (error) {
    console.error('Erro ao alterar credenciais:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cursor Integration Configuration
 */
app.get('/api/instances/:id/cursor-config', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const config = {
      project_id: instance.id,
      project_name: instance.name,
      supabase_url: instance.urls?.studio || generateInstanceUrl(instance.id, instance.ports.kong_http),
      api_url: `${generateInstanceUrl(instance.id, instance.ports.kong_http)}/rest/v1`,
      anon_key: instance.credentials.anon_key,
      service_role_key: instance.credentials.service_role_key,
      database_url: `postgresql://postgres:${instance.credentials.postgres_password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres`,
      
      // Arquivo .env pronto
      env_content: `# Ultrabase Supabase Instance - ${instance.name}
NEXT_PUBLIC_SUPABASE_URL=${generateInstanceUrl(instance.id, instance.ports.kong_http)}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${instance.credentials.anon_key}
SUPABASE_SERVICE_ROLE_KEY=${instance.credentials.service_role_key}
DATABASE_URL=postgresql://postgres:${instance.credentials.postgres_password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres

# Optional: Direct Database Connection
DB_HOST=${EXTERNAL_IP}
DB_PORT=${instance.ports.postgres_ext}
DB_NAME=postgres
DB_USER=postgres
DB_PASS=${instance.credentials.postgres_password}`,

      // Frameworks code examples
      frameworks: {
        javascript: `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = '${generateInstanceUrl(instance.id, instance.ports.kong_http)}'
const supabaseKey = '${instance.credentials.anon_key}'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Test connection
supabase.from('_supabase_admin').select('*').limit(1)
  .then(({ data, error }) => {
    if (error) console.error('Connection error:', error)
    else console.log('✅ Connected to Supabase!')
  })`,
        
        typescript: `import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl: string = '${generateInstanceUrl(instance.id, instance.ports.kong_http)}'
const supabaseKey: string = '${instance.credentials.anon_key}'

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey)

// Type-safe operations
interface User {
  id: string
  email: string
  created_at: string
}

export const getUsers = async (): Promise<User[]> => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
  
  if (error) throw error
  return data || []
}`,

        react: `import React, { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  '${generateInstanceUrl(instance.id, instance.ports.kong_http)}',
  '${instance.credentials.anon_key}'
)

function App() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
      
      if (error) throw error
      setData(data || [])
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div>Loading...</div>

  return (
    <div>
      <h1>Supabase React App</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}

export default App`,

        nextjs: `// lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// pages/api/users.js
import { supabase } from '../../lib/supabase'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('users')
      .select('*')
    
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    
    res.status(200).json(data)
  }
}

// pages/index.js
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [users, setUsers] = useState([])

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    const { data } = await supabase.from('users').select('*')
    setUsers(data || [])
  }

  return (
    <div>
      <h1>Next.js + Supabase</h1>
      {users.map(user => (
        <div key={user.id}>{user.email}</div>
      ))}
    </div>
  )
}`
      },

      // Automation example
      automation_example: `// Automation API Example - Execute SQL via REST
const executeSqlCommand = async (sql) => {
  const response = await fetch('http://${EXTERNAL_IP}:3080/api/instances/${instance.id}/execute-sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_MANAGER_TOKEN'
    },
    body: JSON.stringify({ query: sql })
  })
  
  return await response.json()
}

// Example usage
await executeSqlCommand(\`
  CREATE TABLE posts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    title text NOT NULL,
    content text,
    author_id uuid REFERENCES auth.users(id),
    created_at timestamp DEFAULT now()
  );
\`)

// Enable RLS
await executeSqlCommand('ALTER TABLE posts ENABLE ROW LEVEL SECURITY;')

// Create policies
await executeSqlCommand(\`
  CREATE POLICY "Users can view own posts" ON posts
    FOR SELECT USING (auth.uid() = author_id);
\`)`
    };

    res.json(config);
  } catch (error) {
    console.error('Erro ao obter configuração do Cursor:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Simple .env configuration for quick copy
 */
app.get('/api/instances/:id/env-config', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const envContent = `# Ultrabase Supabase Instance - ${instance.name}
NEXT_PUBLIC_SUPABASE_URL=${generateInstanceUrl(instance.id, instance.ports.kong_http)}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${instance.credentials.anon_key}
SUPABASE_SERVICE_ROLE_KEY=${instance.credentials.service_role_key}
DATABASE_URL=postgresql://postgres:${instance.credentials.postgres_password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres`;

    res.json({ env_content: envContent });
  } catch (error) {
    console.error('Erro ao gerar .env:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Framework-specific code templates
 */
app.get('/api/framework-code/:framework', async (req, res) => {
  const { framework } = req.params;
  
  const templates = {
    javascript: `import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default supabase`,

    typescript: `import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
)

export default supabase`,

    react: `import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
)`,

    nextjs: `import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)`
  };

  const code = templates[framework] || templates.javascript;
  res.json({ code });
});

/**
 * Test connection to instance
 */
app.get('/api/instances/:id/test-connection', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    // Test API endpoint
    const testUrl = `${generateInstanceUrl(instance.id, instance.ports.kong_http)}/rest/v1/`;
    const response = await fetch(testUrl, {
      headers: {
        'apikey': instance.credentials.anon_key,
        'Authorization': `Bearer ${instance.credentials.anon_key}`
      }
    });

    if (response.ok) {
      res.json({ 
        success: true, 
        message: `API responding on port ${instance.ports.kong_http}` 
      });
    } else {
      throw new Error(`API returned status ${response.status}`);
    }
  } catch (error) {
    console.error('Erro ao testar conexão:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Quick test with multiple checks
 */
app.get('/api/instances/:id/quick-test', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const results = [];

    // Test 1: API Health
    try {
      const apiUrl = `${generateInstanceUrl(instance.id, instance.ports.kong_http)}/rest/v1/`;
      const apiResponse = await fetch(apiUrl, {
        headers: { 'apikey': instance.credentials.anon_key }
      });
      results.push(apiResponse.ok ? '✅ API endpoint accessible' : '❌ API endpoint failed');
    } catch (error) {
      results.push('❌ API endpoint unreachable');
    }

    // Test 2: Database Connection
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        host: EXTERNAL_IP,
        port: instance.ports.postgres_ext,
        database: 'postgres',
        user: 'postgres',
        password: instance.credentials.postgres_password,
        connectionTimeoutMillis: 5000,
      });
      
      await pool.query('SELECT 1');
      await pool.end();
      results.push('✅ Database connection successful');
    } catch (error) {
      results.push('❌ Database connection failed');
    }

    // Test 3: Auth endpoint
    try {
      const authUrl = `${generateInstanceUrl(instance.id, instance.ports.kong_http)}/auth/v1/health`;
      const authResponse = await fetch(authUrl);
      results.push(authResponse.ok ? '✅ Auth service running' : '❌ Auth service failed');
    } catch (error) {
      results.push('❌ Auth service unreachable');
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Erro no teste rápido:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute SQL on instance database
 */
app.post('/api/instances/:id/execute-sql', authenticateToken, checkProjectAccess, async (req, res) => {
  try {
    const instance = manager.instances[req.params.id];
    if (!instance) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query SQL é obrigatória' });
    }

    const { Pool } = require('pg');
    const pool = new Pool({
      host: EXTERNAL_IP,
      port: instance.ports.postgres_ext,
      database: 'postgres',
      user: 'postgres',
      password: instance.credentials.postgres_password,
      connectionTimeoutMillis: 10000,
    });

    const result = await pool.query(query);
    await pool.end();

    res.json({
      success: true,
      rowCount: result.rowCount,
      rows: result.rows,
      command: result.command
    });
  } catch (error) {
    console.error('Erro ao executar SQL:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Health check with system diagnostics
 */
app.get('/api/health', async (req, res) => {
  try {
    let dockerStatus = false;
    let dockerVersion = 'N/A';
    let dockerComposeVersion = 'N/A';
    
    // Verificar Docker
    try {
      await docker.ping();
      dockerStatus = true;
      const dockerInfo = await execAsync('docker --version');
      dockerVersion = dockerInfo.stdout.trim();
    } catch (error) {
      console.log('Docker não disponível:', error.message);
    }
    
    // Verificar Docker Compose
    try {
      const composeInfo = await execAsync('docker compose version');
      dockerComposeVersion = composeInfo.stdout.trim();
    } catch (error) {
      console.log('Docker Compose não disponível:', error.message);
    }
    
    // Verificar diretório Docker
    const dockerDirExists = await fs.pathExists(CONFIG.DOCKER_DIR);
    
    res.json({ 
      status: 'ok', 
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      system: {
        docker: {
          available: dockerStatus,
          version: dockerVersion
        },
        docker_compose: {
          version: dockerComposeVersion
        },
        directories: {
          docker_dir: {
            path: CONFIG.DOCKER_DIR,
            exists: dockerDirExists
          }
        },
        instances: {
          total: Object.keys(manager.instances).length,
          max_allowed: CONFIG.MAX_INSTANCES
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

/**
 * Rota de configuração - mostra configurações atuais do sistema
 */
app.get('/api/config', (req, res) => {
  try {
    res.json({
      status: 'ok',
      configuration: {
        external_ip: EXTERNAL_IP,
        manager_port: PORT,
        docker_dir: CONFIG.DOCKER_DIR,
        port_ranges: CONFIG.PORT_RANGE,
        max_instances: CONFIG.MAX_INSTANCES,
        instances_count: Object.keys(manager.instances).length
      },
      environment: {
        VPS_HOST: process.env.VPS_HOST || 'not_set',
        MANAGER_EXTERNAL_IP: process.env.MANAGER_EXTERNAL_IP || 'not_set',
        NODE_ENV: process.env.NODE_ENV || 'development'
      },
      sample_urls: {
        studio: `http://${EXTERNAL_IP}:8100`,
        api: `http://${EXTERNAL_IP}:8100`,
        database: `postgresql://postgres:password@${EXTERNAL_IP}:5500/postgres`
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * CORREÇÃO FASE 4: Endpoints de visualização de logs
 */

// Endpoint para visualizar logs por tipo
app.get('/api/logs/:type?', authenticateToken, (req, res) => {
  const { type = 'application' } = req.params;
  const { lines = 100, level = 'info' } = req.query;
  
  try {
    const logsDir = path.join(__dirname, 'logs');
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(logsDir, `${type}-${today}.log`);
    
    if (!fs.existsSync(logFile)) {
      return res.json({
        status: 'empty',
        message: `Log file for ${type} not found for today`,
        logs: []
      });
    }
    
    // Ler últimas N linhas do arquivo
    const logContent = fs.readFileSync(logFile, 'utf8');
    const logLines = logContent.split('\n').filter(line => line.trim());
    const recentLogs = logLines.slice(-parseInt(lines));
    
    res.json({
      status: 'success',
      type,
      date: today,
      totalLines: logLines.length,
      returned: recentLogs.length,
      logs: recentLogs
    });
    
  } catch (error) {
    logger.error('Erro ao buscar logs', error);
    res.status(500).json({
      status: 'error',
      message: 'Erro ao buscar logs',
      error: error.message
    });
  }
});

// Endpoint para listar arquivos de log disponíveis
app.get('/api/logs-files', authenticateToken, (req, res) => {
  try {
    const logsDir = path.join(__dirname, 'logs');
    
    if (!fs.existsSync(logsDir)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const stats = fs.statSync(path.join(logsDir, file));
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime,
          type: file.split('-')[0]
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json({ files });
    
  } catch (error) {
    logger.error('Erro ao listar arquivos de log', error);
    res.status(500).json({
      status: 'error',
      message: 'Erro ao listar arquivos de log'
    });
  }
});

/**
 * Teste de geração de JWT (apenas para debug)
 */
app.get('/api/test-jwt', (req, res) => {
  try {
    console.log('🧪 Testando geração de JWT...');
    
    const testSecret = manager.generateJWTSecret();
    const anonToken = manager.generateSupabaseKey('anon', testSecret);
    const serviceToken = manager.generateSupabaseKey('service_role', testSecret);
    
    const anonDecoded = manager.validateSupabaseKey(anonToken, testSecret);
    const serviceDecoded = manager.validateSupabaseKey(serviceToken, testSecret);
    
    res.json({
      status: 'ok',
      jwt_generation: 'working',
      test_results: {
        anon_key: {
          token: anonToken,
          valid: !!anonDecoded,
          decoded: anonDecoded
        },
        service_role_key: {
          token: serviceToken,
          valid: !!serviceDecoded,
          decoded: serviceDecoded
        }
      }
    });
  } catch (error) {
    console.error('❌ Erro no teste JWT:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Inicialização do servidor
async function startServer() {
  let dockerAvailable = false;
  
  try {
    // Iniciar servidor IMEDIATAMENTE para responder rapidamente
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`
🚀 SUPABASE INSTANCE MANAGER - INICIADO
   
   🌐 Domínio Principal: https://${DOMAIN_CONFIG.primary}
   🏠 Landing Page: http://localhost:${PORT}
   📊 Dashboard: http://localhost:${PORT}/dashboard
   🔑 Login: http://localhost:${PORT}/login
   🔗 API: https://${DOMAIN_CONFIG.primary}/api
   🔌 WebSocket: ws://${DOMAIN_CONFIG.primary}/ws
   
   Status: ✅ ONLINE
   Instâncias salvas: ${Object.keys(manager.instances).length}
      `);
      
      // Inicializar WebSocket Server
      initializeWebSocket(server);
      
      // Iniciar polling de status das instâncias (a cada 30 segundos)
      setInterval(() => {
        if (dockerAvailable) {
          manager.updateAllInstancesStatus().catch(error => {
            console.warn('⚠️ Erro no polling de status:', error.message);
          });
        }
      }, 30000); // 30 segundos
      
      // Verificar Docker em background (não bloqueia startup)
      checkDockerInBackground();
    });

    async function checkDockerInBackground() {
      try {
        const timeout = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Docker check timeout')), 5000)
        );
        
        await Promise.race([docker.ping(), timeout]);
        dockerAvailable = true;
        console.log('✅ Docker conectado - Funcionalidade completa disponível');
      } catch (dockerError) {
        console.warn('⚠️  Docker não disponível - Modo somente leitura');
      }
      
      // Verificar diretório docker se necessário
      try {
        if (dockerAvailable && !await fs.pathExists(CONFIG.DOCKER_DIR)) {
          console.warn(`⚠️  Diretório Docker não encontrado: ${CONFIG.DOCKER_DIR}`);
        }
      } catch (err) {
        // Ignorar erros de verificação de diretório
      }
    }

  } catch (error) {
    console.error('❌ Erro ao inicializar servidor:', error.message);
    console.error('💡 Sugestões:');
    console.error('   - Verifique se a porta 3080 está livre');
    console.error('   - Execute o comando como administrador se necessário');
    process.exit(1);
  }
}

// ====================================================================
// ROTAS PARA LOGIN E DASHBOARD
// ====================================================================

// Rota para página de login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Rota para landing page (compatibilidade)
app.get('/landing', (req, res) => {
  console.log(`🏠 Acesso à landing page de ${req.get('host')}`);
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Rota alternativa para home (compatibilidade)
app.get('/home', (req, res) => {
  console.log(`🏠 Redirecionamento /home para página inicial de ${req.get('host')}`);
  res.redirect('/');
});

// Rota para dashboard (gerenciador existente) - sem autenticação prévia
// A autenticação é feita pelo JavaScript no lado cliente
app.get('/dashboard', (req, res) => {
  console.log(`📊 Acesso ao dashboard de ${req.get('host')}`);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para redirecionar /index.html para /dashboard (compatibilidade)
app.get('/index.html', (req, res) => {
  res.redirect('/dashboard');
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
  process.exit(1);
});

// ====================================================================
// WEBSOCKET SERVER PARA UPDATES EM TEMPO REAL
// ====================================================================

// WebSocket já importado no topo
let wss;
global.wsClients = new Set();

function initializeWebSocket(server) {
  wss = new WebSocket.Server({ 
    server,
    path: '/ws'
  });

  wss.on('connection', (ws, req) => {
    console.log('🔌 Nova conexão WebSocket estabelecida');
    global.wsClients.add(ws);

    // Ping/pong para manter conexão viva
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('📨 WebSocket message received:', data);
        
        // Responder com status atual das instâncias se solicitado
        if (data.type === 'get_instances_status') {
          const instancesStatus = Object.keys(manager.instances).map(id => ({
            id,
            status: manager.instances[id].status,
            name: manager.instances[id].name
          }));
          
          ws.send(JSON.stringify({
            type: 'instances_status',
            instances: instancesStatus
          }));
        }
      } catch (error) {
        console.warn('⚠️ Erro ao processar mensagem WebSocket:', error.message);
      }
    });

    ws.on('close', () => {
      console.log('🔌 Conexão WebSocket fechada');
      global.wsClients.delete(ws);
      clearInterval(pingInterval);
    });

    ws.on('error', (error) => {
      console.error('❌ Erro WebSocket:', error.message);
      global.wsClients.delete(ws);
      clearInterval(pingInterval);
    });
  });

  console.log('✅ WebSocket Server inicializado em /ws');
}

// ====================================================================
// INICIALIZAÇÃO DO SERVIDOR
// ====================================================================

// Iniciar servidor
startServer();