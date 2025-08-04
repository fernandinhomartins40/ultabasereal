# 🔬 DIAGNÓSTICO COMPLETO - SUPABASE CORE & CONTAINERS

**Data**: 30/07/2025  
**Status**: Análise pós-rollback para IP:porta  
**Objetivo**: Identificar causa raiz dos containers unhealthy e erro 504  

---

## 🕵️ DIAGNÓSTICO IDENTIFICADO

### 🚨 **PROBLEMA PRINCIPAL**
Os containers ficam **unhealthy** devido a **dependências em cascata** e **healthchecks rigorosos**:

1. **Dependências Complexas**: Cada serviço depende de vários outros
2. **Healthchecks Restritivos**: Timeouts de 5s são muito baixos para inicialização
3. **Recursos Limitados**: VPS pode não ter recursos suficientes
4. **Sequência de Inicialização**: Ordem incorreta causa falhas em cascata

### 📊 **CONTAINERS PROBLEMÁTICOS IDENTIFICADOS**

#### 🔴 **supabase-storage (CRÍTICO)**
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5000/status"]
  timeout: 5s     # ⚠️ MUITO BAIXO
  interval: 5s    # ⚠️ MUITO FREQUENTE
  retries: 3      # ⚠️ MUITO POUCAS TENTATIVAS
```
**Problema**: Storage API demora mais que 5s para inicializar

#### 🔴 **supabase-studio (CRÍTICO)**
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/profile'...)"]
  timeout: 5s     # ⚠️ MUITO BAIXO para Node.js inicializar
```
**Problema**: Studio precisa compilar/inicializar Node.js + dependências

#### 🔴 **realtime (CRÍTICO)**
```yaml
healthcheck:
  test: ["CMD", "curl", "http://localhost:4000/api/tenants/realtime/health"]
  timeout: 5s     # ⚠️ MUITO BAIXO
```
**Problema**: Realtime precisa conectar ao banco antes de responder

#### 🔴 **pooler (CRÍTICO)**
```yaml
healthcheck:
  test: ["CMD", "curl", "http://localhost:4000/api/health"]
  timeout: 5s
  retries: 5
```
**Problema**: Pooler precisa estabelecer conexões com o banco

---

## 🎯 PLANOS DE CORREÇÃO

### 📋 **PLANO A - CORREÇÃO CONSERVADORA (RECOMENDADO)**
*Riscos: BAIXO | Eficácia: ALTA | Tempo: 15 minutos*

#### A1. Aumentar Timeouts dos Healthchecks
```yaml
# Para todos os serviços problemáticos:
healthcheck:
  timeout: 15s        # Era: 5s
  interval: 10s       # Era: 5s  
  retries: 6          # Era: 3
  start_period: 30s   # NOVO: Tempo de grace inicial
```

#### A2. Adicionar Start Period (Grace Time)
```yaml
# Permite que containers inicializem sem pressão
start_period: 30s  # 30 segundos sem healthcheck
```

#### A3. Ajustar Sequência de Inicialização
```yaml
# Garantir que serviços básicos subam primeiro
depends_on:
  db:
    condition: service_healthy
  analytics:
    condition: service_healthy
  # Remover dependências desnecessárias
```

#### A4. Otimizar Recursos
```yaml
# Adicionar limites mais realistas
deploy:
  resources:
    limits:
      memory: 512M
    reservations:
      memory: 256M
```

---

### 📋 **PLANO B - CORREÇÃO AGRESSIVA**
*Riscos: MÉDIO | Eficácia: MUITO ALTA | Tempo: 30 minutos*

#### B1. Implementar Tudo do Plano A +
#### B2. Remover Healthchecks Desnecessários
```yaml
# Para serviços não-críticos
# Comentar ou remover healthcheck completamente
```

#### B3. Usar Health Probe Externo
```yaml
# Script personalizado que verifica saúde
healthcheck:
  test: ["/app/health-probe.sh"]
  timeout: 30s
```

