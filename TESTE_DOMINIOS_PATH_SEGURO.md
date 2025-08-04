# 🛡️ TESTE SEGURO - REATIVAR DOMÍNIOS PATH

**Data**: 31/07/2025  
**Status**: Instâncias funcionando com IP:porta + Plano A aplicado  
**Objetivo**: Testar domínios path de forma controlada e segura  

---

## 📊 ESTADO ATUAL (FUNCIONANDO)

### ✅ **O QUE ESTÁ FUNCIONANDO**
- **Commit atual**: `c8b3b16` - Plano A implementado
- **Configuração**: IP:porta (sem paths)
- **Healthchecks**: Otimizados (timeout 15s, retries 6, start_period 30s)
- **Status**: Instâncias criando sem erro 504

### 🤔 **DÚVIDA ATUAL**
**O que resolveu o problema?**
- ✅ Plano A (healthchecks otimizados)?
- ✅ Rollback para IP:porta?
- ✅ Combinação dos dois?

---

## 🎯 ESTRATÉGIA DE TESTE SEGURO

### 📋 **FASE 1 - PREPARAÇÃO MÁXIMA**
1. **Backup completo do estado atual**
2. **Documentação detalhada de rollback**
3. **Identificação precisa dos arquivos de paths**

### 📋 **FASE 2 - TESTE MÍNIMO**
1. **Mudança isolada**: Apenas reativar paths
2. **Teste unitário**: Uma instância específica
3. **Validação imediata**: Funcionamento OK/NOK

### 📋 **FASE 3 - ROLLBACK OU EXPANSÃO**
- **Se OK**: Aplicar gradualmente
- **Se NOK**: Rollback imediato e documentar

---

## 🔧 IDENTIFICAÇÃO DOS ARQUIVOS DE PATHS

### 📁 **ARQUIVOS SUSPEITOS (A INVESTIGAR)**
```bash
# Buscar por configurações de paths/domínios
grep -r "path\|domain\|subdomain" --include="*.yml" --include="*.conf" --include="*.js" .
grep -r "proxy_pass\|location" --include="*.conf" .
```

### 🎯 **PROVÁVEIS LOCALIZAÇÕES**
- `nginx/` - Configurações de proxy
- `supabase-core/` - Configurações do Supabase
- Scripts de geração/deploy
- Variáveis de ambiente

---

## 🛡️ PROCEDIMENTO DE BACKUP COMPLETO

### 1️⃣ **Git Backup**
```bash
# Commit atual (ponto de restauração)
git log --oneline -1  # c8b3b16

# Tag de segurança
git tag -a "estado-funcionando-$(date +%Y%m%d-%H%M)" -m "Estado funcionando: IP:porta + Plano A"
git push --tags
```

### 2️⃣ **Backup de Arquivos Críticos**
```bash
# Backup de todos os arquivos de configuração
cp -r nginx/ nginx.backup-$(date +%Y%m%d-%H%M)/
cp -r supabase-core/ supabase-core.backup-$(date +%Y%m%d-%H%M)/
cp *.env *.env.backup-$(date +%Y%m%d-%H%M) 2>/dev/null || true
```

### 3️⃣ **Backup do Estado dos Containers**
```bash
# Estado atual dos containers
docker ps > containers-estado-$(date +%Y%m%d-%H%M).txt
docker compose -f supabase-core/docker-compose.yml ps >> containers-estado-$(date +%Y%m%d-%H%M).txt
```

---

## 🚨 PROCEDIMENTO DE ROLLBACK GARANTIDO

### ⚡ **ROLLBACK RÁPIDO (< 2 minutos)**
```bash
# 1. Voltar ao commit funcionando
git reset --hard c8b3b16
git push --force-with-lease

# 2. Restartar containers se necessário
cd supabase-core
docker compose down
docker compose up -d

# 3. Verificar
docker compose ps
```

### 🔍 **VALIDAÇÃO PÓS-ROLLBACK**
```bash
# Containers healthy
docker compose ps | grep -c "healthy"

# Teste de criação de instância
curl -X POST http://IP:PORTA/create-instance

# Logs de erro
docker compose logs --tail=50
```

---

