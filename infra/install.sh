#!/usr/bin/env bash
set -euo pipefail
# Windows Git Bash: stop MSYS rewriting /CN=localhost into a path (openssl -subj).
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
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
echo "  pnpm --filter @bms/web build  # from repo root, before compose up (nginx serves apps/web/dist)"
echo "  docker compose up -d --build"
echo "  docker compose exec api sh -c 'cd apps/api && npx tsx prisma/seed.ts'   # dev demo data, fresh DB only; WIPES ALL DATA, refuses if a Super Admin exists (add --force to re-seed)"
echo "  docker compose exec api sh -c 'cd apps/api && npx tsx prisma/seed.ts --scale'   # same + load-test set per spec §8: 20 routes / 50 buses / 2500 employees"
