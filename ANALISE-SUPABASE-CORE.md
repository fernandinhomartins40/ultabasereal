# 🔍 Análise Completa: Supabase-Core e Sistema de Instâncias

**Data:** 04/08/2025  
**Objetivo:** Documentar funcionamento completo do sistema de criação de instâncias Supabase

## 📊 **Visão Geral**

O sistema **ultabasereal** é um **gerenciador de múltiplas instâncias Supabase** que permite criar, configurar e gerenciar várias instâncias isoladas do Supabase usando Docker Compose.

### 🎯 **Funcionalidade Principal**
- **1 Template** (`supabase-core/`) gera **N instâncias** isoladas
- Cada instância = Stack completa Supabase com portas únicas
- Interface web para gerenciar todas as instâncias
- Proxy reverso via Nginx para acesso por subdomínios

## 🗂️ **Estrutura do supabase-core/**

```
supabase-core/
├── generate.bash                 # 🔧 Script principal de geração
├── docker-compose.yml           # 🐳 Template do stack Supabase  
├── README.md                    # 📖 Documentação básica
├── dev/data.sql                 # 📝 Dados de desenvolvimento
└── volumes/                     # 📁 Templates de configuração
    ├── api/kong.yml            # 🚪 Configuração do gateway Kong
    ├── db/                     # 🗄️ Scripts de inicialização do PostgreSQL
    │   ├── init/data.sql       # 📊 Dados iniciais
    │   ├── jwt.sql             # 🔑 Configuração JWT
    │   ├── logs.sql            # 📋 Sistema de logs
    │   ├── realtime.sql        # ⚡ Realtime subscriptions
    │   ├── roles.sql           # 👥 Roles e permissões
    │   └── webhooks.sql        # 🔗 Sistema de webhooks
    ├── functions/              # ⚙️ Edge Functions
    │   ├── hello/index.ts      # 👋 Função exemplo
    │   └── main/index.ts       # 🎯 Função principal
    └── logs/vector.yml         # 📊 Configuração de logs (Vector)
```

## 🔧 **Script generate.bash - Análise Detalhada**

### **Seção 1: Geração de Variáveis (Linhas 1-118)**

#### 🆔 **ID da Instância**
```bash
# Usa MANAGER_INSTANCE_ID se fornecido, senão gera timestamp
export INSTANCE_ID=$(date +%s)  # Ex: 1725456789
```

#### 🔐 **Credenciais de Segurança**
```bash
# PostgreSQL
export POSTGRES_PASSWORD=$(openssl rand -hex 16)  # Senha aleatória 32 chars

# JWT (usado para autenticação)
export JWT_SECRET="9f878Nhjk3TJyVKgyaGh83hh6Pu9j9yfxnZSuphb"  # Fixo ou variável

# Chaves de API Supabase
export ANON_KEY="eyJhbGciOiJIUzI1NiI..."      # JWT para usuários anônimos
export SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiI..." # JWT para admin
```

#### 🌐 **Portas Dinâmicas**
```bash
# Cada instância recebe portas únicas aleatórias
export POSTGRES_PORT_EXT=54XX    # PostgreSQL externo: 5410-5499
export KONG_HTTP_PORT=80XX       # Kong HTTP: 8010-8099  
export KONG_HTTPS_PORT=84XX      # Kong HTTPS: 8410-8499
export ANALYTICS_PORT=40XX       # Analytics: 4010-4099
```

#### 🌍 **URLs e Configurações**
```bash
# URLs baseadas no IP externo
export API_EXTERNAL_URL="http://82.25.69.57:8045"  # Kong HTTP
export SUPABASE_PUBLIC_URL="http://82.25.69.57:8045"
export SITE_URL="http://82.25.69.57:3000"          # Studio URL
```

### **Seção 2: Geração de Arquivos (Linhas 119-155)**

#### 📄 **Arquivo .env personalizado**
```bash
envsubst < .env.template > .env-${INSTANCE_ID}
# Substitui todas as variáveis ${VARIAVEL} pelos valores gerados
```

#### 🐳 **Docker Compose personalizado**
```bash
envsubst < docker-compose.yml > docker-compose-${INSTANCE_ID}.yml
# Cria stack Docker específico da instância
```

#### 📁 **Diretórios de volumes**
```bash
# Cada instância tem seus próprios volumes isolados
mkdir -p volumes-${INSTANCE_ID}/functions
mkdir -p volumes-${INSTANCE_ID}/logs  
mkdir -p volumes-${INSTANCE_ID}/db/init
mkdir -p volumes-${INSTANCE_ID}/api
```

#### 🔄 **Cópia de arquivos de configuração**
```bash
# Database scripts
cp -a volumes/db/. volumes-${INSTANCE_ID}/db/

# Edge Functions  
cp -a volumes/functions/. volumes-${INSTANCE_ID}/functions/

# Logs config (com substituição de variáveis)
envsubst < volumes/logs/vector.yml > volumes-${INSTANCE_ID}/logs/vector.yml

# Kong Gateway config (com substituição de variáveis)
envsubst < volumes/api/kong.yml > volumes-${INSTANCE_ID}/api/kong.yml
```

