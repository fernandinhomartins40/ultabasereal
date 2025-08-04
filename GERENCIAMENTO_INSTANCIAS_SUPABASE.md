# 📊 GERENCIAMENTO DE INSTÂNCIAS SUPABASE - ULTRABASE

**Data de Análise**: 29/07/2025  
**Sistema**: Ultrabase Instance Manager  
**Versão**: Sistema com correções implementadas  

---

## 🎯 **VISÃO GERAL DO SISTEMA**

O **Ultrabase Instance Manager** é um sistema completo que replica a experiência do Supabase Cloud, permitindo criar e gerenciar múltiplas instâncias Supabase isoladas em uma única VPS. O sistema funciona como um "Supabase auto-hospedado" com interface web similar ao painel oficial.

### **🏗️ Arquitetura Principal**

```
┌─────────────────────────────────────────────────────────────────┐
│                    ULTRABASE INSTANCE MANAGER                   │
├─────────────────────────────────────────────────────────────────┤
│  🌐 Dashboard Web (Express.js + HTML/CSS/JS)                   │
│  📊 Sistema de Autenticação JWT + Usuários                     │
│  🔧 Gerenciador de Instâncias (SupabaseInstanceManager)        │
│  🐳 Integração Docker para isolamento                          │
│  🔍 Sistema de Diagnóstico e Auto-correção                     │
│  💾 Persistência em JSON (instances.json, users.json)         │
└─────────────────────────────────────────────────────────────────┘
                              ⬇️
┌─────────────────────────────────────────────────────────────────┐
│               INSTÂNCIAS SUPABASE ISOLADAS                     │
├─────────────────────────────────────────────────────────────────┤
│  📦 Projeto A: Kong:8100 + PostgreSQL:5500 + Studio           │  
│  📦 Projeto B: Kong:8200 + PostgreSQL:5600 + Studio           │
│  📦 Projeto C: Kong:8300 + PostgreSQL:5700 + Studio           │
│  📦 ...cada uma com containers isolados                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 **COMPONENTES PRINCIPAIS**

### **1. SupabaseInstanceManager (Classe Principal)**

**Localização**: `src/server.js` (linhas 396-2000+)  
**Função**: Controlador central para ciclo de vida das instâncias

#### **📋 Principais Responsabilidades:**

- **Criação de Instâncias**: Método `createInstance(projectName, customConfig)`
- **Gerenciamento de Portas**: Sistema inteligente de alocação de portas
- **Configuração**: Geração automática de credenciais e configurações
- **Persistência**: Salvamento em `instances.json`
- **Monitoramento**: Status e saúde das instâncias
- **Limpeza**: Remoção segura de instâncias

#### **🔒 Sistema de Lock (Correção Implementada)**

```javascript
// CORREÇÃO FASE 1: Previne criações simultâneas
this.creationLock = new Map(); // Controla criações simultâneas
this.creationQueue = []; // Fila de criações aguardando

// Lock é adquirido antes da criação
const lockKey = `creation_${Date.now()}_${Math.random()}`;
this.creationLock.set(lockKey, Date.now());
```

**Problema Resolvido**: Evita conflitos quando múltiplos usuários criam instâncias ao mesmo tempo.

---

### **2. Sistema de Gerenciamento de Portas**

#### **🌐 Alocação Inteligente de Portas**

```javascript
// Ranges predefinidos por serviço
Kong HTTP: 8000-8999
Kong HTTPS: 8400-8499  
PostgreSQL: 5400-5999
Analytics: 4000-4999
Supavisor: 5500-5599
```

#### **✅ Validação Real de Portas (Correção Implementada)**

```javascript
// CORREÇÃO FASE 2: Verifica se porta está realmente livre no SO
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
```

**Antes**: Apenas verificava Set interno  
**Depois**: Testa conexão real no sistema operacional

---

### **3. Processo de Criação de Instâncias**

#### **🚀 Fluxo Completo de Criação**

```mermaid
graph TD
    A[POST /api/instances] --> B[Validar Nome do Projeto]
    B --> C[Verificar Lock de Criação]
    C --> D[Adquirir Lock]
    D --> E[Gerar Configuração da Instância]
    E --> F[Verificar Recursos do Sistema]
    F --> G[Validar Docker Disponível]
    G --> H[Alocar Portas Livres]
    H --> I[Gerar Credenciais Únicas]
    I --> J[Salvar em instances.json]
    J --> K[Executar generate.bash]
    K --> L[Criar Containers Docker]
    L --> M[Atualizar Status: running]
    M --> N[Liberar Lock]
    N --> O[Retornar URLs de Acesso]
