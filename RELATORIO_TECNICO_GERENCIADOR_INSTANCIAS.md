# Relatório Técnico - Gerenciador de Instâncias Supabase

## Visão Geral

O sistema **Ultrabase** é um gerenciador de instâncias Supabase que replica a experiência do Supabase Cloud, permitindo criar e gerenciar múltiplas instâncias Supabase isoladas em uma única VPS. O projeto foi desenvolvido para fornecer controles seguros, diagnósticos avançados e uma interface web intuitiva similar ao painel do Supabase.

## Arquitetura do Sistema

### Backend (Node.js/Express)

**Arquivo Principal:** `src/server.js` (47.824 tokens - aplicação robusta)

#### Características Principais:
- **Framework:** Express.js com middleware de segurança (helmet, cors)
- **Porta:** 3080 (configurável via `MANAGER_PORT`)
- **IP Externo:** 82.25.69.57 (VPS configurado)
- **WebSocket:** Suporte para comunicação em tempo real
- **Docker Integration:** Gerenciamento completo de containers via Dockerode

#### Funcionalidades Core:
1. **Gerenciamento de Instâncias**
   - Criação automática de instâncias Supabase isoladas
   - Controle de portas dinâmicas (início: 8100)
   - Configuração de volumes isolados por instância

2. **Sistema de Diagnóstico Avançado**
   - Health checker para monitoramento
   - Análise automática de logs
   - Histórico de diagnósticos
   - Diagnósticos programados
   - Sistema de auto-correção inteligente

3. **Gerenciamento Seguro**
   - SafeInstanceManager para operações críticas
   - Editor de configurações
   - Sistema de backup automatizado

### Frontend (HTML/CSS/JavaScript Vanilla)

#### Páginas Principais:

1. **Landing Page** (`src/public/landing.html`)
   - Página inicial promocional
   - Design responsivo com tema escuro
   - Interface moderna usando Lucide Icons

2. **Painel Administrativo** (`src/public/index.html`)
   - Dashboard principal de gerenciamento
   - Interface similar ao Supabase Cloud
   - Controles para criação e gestão de instâncias
   - Tema escuro por padrão

3. **Página de Login** (`src/public/login.html`)
   - Sistema de autenticação
   - Interface clean e profissional

#### Características do Frontend:
- **Design System:** Baseado no Supabase com cores personalizadas
- **Tema:** Suporte completo a dark/light mode
- **Responsividade:** Mobile-first design
- **Icons:** Lucide Icons para consistência visual
- **Fonts:** Inter (Google Fonts)

## Stack Tecnológica

### Backend Dependencies:
```json
{
  "bcrypt": "^5.1.1",           // Criptografia de senhas
  "cors": "^2.8.5",             // Cross-origin requests
  "dockerode": "^4.0.2",        // Docker API client
  "express": "^4.18.2",         // Web framework
  "fs-extra": "^11.2.0",        // File system utilities
  "helmet": "^7.1.0",           // Security middleware
  "jsonwebtoken": "^9.0.2",     // JWT authentication
  "multer": "^1.4.5-lts.1",     // File uploads
  "node-fetch": "^2.7.0",       // HTTP client
  "pg": "^8.11.3",              // PostgreSQL client
  "uuid": "^9.0.1",             // Unique identifiers
  "winston": "^3.11.0",         // Logging system
  "winston-daily-rotate-file": "^4.7.1", // Log rotation
  "ws": "^8.16.0"               // WebSocket support
}
```

### Frontend Stack:
- **HTML5** com estrutura semântica
- **CSS3** com custom properties (CSS variables)
- **JavaScript Vanilla** (sem frameworks)
- **Lucide Icons** para iconografia
- **Google Fonts (Inter)** para tipografia

## Sistema de Autenticação

### Implementação:
- **Método:** JWT (JSON Web Tokens) + bcrypt
- **Arquivo de Usuários:** `src/users.json`
- **Hash:** bcrypt com salt rounds = 12
- **Secret JWT:** Configurável via environment (`JWT_SECRET`)

### Segurança:
- Senhas hasheadas com bcrypt
- Tokens JWT para sessões
- Middleware de autenticação em rotas protegidas
- Validação de tokens em todas as operações sensíveis

### Usuário Padrão:
```json
{
  "admin": {
    "id": "admin",
    "role": "admin",
    "projects": ["*"],
    "created_at": "2025-07-28T15:02:42.409Z"
  }
}
```

## Sistema de Banco de Dados

### Arquitetura Multi-Database:

#### Banco Principal (Gerenciador):
- **Dados de Instâncias:** `src/instances.json` (arquivo JSON)
- **Usuários:** `src/users.json` (arquivo JSON)
- **Configuração:** Sistema de arquivos para metadados

#### Bancos das Instâncias Supabase:
Cada instância possui seu próprio stack completo:

