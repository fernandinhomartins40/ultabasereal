# 🚀 OTIMIZAÇÃO PARA VPS DE BAIXA ESPECIFICAÇÃO

**Sua VPS**: 2 cores, 8GB RAM, 100GB disco  
**Objetivo**: Conseguir rodar 1-2 instâncias Supabase estáveis  

---

## 🎯 ESTRATÉGIA DE OTIMIZAÇÃO

### 📋 **FASE 1: REMOVER SERVIÇOS NÃO-ESSENCIAIS**

#### ❌ Serviços a DESABILITAR:
```yaml
# analytics (Logflare) - Economiza 256MB + 0.3 CPU
# realtime - Economiza 256MB + 0.5 CPU  
# storage - Economiza 256MB + 0.3 CPU
# vector - Economiza 64MB + 0.1 CPU
# imgproxy - Economiza 128MB + 0.2 CPU
```

#### ✅ Serviços ESSENCIAIS (manter):
```yaml
- db (PostgreSQL) - Obrigatório
- kong (Gateway) - Obrigatório
- auth (GoTrue) - Obrigatório  
- rest (PostgREST) - Obrigatório
- meta (Postgres Meta) - Obrigatório
- studio - Obrigatório para interface
```

### 📊 **RECURSOS ECONOMIZADOS:**
- **RAM**: ~960MB por instância  
- **CPU**: ~1.4 cores por instância
- **Nova necessidade**: ~1.5GB RAM + 2.1 CPU por instância

### 🎯 **NOVA CAPACIDADE:**
- **Instâncias simultâneas**: 2-3 estáveis
- **Margem de segurança**: Boa
- **Performance**: Aceitável para desenvolvimento/teste

---

## 📝 MODIFICAÇÕES NECESSÁRIAS

### 1️⃣ **docker-compose.yml Otimizado**

```yaml
name: supabase-${INSTANCE_ID}

services:
  # ✅ MANTER - PostgreSQL (Essencial)
  db:
    container_name: supabase-db-${INSTANCE_ID}
    image: supabase/postgres:15.1.1.78
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.8'
    # ... resto da config

  # ✅ MANTER - Kong Gateway (Essencial)  
  kong:
    container_name: supabase-kong-${INSTANCE_ID}
    image: kong:2.8.1
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.3'
    # ... resto da config

  # ✅ MANTER - Auth (Essencial)
  auth:
    container_name: supabase-auth-${INSTANCE_ID}
    image: supabase/gotrue:v2.167.0
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.2'
    # ... resto da config

  # ✅ MANTER - REST API (Essencial)
  rest:
    container_name: supabase-rest-${INSTANCE_ID}
    image: postgrest/postgrest:v12.2.0
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.2'
    # ... resto da config

  # ✅ MANTER - Meta (Essencial)
  meta:
    container_name: supabase-meta-${INSTANCE_ID}
    image: supabase/postgres-meta:v0.84.2
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.2'
    # ... resto da config

  # ✅ MANTER - Studio (Interface)
  studio:
    container_name: supabase-studio-${INSTANCE_ID}
    image: supabase/studio:20250113-83c9420
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.4'
    depends_on:
      - db
      - kong
      - auth
      - rest
      - meta
    # ... resto da config

  # ❌ REMOVER - Analytics (Logflare)
  # analytics: ...

  # ❌ REMOVER - Realtime  
  # realtime: ...

  # ❌ REMOVER - Storage
  # storage: ...

  # ❌ REMOVER - Vector
  # vector: ...

  # ❌ REMOVER - Imgproxy
  # imgproxy: ...

  # ❌ REMOVER - Pooler (se não essencial)
  # pooler: ...
```

### 2️⃣ **Otimizações do Sistema**

```bash
# /etc/sysctl.conf
vm.swappiness=1          # Usar swap apenas em emergência
vm.vfs_cache_pressure=50 # Otimizar cache do filesystem  
kernel.pid_max=4194304   # Mais PIDs disponíveis

# Limites do Docker
echo '{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "5m",
    "max-file": "2"  
  },
  "default-ulimits": {
    "memlock": {"hard": -1, "soft": -1}
  }
}' > /etc/docker/daemon.json
```

### 3️⃣ **Healthchecks Otimizados**

```yaml
# Para todos os serviços mantidos:
healthcheck:
  timeout: 20s       # Mais tempo  
  interval: 15s      # Menos frequente
  retries: 8         # Mais tentativas
  start_period: 45s  # Grace period maior
```

---

## 🎯 IMPLEMENTAÇÃO

### **Passo 1: Backup**
```bash
cd /opt/supabase-manager/supabase-core
cp docker-compose.yml docker-compose.yml.backup-original
```

### **Passo 2: Aplicar Versão Lite**
- Substituir docker-compose.yml pela versão otimizada
- Remover dependências dos serviços removidos
- Ajustar variáveis de ambiente

### **Passo 3: Testar**
```bash
# Testar criação de instância
# Monitorar recursos:
htop
docker stats
```

---

## 📊 MONITORAMENTO

### **Comandos Essenciais:**
```bash
# Recursos em tempo real
watch -n 2 'free -h && echo "---" && docker stats --no-stream'

# Load average (deve ficar < 2.0)
uptime

# Containers por instância  
docker ps | grep 11bb2d9f | wc -l
```

### **Sinais de Problema:**
- Load average > 2.5
- RAM usage > 85%  
- Swap usage > 100MB
- Containers reiniciando

---

## 🎯 RESULTADOS ESPERADOS

### ✅ **Com Otimização:**
- **1 instância**: Funcionamento estável
- **2 instâncias**: Funcionamento aceitável  
- **3+ instâncias**: Instável/lento

### 📈 **Benefícios:**
- Eliminação do erro 504
- Containers healthy consistentemente
- Resposta mais rápida
- Menor uso de disco e banda

### ⚠️ **Limitações:**
- Sem Storage API (upload de arquivos)
- Sem Realtime (websockets)  
- Sem Analytics (logs centralizados)
- Funcionalidade básica apenas

---

## 🔄 ROLLBACK

Se não funcionar:
```bash
cp docker-compose.yml.backup-original docker-compose.yml
docker-compose down
docker-compose up -d
```

---

**Recomendação**: Implementar esta otimização AGORA para resolver o problema atual, e planejar upgrade de VPS para o futuro quando precisar de mais instâncias.