```

#### **📝 Configuração Gerada para Cada Instância**

```javascript
instance = {
  id: "ultrabase_1737981234567",
  name: "Meu Projeto",
  owner: "usuario123",
  status: "running",
  created_at: "2025-01-27T14:30:00.000Z",
  ports: {
    kong_http: 8100,
    kong_https: 8443,
    postgres_ext: 5500,
    analytics: 4100,
    supavisor: 5550
  },
  credentials: {
    postgres_password: "a1b2c3d4e5f6...",
    jwt_secret: "unique_secret_per_instance",
    anon_key: "eyJhbGciOiJIUzI1NiI...",
    service_role_key: "eyJhbGciOiJIUzI1NiI...",
    dashboard_username: "admin",
    dashboard_password: "random123"
  },
  urls: {
    studio: "http://82.25.69.57:8100",
    api: "http://82.25.69.57:8100",
    database: "postgresql://postgres:password@82.25.69.57:5500/postgres"
  }
}
```

---

### **4. Sistema de Validação de Recursos (Correção Implementada)**

#### **💾 Verificação de Memória**

```javascript
// CORREÇÃO FASE 3: Verifica recursos antes de criar instância
async checkSystemResources() {
  const resources = {
    memory: await this.checkMemoryResources(),
    disk: await this.checkDiskSpace(), 
    cpu: await this.checkCPULoad()
  };
  
  // Requer mínimo: 512MB RAM + 1GB disco por instância
  return this.validateResourcesForNewInstance(resources);
}
```

**Benefício**: Previne criação de instâncias quando sistema está sobrecarregado.

---

### **5. Integração com Docker**

#### **🐳 Execução do generate.bash**

O sistema não cria containers diretamente. Em vez disso, chama o script `generate.bash` que:

```javascript
async executeGenerateScript(instance) {
  const command = `cd "${CONFIG.DOCKER_DIR}" && bash generate.bash`;
  
  // Passar variáveis de ambiente para o script
  const env = {
    MANAGER_INSTANCE_ID: instance.id,
    MANAGER_PROJECT_NAME: instance.name,
    MANAGER_POSTGRES_PASSWORD: instance.credentials.postgres_password,
    MANAGER_JWT_SECRET: instance.credentials.jwt_secret,
    MANAGER_EXTERNAL_IP: EXTERNAL_IP,
    // ... outras variáveis
  };
  
  await execAsync(command, { env, timeout: 900000 }); // 15 min timeout
}
```

**Fluxo**:
1. Manager prepara configuração
2. Chama `generate.bash` com variáveis
3. Script cria containers Docker isolados
4. Manager atualiza status da instância

---

### **6. Sistema de Autenticação e Permissões**

#### **👤 UserManager (Classe)**

```javascript
class UserManager {
  // Usuários salvos em users.json
  users = {
    "admin": {
      id: "admin", 
      role: "admin",
      projects: ["*"], // Admin acessa todos
      password_hash: "..."
    },
    "usuario1": {
      id: "usuario1",
      role: "user", 
      projects: ["instance_123", "instance_456"], // Apenas próprios projetos
      password_hash: "..."
    }
  }
}
```

#### **🔐 Controle de Acesso**

- **Admin**: Acessa todas as instâncias, pode criar usuários
- **User**: Apenas instâncias que criou ou foi autorizado
- **JWT**: Tokens com 24h de validade
- **Middleware**: `authenticateToken` + `checkProjectAccess`

---

### **7. Rotas da API**

#### **🔗 Principais Endpoints**

```javascript
// Autenticação
POST /api/auth/login          → Login com username/password
POST /api/auth/register       → Criar usuário (apenas admin)
GET  /api/auth/verify         → Verificar token JWT
POST /api/auth/change-password → Alterar senha

