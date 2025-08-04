#!/bin/bash

# Use MANAGER variables if provided, otherwise generate defaults
if [ -n "$MANAGER_INSTANCE_ID" ]; then
    export INSTANCE_ID="$MANAGER_INSTANCE_ID"
else
    export INSTANCE_ID=$(date +%s)
fi

# Use MANAGER credentials if provided, otherwise generate defaults
if [ -n "$MANAGER_POSTGRES_PASSWORD" ]; then
    export POSTGRES_PASSWORD="$MANAGER_POSTGRES_PASSWORD"
else
    export POSTGRES_PASSWORD=$(openssl rand -hex 16)
fi

if [ -n "$MANAGER_JWT_SECRET" ]; then
    export JWT_SECRET="$MANAGER_JWT_SECRET"
else
    export JWT_SECRET=9f878Nhjk3TJyVKgyaGh83hh6Pu9j9yfxnZSuphb
fi

if [ -n "$MANAGER_ANON_KEY" ]; then
    export ANON_KEY="$MANAGER_ANON_KEY"
else
    export ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICJyb2xlIjogImFub24iLAogICJpc3MiOiAic3VwYWJhc2UiLAogICJpYXQiOiAxNzI3MjMzMjAwLAogICJleHAiOiAxODg0OTk5NjAwCn0.O0qBbl300xfJrhmW3YktijUJQ5ZW6OXVyZjnSwSCzCg
fi

if [ -n "$MANAGER_SERVICE_ROLE_KEY" ]; then
    export SERVICE_ROLE_KEY="$MANAGER_SERVICE_ROLE_KEY"
else
    export SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICJyb2xlIjogInNlcnZpY2Vfcm9sZSIsCiAgImlzcyI6ICJzdXBhYmFzZSIsCiAgImlhdCI6IDE3MjcyMzMyMDAsCiAgImV4cCI6IDE4ODQ5OTk2MDAKfQ.7KpglgDbGij2ich1kiVbzBj6Znz_S5anWm0iOemyS18
fi

if [ -n "$MANAGER_DASHBOARD_USERNAME" ]; then
    export DASHBOARD_USERNAME="$MANAGER_DASHBOARD_USERNAME"
else
    export DASHBOARD_USERNAME=admin
fi

if [ -n "$MANAGER_DASHBOARD_PASSWORD" ]; then
    export DASHBOARD_PASSWORD="$MANAGER_DASHBOARD_PASSWORD"
else
    export DASHBOARD_PASSWORD=$(openssl rand -hex 8)
fi

export POSTGRES_DB=postgres 

# Export necessary variables for kong.yml
export SUPABASE_ANON_KEY=${ANON_KEY}
export SUPABASE_SERVICE_KEY=${SERVICE_ROLE_KEY}

# Use MANAGER ports if provided, otherwise generate random ones
export POSTGRES_PORT=5432 

if [ -n "$MANAGER_POSTGRES_PORT_EXT" ]; then
    export POSTGRES_PORT_EXT="$MANAGER_POSTGRES_PORT_EXT"
else
    export POSTGRES_PORT_EXT=54$(shuf -i 10-99 -n 1)
fi

if [ -n "$MANAGER_KONG_HTTP_PORT" ]; then
    export KONG_HTTP_PORT="$MANAGER_KONG_HTTP_PORT"
else
    export KONG_HTTP_PORT=80$(shuf -i 10-99 -n 1)
fi

if [ -n "$MANAGER_KONG_HTTPS_PORT" ]; then
    export KONG_HTTPS_PORT="$MANAGER_KONG_HTTPS_PORT"
else
    export KONG_HTTPS_PORT=84$(shuf -i 10-99 -n 1)
fi

if [ -n "$MANAGER_ANALYTICS_PORT" ]; then
    export ANALYTICS_PORT="$MANAGER_ANALYTICS_PORT"
else
    export ANALYTICS_PORT=40$(shuf -i 10-99 -n 1)
fi