```yaml
# Docker Compose por instância
services:
  - supabase-db-${INSTANCE_ID}     # PostgreSQL 15.1.1.78
  - supabase-studio-${INSTANCE_ID}  # Studio Interface
  - supabase-kong-${INSTANCE_ID}   # API Gateway
  - supabase-auth-${INSTANCE_ID}   # GoTrue Auth
  - supabase-rest-${INSTANCE_ID}   # PostgREST API
  - supabase-realtime-${INSTANCE_ID} # Realtime Engine
  - supabase-storage-${INSTANCE_ID}  # Storage API
  - supabase-analytics-${INSTANCE_ID} # Logflare Analytics
```

### Configuração de Banco por Instância:
- **Engine:** PostgreSQL 15.1.1.78 (imagem oficial Supabase)
- **Persistência:** Volumes Docker isolados
- **Extensões:** Todas as extensões Supabase incluídas
- **Pooling:** Supavisor para connection pooling
- **Backup:** Sistema automatizado de backup

## Configuração de Domínios

### Estratégia Atual:
- **Domínio Principal:** ultrabase.com.br
- **Método de Acesso:** IP:porta (http://82.25.69.57:PORT)
- **Subdomínios:** Desabilitados (requer wildcard DNS)
- **Paths:** Testados mas não implementados

### Configuração de Rede:
```javascript
const DOMAIN_CONFIG = {
  primary: 'ultrabase.com.br',
  alternatives: ['www.ultrabase.com.br'],
  allowedHosts: ['ultrabase.com.br', 'localhost', '82.25.69.57'],
  useSubdomains: false,
  instancePath: '/app'
};
```

## Sistema de Logs e Monitoramento

### Logging Structure:
- **Sistema:** Winston + winston-daily-rotate-file
- **Localização:** `src/logs/`
- **Tipos:**
  - `application-YYYY-MM-DD.log` - Logs gerais
  - `errors-YYYY-MM-DD.log` - Logs de erro
  - `instances-YYYY-MM-DD.log` - Logs de instâncias
  - `exceptions.log` - Exceções não capturadas
  - `rejections.log` - Promise rejections

### Monitoramento:
- Health checks automáticos para todas as instâncias
- Análise de logs em tempo real
- Sistema de alertas para falhas
- Diagnósticos programados

## Estrutura de Diretórios

```
src/
├── server.js                 # Servidor principal
├── package.json             # Dependências
├── instances.json           # Dados das instâncias
├── users.json              # Usuários do sistema
├── public/                 # Frontend
│   ├── index.html         # Dashboard principal
│   ├── landing.html       # Landing page
│   ├── login.html         # Página de login
│   └── logo_ultrabase.png # Assets
├── diagnostics/           # Sistema de diagnóstico
│   ├── health-checker.js
│   ├── log-analyzer.js
│   ├── diagnostic-history.js
│   ├── scheduled-diagnostics.js
│   ├── auto-repair/       # Auto-correção
│   └── interfaces/        # APIs de reparo
├── management/            # Gerenciamento seguro
│   ├── safe-manager.js
│   ├── config-editor.js
│   └── backup-system.js
├── utils/                # Utilitários
│   └── logger.js         # Sistema de logs
└── logs/                 # Logs do sistema
```

## Recursos de Segurança

### Medidas Implementadas:
1. **Helmet.js** - Headers de segurança HTTP
2. **CORS** configurado para domínios específicos
3. **JWT** para autenticação de sessões
4. **bcrypt** para hash de senhas (salt rounds: 12)
5. **Validação de entrada** em todas as rotas
6. **Rate limiting** (implícito via Docker)
7. **Logs de auditoria** completos

### Isolamento de Instâncias:
- Containers Docker isolados
- Volumes separados por instância
- Redes Docker independentes
- Portas únicas por instância

## Performance e Escalabilidade

### Otimizações:
- **Caching:** Cache de configurações em memória
- **Connection Pooling:** PostgreSQL com Supavisor
- **Log Rotation:** Rotação automática de logs
- **Health Checks:** Monitoramento proativo
- **Auto-repair:** Correção automática de problemas

### Limitações Atuais:
- Baseado em arquivos JSON para metadados
- Sem clustering horizontal
- Dependente de uma única VPS

## Conclusão

O sistema Ultrabase é uma implementação robusta e completa de um gerenciador de instâncias Supabase. Com uma arquitetura bem estruturada, sistema de autenticação seguro e interface intuitiva, oferece uma experiência próxima ao Supabase Cloud original. 

### Pontos Fortes:
- ✅ Sistema de diagnóstico avançado
- ✅ Interface moderna e responsiva
- ✅ Segurança robusta (JWT + bcrypt)
- ✅ Isolamento completo de instâncias
- ✅ Logs estruturados e monitoramento
- ✅ Sistema de backup automatizado

### Tecnologias-chave:
- **Backend:** Node.js + Express + Docker
- **Frontend:** HTML5 + CSS3 + JavaScript Vanilla
- **Database:** PostgreSQL (por instância) + JSON (metadados)
- **Autenticação:** JWT + bcrypt
- **Containers:** Docker + Docker Compose
- **Logs:** Winston + Daily Rotation

O projeto demonstra uma implementação profissional com foco em segurança, escalabilidade e experiência do usuário.