// Gerenciamento de Instâncias  
GET  /api/instances           → Listar instâncias do usuário
POST /api/instances           → Criar nova instância
GET  /api/instances/:id       → Detalhes de instância específica
POST /api/instances/:id/stop  → Parar instância
POST /api/instances/:id/start → Iniciar instância  
DELETE /api/instances/:id     → Deletar instância

// Diagnóstico e Monitoramento
GET  /api/instances/:id/status    → Status detalhado
POST /api/instances/:id/diagnose  → Executar diagnóstico
POST /api/instances/:id/repair    → Auto-correção
GET  /api/system/resources        → Recursos do sistema
```

---

### **8. Interface Web**

#### **🎨 Dashboard Responsivo**

**Arquivos**:
- `src/public/index.html` - Dashboard principal
- `src/public/login.html` - Página de login  
- `src/public/landing.html` - Landing page

**Funcionalidades**:
- 📊 **Lista de Projetos**: Cards com status visual
- ➕ **Criação Fácil**: Modal com nome do projeto
- 🔗 **Acesso Rápido**: Links diretos para Studio e APIs
- 📱 **Responsivo**: Funciona em desktop e mobile
- 🔄 **Atualização em Tempo Real**: Status das instâncias
- ⚡ **Ações Rápidas**: Start/Stop/Delete em um clique

---

### **9. Sistema de Diagnóstico (Avançado)**

#### **🔍 HealthChecker**

```javascript
// Diagnóstico automático de instâncias
const healthChecker = new HealthChecker();

await healthChecker.diagnoseInstance(instanceId); 
// → Retorna relatório completo de saúde
```

**Verificações**:
- ✅ Status dos containers Docker
- ✅ Conectividade dos serviços (Kong, PostgreSQL, GoTrue)
- ✅ Autenticação JWT funcionando
- ✅ Espaço em disco e memória
- ✅ Logs de erro recentes

#### **🛠️ Sistema de Auto-correção**

```javascript
// Tentativa automática de correção
const repairAPI = new RepairAPI();
await repairAPI.autoRepairInstance(instanceId);
```

**Reparos Automáticos**:
- 🔄 Restart de containers falhados
- 🔧 Regeneração de configurações corrompidas  
- 🌐 Correção de problemas de rede
- 💾 Limpeza de recursos órfãos

---

### **10. Configuração de IP Externo**

#### **🌐 Detecção Automática de IP**

```javascript
// Sistema inteligente de detecção de IP
const EXTERNAL_IP = process.env.VPS_HOST || 
                   process.env.MANAGER_EXTERNAL_IP || 
                   '82.25.69.57'; // Fallback para VPS

// URLs geradas automaticamente
instance.urls = {
  studio: `http://${EXTERNAL_IP}:${instance.ports.kong_http}`,
  api: `http://${EXTERNAL_IP}:${instance.ports.kong_http}`,
  database: `postgresql://postgres:${password}@${EXTERNAL_IP}:${instance.ports.postgres_ext}/postgres`
};
```

**Configuração via Ambiente**:
```bash
export VPS_HOST="82.25.69.57"
export MANAGER_EXTERNAL_IP="meu-dominio.com"
```

---

## 🎯 **FLUXO TÍPICO DE USO**

### **👤 Perspectiva do Usuário**

1. **Acesso**: Navega para `https://ultrabase.com.br`
2. **Login**: Autentica com credenciais
3. **Dashboard**: Vê projetos existentes + botão "Criar Projeto"
4. **Criação**: Clica em "Criar Projeto", digita nome, confirma
5. **Aguarda**: Sistema cria instância (2-10 minutos primeira vez)
6. **Acesso**: Recebe URLs diretas para Studio e API
7. **Desenvolvimento**: Usa como Supabase normal

### **⚙️ Perspectiva do Sistema**

