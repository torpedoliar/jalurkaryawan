#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  SECRET=$(openssl rand -base64 48 | tr -d '\n')
  cat > .env <<EOF
APP_SECRET=${SECRET}
APP_DOMAIN=localhost
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')
EOF
  echo "wrote .env (APP_SECRET + POSTGRES_PASSWORD generated)"
else
  echo ".env already exists, skipping"
fi

mkdir -p certs
if [ ! -f certs/server.crt ]; then
  openssl req -x509 -newkey rsa:2048 -keyout certs/server.key -out certs/server.crt \
    -days 365 -nodes -subj "/CN=localhost"
  echo "generated self-signed TLS cert"
fi

echo "next steps:"
echo "  docker compose up -d --build"
echo "  docker compose exec api npx tsx prisma/seed.ts   # only for fresh dev DB"