## 🧪 PLANO DE TESTE CONTROLADO

### 📝 **PASSO 1 - IDENTIFICAR MUDANÇA MÍNIMA**
- [ ] Localizar arquivos que controlam paths vs IP:porta
- [ ] Identificar a menor mudança possível
- [ ] Preparar rollback específico para essa mudança

### 📝 **PASSO 2 - TESTE ISOLADO**
- [ ] Aplicar mudança apenas em ambiente de teste
- [ ] Testar criação de 1 instância específica
- [ ] Monitorar logs em tempo real

### 📝 **PASSO 3 - VALIDAÇÃO IMEDIATA**
- [ ] ✅ Instância cria sem erro 504?
- [ ] ✅ Containers permanecem healthy?
- [ ] ✅ Não há degradação de performance?

### 📝 **PASSO 4 - DECISÃO**
- **SE TUDO OK**: Continuar gradualmente
- **SE QUALQUER PROBLEMA**: Rollback imediato

---

## ⚠️ SINAIS DE ALERTA PARA ROLLBACK IMEDIATO

### 🚨 **ROLLBACK OBRIGATÓRIO SE**
- [ ] Erro 504 retorna
- [ ] Containers ficam unhealthy
- [ ] Tempo de resposta > 30s
- [ ] CPU/Memory > 90%
- [ ] Qualquer erro nos logs

### 📊 **MONITORAMENTO CONTÍNUO**
```bash
# Terminal 1: Status containers
watch -n 5 'docker compose ps'

# Terminal 2: Logs em tempo real
docker compose logs -f

# Terminal 3: Recursos
watch -n 5 'docker stats --no-stream'
```

## 🔍 ANÁLISE COMPLETA - ARQUIVOS IDENTIFICADOS

### 📁 **ARQUIVO CRÍTICO IDENTIFICADO**
**`src/server.js:85`** - A mudança mínima necessária:

```javascript
// LINHA 85 - ESTADO ATUAL (IP:porta)
} else if (false) { // ROLLBACK: Desabilitar paths temporariamente

// PARA TESTAR PATHS - MUDANÇA MÍNIMA
} else if (true) { // TESTE: Reabilitar paths
```

### 🎯 **MUDANÇA MÍNIMA IDENTIFICADA**
- **Arquivo**: `src/server.js`
- **Linha**: 85
- **Mudança**: `false` → `true`
- **Impacto**: Reabilita sistema de paths `/app/{instanceId}`

### 🛡️ **ROLLBACK EXATO**
```bash
# Se der problema, voltar:
sed -i 's/} else if (true) {/} else if (false) {/' src/server.js
# Ou git checkout src/server.js
```

### 📊 **CONFIGURAÇÃO ATUAL (FUNCIONANDO)**
- **Nginx**: Proxy tudo para localhost:3080 ✅
- **Server.js**: `useSubdomains: false` ✅
- **Server.js**: Paths desabilitados (`false`) ✅
- **Fallback**: IP:porta ativado ✅

---

## 📋 CHECKLIST PRE-TESTE

### ✅ **ANTES DE QUALQUER MUDANÇA**
- [ ] Backup completo realizado
- [ ] Tag git criada
- [ ] Procedimento de rollback testado
- [ ] Monitoramento ativo preparado
- [ ] Instâncias atuais funcionando confirmado

### ✅ **CONDIÇÕES PARA PROSSEGUIR**
- [ ] Todas as instâncias atuais OK
- [ ] Sistema estável por > 30 minutos
- [ ] Uso de recursos < 70%
- [ ] Commits atuais pushados
- [ ] Equipe informada sobre teste

---

## 🎯 PRÓXIMOS PASSOS SEGUROS

1. **AGORA**: Criar backups e identificar arquivos
2. **DEPOIS**: Localizar mudança mínima necessária  
3. **SÓ ENTÃO**: Aplicar teste controlado
4. **SEMPRE**: Rollback ao primeiro sinal de problema

---

**⚠️ LEMA DO TESTE**: "Funcionou? Ótimo. Não funcionou? Rollback em < 2 minutos."

---

**Próximo passo**: Aguardar aprovação para iniciar FASE 1 (Backup e identificação de arquivos)