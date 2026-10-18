import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Boots the compose Postgres (port 5433) and applies migrations once for the whole run. */
export default async function globalSetup() {
  execSync('docker compose -f ../../docker-compose.test.yml up -d --wait', { stdio: 'inherit' });
  // Task 1 has no schema yet (Task 2 creates prisma/schema.prisma) — skip until it exists.
  if (existsSync('prisma/schema.prisma')) {
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env } });
  }
}
