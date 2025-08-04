#!/bin/bash

echo "🔍 DIAGNÓSTICO DO SERVIDOR ULTRABASE"
echo "===================================="
echo ""

# Verificar se aplicação está rodando
echo "1. STATUS DA APLICAÇÃO PM2:"
echo "----------------------------"
pm2 list
echo ""

echo "2. TESTE APLICAÇÃO PORTA 3080:"
echo "-------------------------------"
if curl -s http://localhost:3080/ >/dev/null 2>&1; then
    echo "✅ Aplicação responde na porta 3080"
    echo "📋 Resposta:"
    curl -s http://localhost:3080/ | head -5
else
    echo "❌ Aplicação NÃO responde na porta 3080"
    echo "📋 Logs da aplicação:"
    pm2 logs supabase-manager --lines 10
fi
echo ""

echo "3. STATUS DO NGINX:"
echo "-------------------"
systemctl status nginx --no-pager
echo ""

echo "4. CONFIGURAÇÃO NGINX:"
echo "----------------------"
echo "Sites habilitados:"
ls -la /etc/nginx/sites-enabled/
echo ""
echo "Conteúdo da configuração ultrabase:"
if [ -f /etc/nginx/sites-available/ultrabase ]; then
    cat /etc/nginx/sites-available/ultrabase
else
    echo "❌ Arquivo /etc/nginx/sites-available/ultrabase não existe!"
fi
echo ""

echo "5. TESTE CONFIGURAÇÃO NGINX:"
echo "-----------------------------"
nginx -t
echo ""

echo "6. TESTE NGINX VIA LOCALHOST:"
echo "------------------------------"
if curl -s http://localhost/ >/dev/null 2>&1; then
    echo "✅ Nginx responde"
    echo "📋 Resposta:"
    curl -s http://localhost/ | head -5
else
    echo "❌ Nginx NÃO responde"
fi
echo ""

echo "7. PORTAS EM USO:"
echo "-----------------"
netstat -tlnp | grep -E ":(80|3080|443)\s"
echo ""

echo "8. LOGS DO NGINX:"
echo "-----------------"
echo "Error log:"
tail -10 /var/log/nginx/error.log 2>/dev/null || echo "Sem logs de erro"
echo ""
echo "Access log:"
tail -5 /var/log/nginx/access.log 2>/dev/null || echo "Sem logs de acesso"
echo ""

echo "🔧 APLICAR CORREÇÃO IMEDIATA:"
echo "=============================="

# Criar configuração correta
echo "📝 Criando configuração do Nginx..."
cat > /etc/nginx/sites-available/ultrabase << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ultrabase.com.br www.ultrabase.com.br _;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    location /health {
        access_log off;
        return 200 "healthy";
        add_header Content-Type text/plain;
    }
}
EOF

# Remover configurações conflitantes
echo "🗑️ Removendo configurações conflitantes..."
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/ultrabase-instances

# Habilitar nossa configuração
echo "✅ Habilitando configuração ultrabase..."
ln -sf /etc/nginx/sites-available/ultrabase /etc/nginx/sites-enabled/

# Testar e recarregar
echo "🔍 Testando configuração..."
if nginx -t; then
    echo "✅ Configuração válida - recarregando Nginx..."
    systemctl reload nginx
    echo "✅ Nginx recarregado!"
    
    # Aguardar um pouco e testar
    sleep 3
    echo ""
    echo "🧪 TESTE FINAL:"
    echo "---------------"
    if curl -s http://localhost/ | grep -q "Ultrabase\|Supabase\|login\|dashboard"; then
        echo "✅ SUCCESS! Aplicação funcionando via Nginx"
    else
        echo "❌ Ainda mostra página padrão do Nginx"
        echo "📋 Resposta atual:"
        curl -s http://localhost/ | head -10
    fi
else
    echo "❌ Erro na configuração do Nginx:"
    nginx -t
fi

echo ""
echo "✅ Diagnóstico completo!"