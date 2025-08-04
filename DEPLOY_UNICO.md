# 🚀 SISTEMA DE DEPLOY ÚNICO - ULTRABASE

**Sistema Unificado de Deploy com Versionamento e Preservação de Dados**

---

## 🎯 **FILOSOFIA DO DEPLOY ÚNICO**

Para evitar **conflitos, inconsistências e perda de dados**, o Ultrabase utiliza **apenas um sistema de deploy**:

### **✅ GitHub Actions - Deploy Incremental Inteligente**
- **Arquivo**: `.github/workflows/deploy-incremental.yml`
- **Trigger**: Push para branch `main`
- **Versionamento**: Automático a cada commit
- **Backup**: Automático antes de cada deploy
- **Análise**: Detecta tipo de mudança (código, dependências, config)

---

## 🛡️ **GARANTIAS DE SEGURANÇA**

### **📦 Backup Automático**
```yaml
# Antes de QUALQUER deploy
- Backup do instances.json (dados das instâncias)
- Backup rápido para deploys de código
- Backup completo para deploys full
```

### **🔍 Análise Inteligente**
```yaml
# O sistema detecta automaticamente:
- has_code_changes: true/false
- has_package_changes: true/false  
- has_config_changes: true/false
- needs_restart: true/false
```

### **⚡ Deploy Incremental**
```yaml
# Tipos de deploy:
- "code-only": Apenas código mudou
- "full": Dependências mudaram  
- "config-only": Apenas configuração
- "minimal": Apenas docs/workflows
```

---

## 🚀 **COMO FAZER DEPLOY**

### **1. Deploy Automático (Recomendado)**
```bash
# No seu ambiente local:
git add .
git commit -m "sua mensagem"
git push origin main

# GitHub Actions executa automaticamente:
# 1. Analisa mudanças
# 2. Faz backup dos dados
# 3. Deploy incremental inteligente
# 4. Preserva todas as instâncias
# 5. Verifica saúde do sistema
```

### **2. Deploy Manual (Emergência)**
```bash
# Apenas em emergências, via GitHub:
# 1. Ir para Actions tab
# 2. Selecionar "Deploy Incremental Inteligente"
# 3. Clicar "Run workflow"
# 4. Escolher branch e executar
```

---

## 📊 **VERSIONAMENTO AUTOMÁTICO**

### **🏷️ Cada Deploy Gera:**
- **Commit Hash**: Identificação única
- **Timestamp**: Data/hora exata
- **Backup ID**: Identificador do backup
- **Deploy Type**: Tipo de alteração

### **📋 Rastreabilidade Completa:**
```
Deploy #47 - 2025-01-29 15:30:22
├── Commit: a1b2c3d4e5f6...
├── Type: code-only
├── Backup: backup_20250129_153022  
├── Changes: src/server.js, src/public/index.html
└── Status: ✅ Success
```

---

## 🛡️ **PRESERVAÇÃO DE DADOS GARANTIDA**

### **💾 O que é SEMPRE preservado:**

1. **instances.json**
   - Configurações de todas as instâncias
   - Credenciais e portas
   - Status das instâncias

2. **Volumes Docker**
   - Dados do PostgreSQL de cada instância
   - Arquivos do Storage
   - Logs das aplicações

3. **Configurações do Sistema**
   - users.json (usuários do manager)
   - Configurações do Nginx
   - Certificados SSL

### **🔄 Processo de Preservação:**
```yaml
1. Backup dos dados críticos → /tmp/instances_backup.json
2. Git pull das mudanças
3. Restaurar dados preservados → src/instances.json
4. Verificar integridade dos dados
5. Restart apenas se necessário
```

---

## ⚠️ **REGRAS IMPORTANTES**

### **🚫 NÃO FAÇA:**
- ❌ **SSH manual na VPS** para alterar código
- ❌ **Git pull manual** na VPS  
- ❌ **Editar arquivos diretamente** na VPS
- ❌ **PM2 restart manual** (sem backup)

### **✅ SEMPRE FAÇA:**
- ✅ **Commit local** → **Push** → **Deploy automático**
- ✅ **Testes locais** antes do commit
- ✅ **Commits descritivos** para rastreabilidade
- ✅ **Verificar logs** após deploy

---

## 🔍 **MONITORAMENTO E LOGS**

### **📊 Verificar Status do Deploy:**
```bash
# Ver últimos deploys:
https://github.com/seu-repo/actions

# Verificar aplicação:
https://ultrabase.com.br

# Logs em tempo real (se necessário):
ssh root@82.25.69.57 "pm2 logs ultrabase"
```

### **🩺 Health Checks Automáticos:**
- ✅ PM2 process rodando
- ✅ Aplicação responde na porta 3080
- ✅ Nginx proxy funcionando
- ✅ Instâncias preservadas
- ✅ SSL ativo

---

## 🎯 **VANTAGENS DO SISTEMA ÚNICO**

### **🛡️ Segurança Máxima**
- Backup antes de cada deploy
- Versionamento completo
- Rollback via git reset
- Verificação automática

### **⚡ Eficiência**
- Deploy apenas do que mudou
- Sem restart desnecessário
- Preservação de conexões ativas
- Tempo de downtime mínimo

### **📋 Rastreabilidade**
- Histórico completo no GitHub
- Logs detalhados de cada deploy
- Identificação de problemas
- Facilita debugging

### **🤝 Colaboração**
- Todos os devs usam mesmo processo
- Sem conflitos entre deploy styles
- Histórico centralizado
- Code review antes do deploy

---

## 🚨 **EMERGÊNCIAS E ROLLBACK**

### **🔄 Rollback Via Git:**
```bash
# Se algo der errado, rollback via GitHub Actions:
1. Identifique o commit bom anterior
2. Faça git revert ou git reset
3. Push para main
4. GitHub Actions deployconta automaticamente a versão anterior
```

### **🛠️ Recuperação de Dados:**
```bash
# Dados das instâncias são preservados em:
- /tmp/instances_backup.json (backup rápido)
- /opt/supabase-manager-backups/ (backups completos)
```

---

## 📞 **SUPORTE E TROUBLESHOOTING**

### **⚠️ Se Deploy Falhar:**
1. **Verificar logs** no GitHub Actions
2. **Corrigir problema** localmente
3. **Commit + Push** da correção
4. **Deploy automático** da correção

### **🆘 Se Aplicação Parar:**
- O próprio deploy tem **auto-diagnóstico**
- Reinicia automaticamente serviços falhados
- Corrige configurações básicas
- Relatório detalhado de problemas

---

## 🎉 **CONCLUSÃO**

O **Deploy Único** garante:
- ✅ **Zero conflitos** entre sistemas
- ✅ **Versionamento completo** e automático  
- ✅ **Preservação total** dos dados das instâncias
- ✅ **Rastreabilidade** completa de mudanças
- ✅ **Confiabilidade** máxima em produção

**Uma única fonte da verdade, uma única forma de deploy, zero problemas!** 🚀