# Set values for required variables - use MANAGER_EXTERNAL_IP if provided
if [ -n "$MANAGER_EXTERNAL_IP" ]; then
    export API_EXTERNAL_URL="http://${MANAGER_EXTERNAL_IP}:${KONG_HTTP_PORT}"
    export SITE_URL="http://${MANAGER_EXTERNAL_IP}:3000"
    export SUPABASE_PUBLIC_URL="http://${MANAGER_EXTERNAL_IP}:${KONG_HTTP_PORT}"
else
    export API_EXTERNAL_URL="http://0.0.0.0:${KONG_HTTP_PORT}"
    export SITE_URL="http://0.0.0.0:3000"
    export SUPABASE_PUBLIC_URL="http://0.0.0.0:${KONG_HTTP_PORT}"
fi
if [ -n "$MANAGER_ORGANIZATION_NAME" ]; then
    export STUDIO_DEFAULT_ORGANIZATION="$MANAGER_ORGANIZATION_NAME"
else
    export STUDIO_DEFAULT_ORGANIZATION="YourOrganization"
fi

if [ -n "$MANAGER_PROJECT_NAME" ]; then
    export STUDIO_DEFAULT_PROJECT="$MANAGER_PROJECT_NAME"
else
    export STUDIO_DEFAULT_PROJECT="YourProject"
fi
export ENABLE_EMAIL_SIGNUP="true"
export ENABLE_EMAIL_AUTOCONFIRM="true"
export SMTP_ADMIN_EMAIL="your_email"
export SMTP_HOST="your_smtp_host"
export SMTP_PORT=2500
export SMTP_USER="your_smtp_user"
export SMTP_PASS="your_smtp_pass"
export SMTP_SENDER_NAME="your_sender_name"
export ENABLE_ANONYMOUS_USERS="true"
export JWT_EXPIRY=3600
export DISABLE_SIGNUP="false"
export IMGPROXY_ENABLE_WEBP_DETECTION="true"
export FUNCTIONS_VERIFY_JWT="false"
export DOCKER_SOCKET_LOCATION="/var/run/docker.sock"
export LOGFLARE_API_KEY="your_logflare_key"
export LOGFLARE_LOGGER_BACKEND_API_KEY="your_logflare_key"
export PGRST_DB_SCHEMAS=public,storage,graphql_public

# Substitute variables in .env.template and generate instance-specific .env
envsubst < .env.template > .env-${INSTANCE_ID}

# Substitute variables in docker-compose.yml and generate instance-specific docker-compose
envsubst < docker-compose.yml > docker-compose-${INSTANCE_ID}.yml

# Create volume directories for the instance
mkdir -p volumes-${INSTANCE_ID}/functions
mkdir -p volumes-${INSTANCE_ID}/logs
mkdir -p volumes-${INSTANCE_ID}/db/init
mkdir -p volumes-${INSTANCE_ID}/api  

# Copy necessary files to volume directories

## Copy all contents of the db folder, including subdirectories and specific files
if [ -d "volumes/db/" ]; then
  cp -a volumes/db/. volumes-${INSTANCE_ID}/db/
fi

## Copy function files (if any)
if [ -d "volumes/functions/" ]; then
  cp -a volumes/functions/. volumes-${INSTANCE_ID}/functions/
fi

## Substitute variables in vector.yml and copy to the instance directory
if [ -f "volumes/logs/vector.yml" ]; then
  envsubst < volumes/logs/vector.yml > volumes-${INSTANCE_ID}/logs/vector.yml
fi

## Substitute variables in kong.yml and copy to the instance directory
if [ -f "volumes/api/kong.yml" ]; then
  envsubst < volumes/api/kong.yml > volumes-${INSTANCE_ID}/api/kong.yml
else
  echo "Error: File volumes/api/kong.yml not found."
  exit 1
fi

# Start the instance containers
docker compose -f docker-compose-${INSTANCE_ID}.yml --env-file .env-${INSTANCE_ID} up -d