1. **Recebe Requisição**: `POST /api/instances` com nome do projeto
2. **Valida**: Nome, recursos, Docker, permissões
3. **Aloca**: Portas livres e gera credenciais únicas
4. **Executa**: Script `generate.bash` para criar containers
5. **Monitora**: Status da criação e saúde dos serviços
6. **Disponibiliza**: URLs de acesso ao usuário
7. **Mantém**: Monitoramento contínuo e auto-correção

---

## 🔧 **PONTOS FORTES DO SISTEMA**

### **✅ Isolamento Total**
- Cada projeto tem containers próprios
- Portas únicas para cada instância  
- Credenciais diferentes por projeto
- Dados completamente isolados

### **✅ Facilidade de Uso**
- Interface similar ao Supabase Cloud
- Criação com um clique
- URLs diretas para Studio
- Não requer conhecimento de Docker

### **✅ Robustez Operacional**
- Sistema de lock para criações simultâneas
- Validação de recursos antes da criação
- Auto-correção de problemas comuns
- Retry automático em falhas temporárias
- Logging estruturado

### **✅ Segurança**
- JWT secrets únicos por instância
- Sistema de permissões por usuário
- Validação de acesso a projetos
- Credenciais geradas automaticamente

### **✅ Escalabilidade**
- Configurável para múltiplas instâncias
- Alocação inteligente de recursos
- Monitoramento de capacidade
- Limpeza automática de recursos

---

## 📊 **DADOS DE CONFIGURAÇÃO**

### **🗂️ Estrutura de Arquivos**

```
ultrabase/
├── src/
│   ├── server.js              → Servidor principal + SupabaseInstanceManager
│   ├── instances.json         → Dados das instâncias criadas
│   ├── users.json            → Usuários e permissões
│   ├── public/               → Interface web (HTML/CSS/JS)
│   ├── utils/logger.js       → Sistema de logging
│   ├── diagnostics/          → Sistema de diagnóstico
│   └── management/           → Ferramentas de gestão
├── supabase-core/            → Scripts e templates Supabase (DELETADO)
├── multiple-supabase-original/ → Backup do repositório original
└── scripts/                  → Scripts de deploy e manutenção
```

### **⚙️ Variáveis de Ambiente**

```bash
# Configuração principal
MANAGER_PORT=3080                    # Porta do manager
VPS_HOST=82.25.69.57                # IP externo da VPS
MANAGER_EXTERNAL_IP=ultrabase.com.br # Domínio alternativo
JWT_SECRET=ultrabase_jwt_secret      # Secret para tokens JWT

# Limites do sistema
MAX_INSTANCES=10                     # Máximo de instâncias
DOCKER_DIR=/path/to/supabase-core   # Diretório dos scripts

# Diagnóstico
ENABLE_AUTO_REPAIR=true             # Auto-correção ativa
DIAGNOSTIC_INTERVAL=300000          # Intervalo de diagnóstico (5min)
```

---

## 🎉 **CONCLUSÃO**

O **Ultrabase Instance Manager** é um sistema completo e robusto que transforma uma VPS em um "Supabase Cloud privado". Ele abstrai toda a complexidade do Docker e configuração, oferecendo uma experiência similar ao Supabase oficial, mas com total controle e isolamento.

**🎯 Casos de Uso Ideais**:
- **Agências de Desenvolvimento**: Múltiplos projetos de clientes isolados
- **Empresas**: Ambientes de dev/staging/prod separados  
- **Freelancers**: Portfolio de projetos independentes
- **Educação**: Instâncias isoladas para cada aluno
- **Testes**: Ambientes temporários para experimentos

**💪 Principais Benefícios**:
- ✅ **Zero Vendor Lock-in**: Controle total dos dados
- ✅ **Custos Previsíveis**: Uma VPS serve múltiplos projetos
- ✅ **Facilidade de Uso**: Interface familiar do Supabase
- ✅ **Isolamento Total**: Projetos completamente separados  
- ✅ **Auto-gestão**: Diagnóstico e correção automáticos

O sistema está pronto para uso em produção com todas as correções críticas implementadas do plano de análise original.