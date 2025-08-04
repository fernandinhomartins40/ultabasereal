#!/bin/bash

echo "🔍 DIAGNÓSTICO 502 BAD GATEWAY"
echo "=============================="

echo ""
echo "=== 1. Status PM2 ==="
pm2 status

echo ""
echo "=== 2. Logs da Aplicação (últimas 20 linhas) ==="
pm2 logs supabase-manager --lines 20

echo ""
echo "=== 3. Teste da Porta 3080 ==="
echo "Testando localhost:3080..."
curl -I http://localhost:3080/ 2>/dev/null || echo "❌ Porta 3080 não responde"

echo ""
echo "=== 4. Processos na Porta 3080 ==="
netstat -tlnp | grep :3080 || echo "❌ Nada rodando na porta 3080"

echo ""
echo "=== 5. Status do Nginx ==="
systemctl status nginx --no-pager -l

echo ""
echo "=== 6. Configuração do Nginx ==="
echo "Sites habilitados:"
ls -la /etc/nginx/sites-enabled/

echo ""
echo "Configuração ativa:"
cat /etc/nginx/sites-enabled/ultrabase 2>/dev/null || echo "❌ Configuração não encontrada"

echo ""
echo "=== 7. Teste da Configuração Nginx ==="
nginx -t

echo ""
echo "=== 8. Logs do Nginx (erros) ==="
tail -10 /var/log/nginx/error.log 2>/dev/null || echo "Sem logs de erro"

echo ""
echo "=== 9. Tentar Reiniciar Aplicação ==="
echo "Reiniciando aplicação..."
pm2 restart supabase-manager
sleep 5

echo ""
echo "=== 10. Teste Final ==="
echo "Testando novamente..."
curl -I http://localhost:3080/ 2>/dev/null && echo "✅ App respondendo" || echo "❌ App ainda não responde"