### **Seção 3: Inicialização (Linha 157)**
```bash
# Sobe a stack completa da instância
docker compose -f docker-compose-${INSTANCE_ID}.yml --env-file .env-${INSTANCE_ID} up -d
```

## 🐳 **Docker Compose - Stack Supabase Completo**

### **Serviços da Stack (12 containers por instância):**

#### 1. **🎨 Studio** (`supabase-studio-${INSTANCE_ID}`)
- **Imagem:** `supabase/studio:20250113-83c9420`
- **Função:** Interface web do Supabase (Dashboard)
- **Porta interna:** 3000
- **Acesso:** Via Kong gateway

#### 2. **🚪 Kong** (`supabase-kong-${INSTANCE_ID}`)
- **Imagem:** `kong:2.8.1`  
- **Função:** API Gateway (proxy reverso, autenticação, CORS)
- **Portas:** `${KONG_HTTP_PORT}:8000`, `${KONG_HTTPS_PORT}:8443`
- **Configuração:** `/volumes-${INSTANCE_ID}/api/kong.yml`

#### 3. **🔐 Auth** (`supabase-auth-${INSTANCE_ID}`)
- **Imagem:** `supabase/gotrue:v2.167.0`
- **Função:** Sistema de autenticação (login, registro, JWT)
- **Porta interna:** 9999
- **Features:** Email/Phone signup, OAuth, JWT tokens

#### 4. **🌐 REST** (`supabase-rest-${INSTANCE_ID}`)
- **Imagem:** `postgrest/postgrest:v12.2.0`
- **Função:** API REST automática para PostgreSQL
- **Porta interna:** 3000
- **Schemas:** `public,storage,graphql_public`

#### 5. **⚡ Realtime** (`realtime-dev.supabase-realtime-${INSTANCE_ID}`)
- **Imagem:** `supabase/realtime:v2.34.7`
- **Função:** WebSocket para updates em tempo real
- **Porta interna:** 4000
- **Protocols:** WebSocket + HTTP

#### 6. **📦 Storage** (`supabase-storage-${INSTANCE_ID}`)
- **Imagem:** `supabase/storage-api:v1.14.5`
- **Função:** Sistema de arquivos (upload, download, transformação)
- **Porta interna:** 5000
- **Features:** Resize de imagens, S3 compatible

#### 7. **🖼️ ImgProxy** (`supabase-imgproxy-${INSTANCE_ID}`)
- **Imagem:** `darthsim/imgproxy:v3.8.0`
- **Função:** Redimensionamento e otimização de imagens
- **Porta interna:** 5001

#### 8. **🗄️ Meta** (`supabase-meta-${INSTANCE_ID}`)
- **Imagem:** `supabase/postgres-meta:v0.84.2`
- **Função:** API para metadados do PostgreSQL (esquemas, tabelas)
- **Porta interna:** 8080

#### 9. **⚙️ Functions** (`supabase-edge-functions-${INSTANCE_ID}`)
- **Imagem:** `supabase/edge-runtime:v1.67.0`
- **Função:** Edge Functions (serverless functions em Deno)
- **Volume:** `/volumes-${INSTANCE_ID}/functions`

#### 10. **📊 Analytics** (`supabase-analytics-${INSTANCE_ID}`)
- **Imagem:** `supabase/logflare:1.4.0`
- **Função:** Sistema de logs e analytics
- **Porta externa:** `${ANALYTICS_PORT}:4000`
- **Schema:** `_analytics`

#### 11. **🗃️ Database** (`supabase-db-${INSTANCE_ID}`)
- **Imagem:** `supabase/postgres:15.1.1.78`
- **Função:** PostgreSQL com extensões Supabase
- **Porta externa:** `${POSTGRES_PORT_EXT}:5432`
- **Volume persistente:** `/volumes-${INSTANCE_ID}/db/data`

#### 12. **📋 Vector** (`supabase-vector-${INSTANCE_ID}`)
- **Imagem:** `timberio/vector:0.28.1-alpine`
- **Função:** Coleta e roteamento de logs
- **Porta interna:** 9001
- **Config:** `/volumes-${INSTANCE_ID}/logs/vector.yml`

#### 13. **🔄 Supavisor** (`supabase-pooler-${INSTANCE_ID}`)
- **Imagem:** `supabase/supavisor:1.1.56`
- **Função:** Connection pooler para PostgreSQL
- **Portas:** `${POSTGRES_PORT}:5432`, `${POOLER_PROXY_PORT_TRANSACTION}:6543`

## 🌐 **Kong Gateway - Roteamento de APIs**

### **Configuração do kong.yml:**

#### **👥 Consumers (Usuários)**
```yaml
consumers:
  - username: DASHBOARD          # Interface web
  - username: anon              # Usuários anônimos 
    keyauth_credentials:
      - key: ${SUPABASE_ANON_KEY}
  - username: service_role      # Admin/Backend
    keyauth_credentials:
      - key: ${SUPABASE_SERVICE_KEY}
```