#### B4. Configurar Restart Policies
```yaml
restart: on-failure:3  # Limitar tentativas de restart
```

---

### 📋 **PLANO C - REDUÇÃO RADICAL (ÚLTIMO RECURSO)**
*Riscos: ALTO | Eficácia: GARANTIDA | Tempo: 10 minutos*

#### C1. Desabilitar Todos os Healthchecks
```yaml
# healthcheck:
#   disable: true
```

#### C2. Usar Depends_on Simples
```yaml
depends_on:
  - db  # Sem condition: service_healthy
```

#### C3. Monitoramento Manual
- Verificar containers via `docker ps`
- Implementar healthcheck no nível da aplicação

---

## 🛠️ IMPLEMENTAÇÃO RECOMENDADA

### 🚀 **ESTRATÉGIA GRADUAL**
1. **Início**: Implementar **PLANO A** primeiro
2. **Se falhar**: Adicionar elementos do **PLANO B**
3. **Emergência**: Usar **PLANO C** apenas se necessário

### 📁 **ARQUIVOS A MODIFICAR**
```
supabase-core/docker-compose.yml  # Principal
supabase-core/generate.bash       # Scripts auxiliares
```

### 🔧 **IMPLEMENTAÇÃO PRÁTICA**

#### Passo 1: Backup
```bash
cp docker-compose.yml docker-compose.yml.backup
```

#### Passo 2: Aplicar Mudanças
```yaml
# Exemplo para storage:
storage:
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:5000/status"]
    timeout: 15s          # ⬆️ Aumentado de 5s
    interval: 10s         # ⬆️ Reduzido de 5s
    retries: 6            # ⬆️ Aumentado de 3
    start_period: 30s     # 🆕 Novo parâmetro
```

#### Passo 3: Teste Gradual
```bash
# Testar um container por vez
docker-compose up storage
# Verificar se fica healthy
docker ps
```

---

## ⚠️ RISCOS E MITIGAÇÕES

### 🚨 **RISCOS IDENTIFICADOS**
1. **Healthchecks mais lentos** = detecção de falhas demorada
2. **Mais recursos usados** = possível impacto na VPS
3. **Dependências relaxadas** = serviços podem subir em ordem errada

### 🛡️ **MITIGAÇÕES**
1. **Monitoramento ativo** durante mudanças
2. **Rollback imediato** se houver degradação
3. **Testes incrementais** container por container

---

## 📊 MÉTRICAS DE SUCESSO

### ✅ **Critérios de Sucesso**
- [ ] Todos os containers ficam **healthy** em < 2 minutos
- [ ] Criação de instância funciona sem erro 504
- [ ] Sistema permanece estável por > 30 minutos
- [ ] Recursos da VPS não excedem 80%

### 📈 **Métricas de Monitoramento**
```bash
# Containers healthy
docker ps | grep -c healthy

# Tempo de inicialização
time docker-compose up -d

# Uso de recursos
docker stats --no-stream
```

---

## 🎯 RECOMENDAÇÃO FINAL

### 💡 **ABORDAGEM SUGERIDA**
1. **IMEDIATO**: Implementar **PLANO A** (conservador)
2. **MONITORAR**: Por 24h para estabilidade
3. **REFINAR**: Ajustar parâmetros conforme necessário
4. **DOCUMENTAR**: Configuração final que funcionar

### ⏰ **CRONOGRAMA**
- **Preparação**: 10 min (backup + análise)
- **Implementação**: 15 min (mudanças + teste)
- **Validação**: 30 min (criação de instância)
- **Monitoramento**: 24h (estabilidade)

### 🔄 **ROLLBACK PLAN**
```bash
# Se algo der errado:
cp docker-compose.yml.backup docker-compose.yml
docker-compose down
docker-compose up -d
```

---

**Próximos Passos**: Aguardar sua aprovação para implementar **PLANO A** ou outro plano de sua escolha.

---
**Criado**: 30/07/2025  
**Versão**: 1.0  
**Status**: ✅ Pronto para implementação