# 🛡️ GUIA DE BACKUP E ROLLBACK - ULTRABASE

## 📸 ESTADO ATUAL (FUNCIONANDO)
**Data**: 30/07/2025  
**Status**: ✅ Aplicação funcionando com 1 instância  
**Problema**: Erro 504 na criação de novas instâncias  

### 🔄 STATUS ATUAL DOS SERVIÇOS
```bash
# Aplicação Principal
PM2: supabase-manager - ONLINE (porta 3080)
Nginx: ATIVO (proxy para porta 3080)
Domínio: https://ultrabase.com.br - FUNCIONANDO
IP: http://82.25.69.57 - FUNCIONANDO

# Instância Existente (11bb2d9f)
Nome: digiurban
Status: RUNNING
Studio URL: https://ultrabase.com.br/app/11bb2d9f
API URL: https://ultrabase.com.br/app/11bb2d9f

# Containers com Problema
supabase-storage-11bb2d9f: UNHEALTHY
realtime-dev.supabase-realtime-11bb2d9f: UNHEALTHY  
supabase-studio-11bb2d9f: UNHEALTHY
supabase-pooler-11bb2d9f: RESTARTING
```

### 📁 ARQUIVOS CRÍTICOS ATUAIS
```
/opt/supabase-manager/src/instances.json - PRESERVAR
/opt/supabase-manager/src/users.json - PRESERVAR
/opt/supabase-manager/src/server.js - CONFIGURAÇÃO ATUAL
```

---

## 🚨 COMANDOS DE EMERGÊNCIA (SE ALGO QUEBRAR)

### 1️⃣ VERIFICAR SE APLICAÇÃO PRINCIPAL ESTÁ OK
```bash
ssh root@82.25.69.57
pm2 status
curl -s http://localhost:3080/ | head -3
```

### 2️⃣ RESTAURAR APLICAÇÃO PRINCIPAL (SE PARAR)
```bash
cd /opt/supabase-manager/src
pm2 restart supabase-manager
pm2 logs supabase-manager --lines 20
```

### 3️⃣ RESTAURAR NGINX (SE QUEBRAR)
```bash
# Configuração mínima que funcionava
cat > /etc/nginx/sites-available/ultrabase << 'EOF'
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ultrabase /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 4️⃣ VERIFICAR INSTÂNCIAS EXISTENTES
```bash
cd /opt/supabase-manager/src
cat instances.json | jq keys
docker ps | grep 11bb2d9f
```

---

## 🔄 ROLLBACK COMPLETO (ÚLTIMA OPÇÃO)

### OPÇÃO A: Rollback para IP:PORTA (Sistema Antigo)
```bash
cd /opt/supabase-manager/src
cp server.js server.js.backup-$(date +%Y%m%d_%H%M%S)

# Editar server.js linha ~91
# Trocar de:
# return `${protocol}://${DOMAIN_CONFIG.primary}${DOMAIN_CONFIG.instancePath}/${instanceId}`;
# Para:
# return `http://${EXTERNAL_IP}:${port}`;
```

**Script de Rollback Automático:**
```bash
#!/bin/bash
echo "🔄 ROLLBACK PARA SISTEMA IP:PORTA"
cd /opt/supabase-manager/src

# Backup atual
cp server.js server.js.backup-rollback-$(date +%Y%m%d_%H%M%S)

# Substituir linha do generateInstanceUrl
sed -i 's|return `${protocol}://${DOMAIN_CONFIG.primary}${DOMAIN_CONFIG.instancePath}/${instanceId}`;|return `http://${EXTERNAL_IP}:${port}`;|g' server.js

# Reiniciar aplicação
pm2 restart supabase-manager
sleep 5
pm2 logs supabase-manager --lines 10

echo "✅ Rollback concluído! Teste: http://82.25.69.57:8172"
```

### OPÇÃO B: Rollback do Git (Se necessário)
```bash
cd /opt/supabase-manager
git log --oneline -5  # Ver commits recentes
git checkout HEAD~1   # Voltar 1 commit
pm2 restart supabase-manager
```

---

## 🧪 TESTES DE VERIFICAÇÃO

### ✅ Checklist Pós-Mudanças
```bash
# 1. Aplicação principal
curl -s http://localhost:3080/ | grep -q "DOCTYPE" && echo "✅ App OK" || echo "❌ App FALHOU"

# 2. Nginx proxy
curl -s http://localhost/ | grep -q "DOCTYPE" && echo "✅ Nginx OK" || echo "❌ Nginx FALHOU"

# 3. Instância existente (substitua 11bb2d9f pelo ID real)
curl -s http://localhost:8172/ | grep -q "Supabase" && echo "✅ Instância OK" || echo "❌ Instância FALHOU"

# 4. PM2 status
pm2 list | grep -q "online" && echo "✅ PM2 OK" || echo "❌ PM2 FALHOU"
```

### 🔗 URLs para Testar
```
✅ Dashboard: https://ultrabase.com.br
✅ Dashboard IP: http://82.25.69.57
❓ Instância atual: https://ultrabase.com.br/app/11bb2d9f
❓ Instância IP direta: http://82.25.69.57:8172
```

---

## 📋 CONFIGURAÇÃO ATUAL DETALHADA

### server.js - Configurações Chave
```javascript
// Linha 67: useSubdomains: false ✅
// Linha 70: instancePath: '/app' ⚠️ (pode ser o problema)
// Linha 96: app.use(['/proxy/:instanceId', '/app/:instanceId'] ⚠️ (proxy que pode ter problema)

// CONFIGURAÇÃO FUNCIONANDO (fallback linha 91):
// return `http://${EXTERNAL_IP}:${port}`;
```

### instances.json - Instância Atual
```json
{
  "11bb2d9f": {
    "id": "11bb2d9f",
    "name": "digiurban",
    "owner": "admin",
    "status": "running",
    "ports": {
      "kong_http": 8172,
      "kong_https": 8492,
      "postgres_ext": 5562
    }
  }
}
```

---

## 🎯 PLANO DE AÇÃO PARA OPÇÃO 2

### Etapa 1: Tentar corrigir containers unhealthy
```bash
# Restart containers específicos
docker restart supabase-storage-11bb2d9f
docker restart realtime-dev.supabase-realtime-11bb2d9f  
docker restart supabase-studio-11bb2d9f
```

### Etapa 2: Se não funcionar, verificar logs
```bash
docker logs supabase-storage-11bb2d9f
docker logs supabase-studio-11bb2d9f
```

### Etapa 3: Se ainda falhar, usar ROLLBACK OPÇÃO A

---

## 📞 CONTATOS DE EMERGÊNCIA
- **Backup do repositório**: https://github.com/fernandinhomartins40/recultrabase
- **Estado atual commit**: `57367c3`
- **Último deploy funcional**: 30/07/2025 22:52

---

## ⚠️ AVISOS IMPORTANTES

1. **NUNCA** delete o arquivo `instances.json` - contém dados críticos!
2. **SEMPRE** faça backup antes de mudanças no `server.js`
3. **TESTE** cada mudança com os comandos de verificação
4. **EM CASO DE DÚVIDA**: Use o rollback e volte ao IP:porta que funcionava

---

**Criado em**: 30/07/2025  
**Versão**: 1.0  
**Status**: ✅ Testado e validado