#### **🛣️ Routes Principais**
- **`/auth/v1/*`** → `auth:9999` (GoTrue - Autenticação)
- **`/rest/v1/*`** → `rest:3000` (PostgREST - API REST)
- **`/realtime/v1/*`** → `realtime:4000` (WebSocket)
- **`/storage/v1/*`** → `storage:5000` (Files)
- **`/functions/v1/*`** → `functions:9000` (Edge Functions)
- **`/analytics/v1/*`** → `analytics:4000` (Logs)
- **`/pg/*`** → `meta:8080` (Database metadata)
- **`/`** → `studio:3000` (Dashboard web)

## 🔄 **Fluxo de Criação de Instância**

### **1. Requisição na Interface Web**
```javascript
// Usuário clica "Criar Nova Instância" 
POST /api/instances
{
  "name": "MeuProjeto",
  "description": "Projeto teste"
}
```

### **2. Manager (server.js) processa**
```javascript
// Gera ID único e portas disponíveis
const instanceId = Date.now();
const ports = findAvailablePorts();

// Chama generate.bash via exec
const result = await exec(`bash supabase-core/generate.bash`, {
  env: {
    MANAGER_INSTANCE_ID: instanceId,
    MANAGER_POSTGRES_PORT_EXT: ports.postgres,
    MANAGER_KONG_HTTP_PORT: ports.kong,
    // ... outras variáveis
  }
});
```

### **3. generate.bash executa**
```bash
# 1. Gera configurações personalizadas
export INSTANCE_ID=1725456789
export POSTGRES_PORT_EXT=5445
export KONG_HTTP_PORT=8055

# 2. Cria arquivos da instância  
envsubst < docker-compose.yml > docker-compose-1725456789.yml
envsubst < .env.template > .env-1725456789

# 3. Cria volumes isolados
mkdir -p volumes-1725456789/{db,functions,logs,api}
cp -a volumes/db/. volumes-1725456789/db/

# 4. Inicia containers
docker compose -f docker-compose-1725456789.yml up -d
```

### **4. Resultado Final**
```
Nova instância ativa:
- ID: 1725456789
- PostgreSQL: localhost:5445  
- API: http://82.25.69.57:8055
- Dashboard: http://82.25.69.57:8055 (login: admin/senha)
- 13 containers rodando isoladamente
```

## 📊 **Isolamento de Instâncias**

### **Por Container:**
- **Nomes únicos:** `supabase-db-${INSTANCE_ID}`
- **Networks isolados:** `supabase-${INSTANCE_ID}_default`
- **Volumes próprios:** `volumes-${INSTANCE_ID}/`

### **Por Portas:**
- **Cada instância** = conjunto único de portas externas
- **Sem conflitos** = múltiplas instâncias na mesma máquina
- **Acesso isolado** = cada instância independente

### **Por Dados:**
- **Volumes separados** = dados completamente isolados
- **Bancos independentes** = zero interferência
- **Configurações próprias** = personalização individual

## 🗄️ **Persistência de Dados**

### **Volumes Persistentes por Instância:**
```
volumes-${INSTANCE_ID}/
├── db/data/              # 💾 Dados PostgreSQL persistentes
├── storage/              # 📁 Arquivos de storage  
├── functions/            # ⚙️ Edge Functions código
├── logs/                 # 📋 Logs da instância
└── api/kong.yml         # 🚪 Config Kong personalizada
```

### **Arquivos de Configuração:**
```
docker-compose-${INSTANCE_ID}.yml    # Stack Docker da instância
.env-${INSTANCE_ID}                  # Variáveis de ambiente
```

## 💡 **Pontos Importantes**

### ✅ **Pontos Fortes do Sistema:**
1. **Isolamento completo** - instâncias independentes
2. **Template único** - padronização e manutenção simples
3. **Portas dinâmicas** - sem conflitos
4. **Persistência garantida** - dados salvos corretamente
5. **Stack completa** - funcionalidade Supabase 100%

### ⚠️ **Pontos de Atenção:**
1. **Consumo de recursos** - cada instância = 13 containers
2. **Gerenciamento de portas** - range limitado 
3. **Backup complexo** - múltiplos volumes
4. **Monitoramento** - 13 containers × N instâncias

### 🔧 **Melhorias Possíveis:**
1. **Health checks** mais robustos por instância
2. **Auto-cleanup** de instâncias inativas  
3. **Resource limits** por container
4. **Logs centralizados** de todas as instâncias

## 🎯 **Conclusão**

O sistema **ultabasereal** é uma **solução robusta e bem arquitetada** para gerenciar múltiplas instâncias Supabase. O `generate.bash` é o coração do sistema, transformando um template em instâncias isoladas e funcionais.

**Arquitetura:** Template → Personalização → Isolamento → Deploy  
**Resultado:** N instâncias Supabase independentes e completas

---
*Análise completa realizada em 04/08/2025*  
*Sistema funcionando e estável para o core business*