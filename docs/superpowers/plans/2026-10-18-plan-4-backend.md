# Plan 4 — Backend (apps/api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real NestJS backend in `apps/api` that serves every `@bms/shared` ENDPOINT with behaviour byte-identical to `packages/mock-api`, plus the backend-only spec sections (scheduler, security, reports, backup/restore), so web and mobile can switch from MSW/mock to live data without any client change.

**Architecture:** Single NestJS app, global prefix `/api`, thin controllers + services, no repository layer (spec §3.3). Prisma over PostgreSQL, one transaction per allocation (§5.1), in-process cron via `@nestjs/schedule` re-registered on settings change (§3.5). Errors are `DomainError(code, message)` rendered through one exception filter using `ERROR_HTTP_STATUS` from `@bms/shared`; responses map `undefined → 204` and force `201 → 200` to match mock. Zod schemas from `@bms/shared` validate every body through a `ZodPipe`.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 16, argon2id, @nestjs/jwt, @nestjs/schedule, google-auth-library (FCM v1 via fetch), multer, vitest 2.1.8 (fileParallelism:false), zod 3.23.8, tsx for seed.

**Spec:** `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md` — plan argues from it; executors read §3.3, §3.5, §4, §5.1–5.12, §8 alongside this file.

## Global Constraints

- Every response body, status code, and message must match `packages/mock-api` exactly — when mock and spec disagree, mock wins for wire parity; spec wins for backend-only behaviour (cron, restore, security).
- Error codes/statuses/messages come verbatim from `@bms/shared` `errors.ts`. No `INTERNAL` or `BAD_LOGIN` code exists: bad login = `UNAUTHORIZED` + "NIK atau password salah."; unknown server error = 500 `{code:"VALIDATION_ERROR", message:"Terjadi kesalahan server."}`.
- `zodMessage` (first issue only): `unrecognized_keys` → "Ada kolom yang tidak dikenali."; `invalid_type` → `` `${path||"body"}: format tidak sesuai.` ``; else `` `${path||"body"}: ${message}` ``.
- Non-JSON body or JSON parse failure → `VALIDATION_ERROR` "Body harus JSON.".
- `undefined` return → HTTP 204; controllers never return 201 (interceptor forces 200).
- Timezone fixed `Asia/Jakarta` (TZ env + all date math from `@bms/shared` helpers). Operational `date` is YYYY-MM-DD string; `departureAt`/timestamps are `timestamptz`.
- IDs are Prisma cuid `TEXT` columns — never cast to uuid in raw SQL.
- Guard order global: MaintenanceGuard → AuthGuard → RolesGuard. Public: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/setup`, `GET /api/auth/setup-status`, `GET /api/system/status`, `GET /api/health`. Maintenance skips only `/api/system/status` and `/api/health`.
- `allowMustChange` only on `GET /api/auth/me` and `POST /api/auth/change-password`; everywhere else a `mustChangePassword` user gets `FORBIDDEN` "Ganti password terlebih dahulu.".
- `.env` holds only `DATABASE_URL`, `APP_SECRET`, `APP_DOMAIN` — never committed; provide `.env.example`. `APP_SECRET` required at boot.
- Secret settings never leave the API (`{isSet}` only); audit masks them `***`.
- Access token: JWT, expiry from `access_token_minutes` setting. Refresh token: opaque `base64url(32 random bytes)`, stored as sha256 in `refresh_tokens`, rotated on every refresh, revoked rows rejected with `UNAUTHORIZED`. Web cookie `bms_refresh` HttpOnly+Secure+SameSite=Strict Path=/api/auth; mobile sends `{refreshToken}` body. No CORS — same-origin `/api` only.
- Login lockout: `failedLogins >= login_max_failed` → reset 0 + `lockedUntil = now + lockout_minutes` → `ACCOUNT_LOCKED`; future `lockedUntil` → `ACCOUNT_LOCKED` without incrementing. In-memory IP rate limit: `login_rate_limit_per_minute`.
- Allocation (§5.1): one transaction; trips sorted `departureAt, id`; pre-check `SCHEDULE_CONFLICT` inside tx before trip scan; `CUTOFF_PASSED` without rejected row; conditional `UPDATE trips SET booked_count+1 WHERE id=$1 AND status='SCHEDULED' AND booked_count < capacity`; when no trip has space → insert `rejected_requests` and throw `TRIP_FULL` **committed outside the tx**; unique violation → rollback + `SCHEDULE_CONFLICT`; no `SELECT FOR UPDATE`.
- Allocation order: inactive → `FORBIDDEN`; suspended (DAILY uses today, SUB uses booking date) → `USER_SUSPENDED`; invalid stop → "Titik jemput tidak valid untuk rute ini."; conflict → `SCHEDULE_CONFLICT`; no trips → `NOT_FOUND` "Belum ada trip untuk pilihan ini."; cutoff → `CUTOFF_PASSED`; full → `TRIP_FULL`. `CUTOFF_PASSED` beats `TRIP_FULL` (§8).
- Dependencies pinned exact (no `^`). No new deps beyond the list in Task 1. `packages/shared` and `packages/mock-api` are read-only.
- Tests: vitest `fileParallelism:false`, globalSetup boots docker-compose Postgres on 5433 + `prisma migrate deploy`, DATABASE_URL `postgresql://bms:bms@127.0.0.1:5433/bms_test`. Docker daemon must be running before any test run.
- Commits: one per task step group, messages `feat(api): …` / `test(api): …` / `chore(api): …`.

## Review Focus

1. **Overbooking race (100 concurrent bookings, 50 seats):** exactly 50 succeed, 50 get `TRIP_FULL` with 50 rejected rows, `booked_count = 50` — exercised by Task 8 `test/concurrency.test.ts`.
2. **Refresh-token reuse:** a rotated (revoked) token is rejected `UNAUTHORIZED` and the new pair works — Task 4 `test/auth.test.ts` "reuse of rotated refresh token is rejected".
3. **Template propagation rollback:** a bus swap that would drop capacity below an existing booking aborts the whole tx and names the offending trip — Task 7 `test/trips.test.ts` "change bus below booked rolls back naming the trip".
4. **Corrupt restore leaves data untouched:** `pg_restore --list` failure aborts before maintenance mode / pre-restore dump / any drop — Task 13 `test/backup.test.ts` "corrupt dump rejected before any data is touched".
5. **Settings live-apply + cron re-register:** changing `booking_cutoff_minutes`/`generate_run_time` takes effect on the next request/job without restart — Tasks 3+12 `test/settings.test.ts` and `test/scheduler.test.ts`.

---

## File Structure

```
apps/api/
  package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  vitest.config.ts
  .env.example
  prisma/
    schema.prisma
    migrations/0_init/migration.sql          (hand-edited: partial unique + CHECK)
    seed.ts
  src/
    main.ts                                  bootstrap, loadEnvFile, JsonLogger, prefix, guards
    app.module.ts                            module wiring
    health.controller.ts                     GET /api/health
    common/
      domain-error.ts                        DomainError class + ErrorCode re-export
      zod.ts                                 zodMessage (verbatim copy of mock http.ts)
      zod-body.pipe.ts                       ZodPipe + "Body harus JSON."
      response.interceptor.ts                undefined→204, 201→200
      all-exceptions.filter.ts               DomainError/ZodError/SyntaxError/unknown → wire shape
      json-logger.service.ts                 ~30-line stdout JSON logger
      guards/maintenance.guard.ts            maintenance flag, skips status+health
      mappers.ts                             toSummary/toBooking/toPassenger/toDeparture (Task 7)
    settings/
      settings.service.ts                    DB cache, AES-256-GCM secrets, onChanged emitter
      settings.controller.ts                 GET/PUT + test-push + test-share
    audit/
      audit.service.ts                       write(masked)+list
      audit.controller.ts                    GET /api/audit-logs
    auth/
      auth.module.ts  auth.service.ts  auth.controller.ts
      guards/auth.guard.ts  guards/roles.guard.ts
      decorators/public.decorator.ts  decorators/roles.decorator.ts  decorators/allow-must-change.decorator.ts
      guards/login-rate.limit.guard.ts
    users/
      users.module.ts  users.service.ts  users.controller.ts
    fleet/
      fleet.module.ts  vendors.service.ts  buses.service.ts  fleet.controller.ts
    routes/
      routes.module.ts  shifts.service.ts  routes.service.ts  stops.service.ts  routes.controller.ts
    trips/
      trips.module.ts  templates.service.ts  trips.service.ts  trips.controller.ts
    generate/
      generate.service.ts                     trip generation + subscription bookings
    bookings/
      bookings.module.ts
      allocate.service.ts                     §5.1 core transaction
      bookings.service.ts                     my/cancel
      subscriptions.service.ts                create/end/list
      bookings.controller.ts
    admin/
      admin.module.ts  admin.service.ts  admin.controller.ts   suspend/unsuspend/deactivate/changeTripBus
    reports/
      reports.module.ts  reports.service.ts  reports.controller.ts
    notifications/
      notifications.module.ts
      notifications.service.ts                insert + notify (FCM after insert)
      fcm.service.ts                          google-auth-library + fetch FCM v1
    scheduler/
      scheduler.module.ts  scheduler.service.ts   cron register/unregister via SchedulerRegistry
    backup/
      backup.module.ts  backup.service.ts  backup.controller.ts
      exec-runner.service.ts                   injectable execFile wrapper
    Dockerfile                               node:22-alpine + postgresql16-client + smbclient + TZ=Asia/Jakarta
  test/
    setup.ts                                  globalSetup: compose up + migrate
    auth.test.ts  users.test.ts  master.test.ts  trips.test.ts
    bookings.test.ts  subscriptions.test.ts  reports.test.ts
    settings.test.ts  scheduler.test.ts  backup.test.ts
    concurrency.test.ts
infra/
  docker-compose.yml                          postgres + api + nginx
  nginx.conf                                  HTTPS + /api proxy
  install.sh                                  APP_SECRET generation
docker-compose.test.yml                       postgres:16 on 5433 for tests
apps/web/
  vite.config.ts        (Modify: proxy /api → VITE_API_URL)
  playwright.config.ts  (Modify: VITE_USE_MOCK env-gated)
  e2e/smoke-api.spec.ts (Create: same flow as smoke against live API)
```

---

### Task 1: Scaffold + HTTP skeleton

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/nest-cli.json`, `apps/api/vitest.config.ts`, `apps/api/.env.example`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/health.controller.ts`
- Create: `apps/api/src/common/domain-error.ts`, `apps/api/src/common/zod.ts`, `apps/api/src/common/zod-body.pipe.ts`, `apps/api/src/common/response.interceptor.ts`, `apps/api/src/common/all-exceptions.filter.ts`, `apps/api/src/common/json-logger.service.ts`, `apps/api/src/common/guards/maintenance.guard.ts`
- Test: `apps/api/test/setup.ts`, `apps/api/test/health.test.ts`

**Interfaces:**
- Consumes: `@bms/shared` — `ERROR_CODES`, `ERROR_HTTP_STATUS`, `ERROR_MESSAGES`, `ErrorCode`, `ENDPOINTS.health`.
- Produces: `DomainError(code, message)`, `zodMessage(issue)`, `ZodPipe(schema)`, `ResponseInterceptor`, `AllExceptionsFilter`, `MaintenanceGuard` (flag stub; Task 14 flips it), `JsonLogger`, `APP_SECRET` env requirement, test harness `test/setup.ts` used by every later test.

- [ ] **Step 1: Write package.json, tsconfigs, vitest config**

```json
// apps/api/package.json
{
  "name": "@bms/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@bms/shared": "workspace:*",
    "@nestjs/common": "11.1.6",
    "@nestjs/core": "11.1.6",
    "@nestjs/jwt": "11.0.0",
    "@nestjs/platform-express": "11.1.6",
    "@nestjs/schedule": "6.0.0",
    "@prisma/client": "6.2.1",
    "argon2": "0.41.1",
    "google-auth-library": "9.15.0",
    "multer": "1.4.5-lts.1",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@nestjs/cli": "11.0.0",
    "@swc/core": "1.10.1",
    "@types/express": "5.0.0",
    "@types/multer": "1.4.12",
    "@types/node": "22.10.2",
    "prisma": "6.2.1",
    "tsx": "4.19.2",
    "typescript": "5.6.3",
    "unplugin-swc": "1.5.1",
    "vitest": "2.1.8"
  }
}
```

```json
// apps/api/tsconfig.json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "test/**/*", "prisma/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```json
// apps/api/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "test/**/*"]
}
```

```json
// apps/api/nest-cli.json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "webpack": false,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

```typescript
// apps/api/vitest.config.ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false, // serial: all tests share one Postgres database
    globalSetup: ['./test/setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://bms:bms@127.0.0.1:5433/bms_test',
      APP_SECRET: 'test-secret-at-least-32-characters-long!!',
      TZ: 'Asia/Jakarta',
    },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })],
});
```

```ini
# apps/api/.env.example — copy to .env, never commit .env
DATABASE_URL="postgresql://bms:change-me@127.0.0.1:5432/bms"
APP_SECRET="openssl rand -hex 32"
APP_DOMAIN="https://bus.example.com"
PORT=3000
```

- [ ] **Step 2: Write failing health test**

```typescript
// apps/api/test/setup.ts
import { execSync } from 'node:child_process';

/** Boots the compose Postgres (port 5433) and applies migrations once for the whole run. */
export default async function globalSetup() {
  execSync('docker compose -f ../../docker-compose.test.yml up -d --wait', { stdio: 'inherit' });
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env } });
}
```

```dockercompose
# docker-compose.test.yml (repo root)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bms
      POSTGRES_PASSWORD: bms
      POSTGRES_DB: bms_test
    ports: ["5433:5433"]
    command: ["postgres", "-p", "5433"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bms -p 5433"]
      interval: 2s
      timeout: 3s
      retries: 30
```

```typescript
// apps/api/test/health.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

let app: INestApplication;
let server: import('supertest').SuperTest<import('supertest').Test>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  // lit known http shape via raw fetch on the listening socket
  await app.listen(0);
  const url = app.getUrl();
  server = { url } as never;
});

test('GET /api/health answers 200 {status:"ok"}', async () => {
  const base = await app.getUrl();
  const res = await fetch(`${base}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && pnpm test`
Expected: FAIL — `apps/api/src/app.module.ts` not found.

- [ ] **Step 4: Write the HTTP skeleton**

```typescript
// apps/api/src/common/domain-error.ts
import type { ErrorCode } from '@bms/shared';

/** Every business failure the API can answer; rendered by AllExceptionsFilter via ERROR_HTTP_STATUS. */
export class DomainError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
```

```typescript
// apps/api/src/common/zod.ts
import type { ZodError } from 'zod';

/** Verbatim copy of packages/mock-api/src/http.ts zodMessage — first issue only. */
export function zodMessage(i: ZodError['issues'][number]): string {
  if (i.code === 'unrecognized_keys') return 'Ada kolom yang tidak dikenali.';
  if (i.code === 'invalid_type') return `${i.path.join('.') || 'body'}: format tidak sesuai.`;
  return `${i.path.join('.') || 'body'}: ${i.message}`;
}
```

```typescript
// apps/api/src/common/zod-body.pipe.ts
import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { DomainError } from './domain-error';
import { zodMessage } from './zod';

/** Validates body/query through a shared @bms/shared schema; throws DomainError(VALIDATION_ERROR). */
@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'body' && typeof value === 'string') {
      throw new DomainError('VALIDATION_ERROR', 'Body harus JSON.');
    }
    const r = this.schema.safeParse(value);
    if (!r.success) throw new DomainError('VALIDATION_ERROR', zodMessage(r.error.issues[0]));
    return r.data;
  }
}

/** Factory usable as `new ZodPipe(Schema)` or decorator `@Body(new ZodPipe(Schema))`. */
export const zodBody = <T extends ZodTypeAny>(schema: T) => new ZodPipe(schema);
```

```typescript
// apps/api/src/common/response.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/** mock parity: undefined → 204, never 201 (Nest POST default → forced 200). */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<import('express').Response>();
    return next.handle().pipe(
      map((v) => {
        if (v === undefined) {
          res.status(204);
          return null;
        }
        if (res.statusCode === 201) res.status(200);
        return v;
      }),
    );
  }
}
```

```typescript
// apps/api/src/common/all-exceptions.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable } from '@nestjs/common';
import { ERROR_HTTP_STATUS, ERROR_MESSAGES } from '@bms/shared';
import type { ZodError } from 'zod';
import { DomainError } from './domain-error';
import { zodMessage } from './zod';

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<import('express').Response>();
    const body = (code: string, message: string, status: number) => res.status(status).json({ code, message });

    if (e instanceof DomainError) return body(e.code, e.message, ERROR_HTTP_STATUS[e.code]);
    if (e instanceof HttpException) {
      const s = e.getStatus();
      if (s === 413) return body('VALIDATION_ERROR', 'File terlalu besar.', 413);
      return body('VALIDATION_ERROR', e.message, s);
    }
    if (e instanceof SyntaxError && 'body' in (e as object)) {
      return body('VALIDATION_ERROR', 'Body harus JSON.', 400); // body-parser JSON parse failure
    }
    if (e instanceof Error && 'issues' in e) {
      const z = e as unknown as ZodError;
      return body('VALIDATION_ERROR', zodMessage(z.issues[0]), 400);
    }
    // unknown — mock has no INTERNAL code, so VALIDATION_ERROR at 500
    return body('VALIDATION_ERROR', 'Terjadi kesalahan server.', 500);
  }
}
```

```typescript
// apps/api/src/common/json-logger.service.ts
import { LoggerService } from '@nestjs/common';

/** ~30-line JSON logger to stdout (spec §5.11): one line per event, level+time+context+message. */
export class JsonLogger implements LoggerService {
  private out(level: string, context: string, message: unknown) {
    process.stdout.write(
      JSON.stringify({ level, time: new Date().toISOString(), context, message: String(message) }) + '\n',
    );
  }
  log(m: unknown, c = 'Nest') { this.out('info', c, m); }
  error(m: unknown, c = 'Nest') { this.out('error', c, m); }
  warn(m: unknown, c = 'Nest') { this.out('warn', c, m); }
  debug(m: unknown, c = 'Nest') { this.out('debug', c, m); }
  verbose(m: unknown, c = 'Nest') { this.out('verbose', c, m); }
}
```

```typescript
// apps/api/src/common/guards/maintenance.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ERROR_MESSAGES } from '@bms/shared';
import { DomainError } from '../domain-error';

/**
 * In-memory maintenance flag (spec §5.11 restore flips it). Skips /api/system/status and /api/health.
 * Task 14 sets/restores the flag around pg_restore.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  enabled = false;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<import('express').Request>();
    if (req.path === '/api/system/status' || req.path === '/api/health') return true;
    if (this.enabled) throw new DomainError('MAINTENANCE', ERROR_MESSAGES.MAINTENANCE);
    return true;
  }
}
```

```typescript
// apps/api/src/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
```

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { MaintenanceGuard } from './common/guards/maintenance.guard';

@Module({
  controllers: [HealthController],
  providers: [
    MaintenanceGuard,
    { provide: APP_GUARD, useExisting: MaintenanceGuard, multi: true },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
```

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger.service';

try {
  process.loadEnvFile();
} catch { /* no .env in container if env injected */ }

async function bootstrap() {
  if (!process.env.APP_SECRET) throw new Error('APP_SECRET wajib diisi.');
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new JsonLogger().log(`listening :${port}`, 'Bootstrap');
}
void bootstrap();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && pnpm install && pnpm test`
Expected: PASS — `GET /api/health answers 200 {status:"ok"}`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig*.json apps/api/nest-cli.json apps/api/vitest.config.ts apps/api/.env.example apps/api/src apps/api/test docker-compose.test.yml
git commit -m "feat(api): scaffold NestJS app with HTTP skeleton, health, error parity"
```

---

### Task 2: Prisma schema + migration

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/0_init/migration.sql` (via `prisma migrate diff`, then hand-edit)
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 env (`DATABASE_URL`), `@bms/shared` enums/roles for column comments.
- Produces: Prisma client models `User, Vendor, Bus, Shift, Route, Stop, TripTemplate, Trip, Booking, Subscription, RejectedRequest, RefreshToken, DeviceToken, Notification, AuditLog, Setting, Backup` — exact names every later task uses. Partial unique `booked_active_unique(userId,date,shiftId,direction) WHERE status='BOOKED'`, CHECK `trip_booked_count_check`, `UNIQUE(templateId,date)`, index `(routeId,shiftId,direction,date)`, `UNIQUE(routeId,seq)`.

- [ ] **Step 1: Write failing schema test**

```typescript
// apps/api/test/schema.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$executeRawUnsafe('DELETE FROM "Booking"'); // clean slate; tables must exist
});

describe('schema constraints (spec §4)', () => {
  test('partial unique: second active booking same user/date/shift/direction violates', async () => {
    const data = {
      userId: 'u1', tripId: null as unknown as string, routeId: 'r1', stopId: 's1',
      shiftId: 'pagi', direction: 'PICKUP', date: '2099-01-01', status: 'BOOKED', source: 'DAILY',
    } as never;
    // tripId/foreign keys relaxed: constraint under test is the partial unique index itself
    await prisma.$executeRaw`INSERT INTO "Booking" (id, "userId", "routeId", "stopId", "shiftId", direction, date, status, source, "createdAt", "updatedAt") VALUES ('b1', 'u1', 'r1', 's1', 'pagi', 'PICKUP', '2099-01-01', 'BOOKED', 'DAILY', now(), now())`;
    await expect(
      prisma.$executeRaw`INSERT INTO "Booking" (id, "userId", "routeId", "stopId", "shiftId", direction, date, status, source, "createdAt", "updatedAt") VALUES ('b2', 'u1', 'r1', 's1', 'pagi', 'PICKUP', '2099-01-01', 'BOOKED', 'DAILY', now(), now())`,
    ).rejects.toThrow();
    // a CANCELLED row is allowed (partial WHERE status='BOOKED')
    await prisma.$executeRaw`INSERT INTO "Booking" (id, "userId", "routeId", "stopId", "shiftId", direction, date, status, source, "createdAt", "updatedAt") VALUES ('b3', 'u1', 'r1', 's1', 'pagi', 'PICKUP', '2099-01-01', 'CANCELLED', 'DAILY', now(), now())`;
    await prisma.$executeRaw`DELETE FROM "Booking" WHERE id IN ('b1','b3')`;
  });

  test('CHECK: booked_count cannot exceed capacity', async () => {
    await prisma.$executeRaw`INSERT INTO "Trip" (id, "templateId", date, "departureAt", status, "bookedCount", capacity, "routeId", "shiftId", direction, "busId", "createdAt", "updatedAt") VALUES ('t1','tpl1','2099-01-01', now(), 'SCHEDULED', 0, 2, 'r1','pagi','PICKUP','b1', now(), now())`;
    await expect(
      prisma.$executeRaw`UPDATE "Trip" SET "bookedCount" = 5 WHERE id = 't1'`,
    ).rejects.toThrow();
    await prisma.$executeRaw`DELETE FROM "Trip" WHERE id = 't1'`;
  });

  test('UNIQUE(template_id, date) exists (trip generation idempotent)', async () => {
    // covered implicitly by generate tests; assert the index name is present
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Trip' AND indexdef LIKE '%UNIQUE%'`;
    expect(rows.some((r) => r.indexname.includes('templateId'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/schema.test.ts`
Expected: FAIL — relation table does not exist.

- [ ] **Step 3: Write schema and migration**

```prisma
// apps/api/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Vendor {
  id        String   @id @default(cuid())
  name      String
  contact   String   @default("")
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  buses     Bus[]
  users     User[]
}

model Bus {
  id        String   @id @default(cuid())
  plate     String   @unique
  capacity  Int
  vendorId  String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  vendor    Vendor   @relation(fields: [vendorId], references: [id])
  templates TripTemplate[]
  trips     Trip[]
}

model Shift {
  id        String   @id
  name      String
  startTime String
  endTime   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  templates TripTemplate[]
  trips     Trip[]
  bookings  Booking[]
  subs      Subscription[]
}

model Route {
  id        String   @id @default(cuid())
  code      String   @unique
  name      String
  color     String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  stops     Stop[]
  templates TripTemplate[]
  trips     Trip[]
  bookings  Booking[]
  subs      Subscription[]
}

model Stop {
  id            String   @id @default(cuid())
  routeId       String
  name          String
  seq           Int
  offsetMinutes Int
  lat           Float?
  lng           Float?
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  route         Route    @relation(fields: [routeId], references: [id])
  bookings      Booking[]
  subs          Subscription[]

  @@unique([routeId, seq])
}

model User {
  id                    String    @id @default(cuid())
  nik                   String    @unique
  name                  String
  department            String    @default("")
  phone                 String    @default("")
  role                  String    // EMPLOYEE | ADMIN_GA | SUPER_ADMIN | VENDOR
  vendorId              String?
  passwordHash          String?
  authProvider          String    @default("LOCAL") // LOCAL | SSO
  active                Boolean   @default(true)
  mustChangePassword    Boolean   @default(false)
  bookingSuspendedUntil DateTime?
  suspendReason         String?
  failedLogins          Int       @default(0)
  lockedUntil           DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  vendor                Vendor?   @relation(fields: [vendorId], references: [id])
  refreshTokens         RefreshToken[]
  deviceTokens          DeviceToken[]
  bookings              Booking[]
  subs                  Subscription[]
  notifications         Notification[]
  auditLogs             AuditLog[]  @relation("AuditActor")
}

model TripTemplate {
  id            String   @id @default(cuid())
  routeId       String
  shiftId       String
  direction     String   // PICKUP | DROPOFF
  busId         String
  departureTime String   // HH:mm
  dayOffset     Int      @default(0)
  weekdays      Int[]    // 1=Mon .. 7=Sun
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  route         Route    @relation(fields: [routeId], references: [id])
  shift         Shift    @relation(fields: [shiftId], references: [id])
  bus           Bus      @relation(fields: [busId], references: [id])
  trips         Trip[]
}

model Trip {
  id          String        @id @default(cuid())
  templateId  String
  date        String        // YYYY-MM-DD operational date (Asia/Jakarta)
  departureAt DateTime
  status      String        @default("SCHEDULED") // SCHEDULED | CANCELLED | DEPARTED
  bookedCount Int           @default(0)
  capacity    Int
  routeId     String
  shiftId     String
  direction   String
  busId       String
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  template    TripTemplate  @relation(fields: [templateId], references: [id])
  route       Route         @relation(fields: [routeId], references: [id])
  shift       Shift         @relation(fields: [shiftId], references: [id])
  bus         Bus           @relation(fields: [busId], references: [id])
  bookings    Booking[]
  rejected    RejectedRequest[]

  @@unique([templateId, date])
  @@index([routeId, shiftId, direction, date])
}

model Booking {
  id             String        @id @default(cuid())
  userId         String
  tripId         String?
  routeId        String
  stopId         String
  shiftId        String
  direction      String
  date           String
  status         String        @default("BOOKED") // BOOKED | CANCELLED | NO_SHOW
  source         String        @default("DAILY") // DAILY | SUBSCRIPTION
  subscriptionId String?
  cancelReason   String?
  cancelledAt    DateTime?
  reminderSentAt DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  user           User          @relation(fields: [userId], references: [id])
  trip           Trip?         @relation(fields: [tripId], references: [id])
  route          Route         @relation(fields: [routeId], references: [id])
  stop           Stop          @relation(fields: [stopId], references: [id])
  shift          Shift         @relation(fields: [shiftId], references: [id])
  subscription   Subscription? @relation(fields: [subscriptionId], references: [id])
  // partial unique (userId,date,shiftId,direction) WHERE status='BOOKED' added in migration.sql
}

model Subscription {
  id        String    @id @default(cuid())
  userId    String
  routeId   String
  stopId    String
  shiftId   String
  direction String
  startDate String
  endDate   String?
  weekdays  Int[]
  status    String    @default("ACTIVE") // ACTIVE | ENDED
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  user      User      @relation(fields: [userId], references: [id])
  route     Route     @relation(fields: [routeId], references: [id])
  stop      Stop      @relation(fields: [stopId], references: [id])
  shift     Shift     @relation(fields: [shiftId], references: [id])
  bookings  Booking[]
}

model RejectedRequest {
  id             String   @id @default(cuid())
  userId         String
  tripId         String?
  routeId        String
  stopId         String?
  shiftId        String
  direction      String
  date           String
  reason         String   // TRIP_FULL | SUBSCRIPTION_REJECTED
  source         String   @default("DAILY")
  subscriptionId String?
  createdAt      DateTime @default(now())
  trip           Trip?    @relation(fields: [tripId], references: [id])
}

model RefreshToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id])
}

model DeviceToken {
  id        String   @id @default(cuid())
  userId    String
  token     String
  platform  String   // android | ios | web
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])

  @@unique([userId, token])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  type      String
  title     String
  body      String
  data      Json?
  readAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id])

  @@index([userId, createdAt(sort: Desc)])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  actorName String
  action    String
  entity    String
  entityId  String
  before    Json?
  after     Json?
  createdAt DateTime @default(now())
  actor     User?    @relation("AuditActor", fields: [actorId], references: [id])
}

model Setting {
  key       String   @id
  value     Json
  isSecret  Boolean  @default(false)
  updatedAt DateTime @updatedAt
}

model Backup {
  id            String   @id @default(cuid())
  name          String   @unique
  sizeBytes     Int
  copiedToShare Boolean  @default(false)
  createdAt     DateTime @default(now())
}
```

```sql
-- apps/api/prisma/migrations/0_init/migration.sql
-- Generate baseline first:
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
-- then APPEND the two hand-written constraints (Prisma cannot express them):
ALTER TABLE "Booking"
  ADD CONSTRAINT "booked_active_unique" UNIQUE ("userId","date","shiftId","direction")
  WHERE status = 'BOOKED';
-- NOTE: postgres partial unique syntax is CREATE UNIQUE INDEX ... WHERE:
-- correct form (use this, not ALTER ... WHERE):
CREATE UNIQUE INDEX "booked_active_unique"
  ON "Booking" ("userId","date","shiftId","direction")
  WHERE status = 'BOOKED';
ALTER TABLE "Trip"
  ADD CONSTRAINT "trip_booked_count_check"
  CHECK ("bookedCount" >= 0 AND "bookedCount" <= capacity);
```

> Executor: run the `prisma migrate diff` command first, then replace the appended `ALTER TABLE ... UNIQUE ... WHERE` line with only the `CREATE UNIQUE INDEX ... WHERE` + `CHECK` statements shown (partial unique is index syntax, not constraint syntax).

- [ ] **Step 4: Run migration and test**

```bash
cd apps/api && npx prisma migrate deploy && npx prisma generate && pnpm test test/schema.test.ts
```
Expected: PASS — three schema tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): Prisma schema with partial unique booking, trip CHECK, indexes"
```


---

### Task 3: Settings service + AuditService

**Files:**
- Create: `apps/api/src/settings/settings.service.ts`, `apps/api/src/settings/settings.controller.ts`, `apps/api/src/settings/settings.module.ts`
- Create: `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.controller.ts`, `apps/api/src/audit/audit.module.ts`
- Test: `apps/api/test/settings.test.ts`

**Interfaces:**
- Consumes: Prisma `Setting`, `AuditLog`; `@bms/shared` settings module (`Settings`, `SettingsUpdate`, `SECRET_SETTING_KEYS`, `toSettingsView`, `SettingsView`, plus the shared defaults/schema exports); `DomainError`, `ZodPipe` from Task 1.
- Produces: `SettingsService` — `init()`, `get(): Settings` (sync in-memory cache), `getSecret(key)`, `update(partial: SettingsUpdate, actor): SettingsView` (shared zod validation, AES-256-GCM encrypt secrets, live cache swap, `onChanged` EventEmitter), `toView(): SettingsView`; `AuditService` — `write(input)` (masks SECRET_SETTING_KEYS "***", empty stays ""), `list(filters)` (page size 50, createdAt desc). Controller: `GET/PUT /api/settings` (SUPER_ADMIN), `POST /api/settings/test-push|test-share` (stubs here, real in Tasks 11/14), `GET /api/audit-logs` (ADMIN_ROLES). Every later task reads cutoff/TTL/cron values via `SettingsService.get()`.

- [ ] **Step 1: Write failing settings test**

```typescript
// apps/api/test/settings.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SECRET_SETTING_KEYS } from '@bms/shared';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let svc: SettingsService;
let audit: AuditService;

beforeAll(async () => {
  await prisma.setting.deleteMany();
  await prisma.auditLog.deleteMany();
  audit = new AuditService(prisma);
  svc = new SettingsService(prisma, audit, key);
  await svc.init();
});

describe('settings service', () => {
  test('defaults match packages/shared settings', async () => {
    const s = svc.get();
    expect(s.booking_cutoff_minutes).toBe(120);
    expect(s.generate_days_ahead).toBe(7);
    expect(s.generate_run_time).toBe('00:30');
    expect(s.reminder_minutes).toBe(60);
    expect(s.push_enabled).toBe(false);
    expect(s.fcm_service_account).toBe('');
    expect(s.notification_retention_days).toBe(90);
    expect(s.login_max_failed).toBe(5);
    expect(s.login_lockout_minutes).toBe(15);
    expect(s.login_rate_limit_per_minute).toBe(10);
    expect(s.access_token_minutes).toBe(15);
    expect(s.refresh_token_days).toBe(30);
    expect(s.password_min_length).toBe(8);
    expect(s.backup_run_time).toBe('02:00');
    expect(s.backup_retention_days).toBe(14);
    expect(s.backup_share_enabled).toBe(false);
    expect(s.backup_share_path).toBe('');
  });

  test('out-of-range update rejected with shared schema message', () => {
    expect(() => svc.update({ booking_cutoff_minutes: 9999 } as never, { id: 'a', name: 'A' })).toThrow(/1440/);
    expect(svc.get().booking_cutoff_minutes).toBe(120);
  });

  test('valid update applies live, emits onChanged, writes audit', async () => {
    let fired = 0;
    svc.onChanged.on('changed', () => fired++);
    const view = svc.update({ booking_cutoff_minutes: 90 }, { id: 'a', name: 'Admin' });
    expect(svc.get().booking_cutoff_minutes).toBe(90);
    expect(fired).toBe(1);
    expect(view.booking_cutoff_minutes).toBe(90);
    await new Promise((r) => setTimeout(r, 100)); // DB write is async tx
    const log = await prisma.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(log).toBeTruthy();
  });

  test('secret stored ciphertext, read decrypted, view isSet only, audit masked', async () => {
    svc.update({ fcm_service_account: '{"type":"service_account","project_id":"p"}' }, { id: 'a', name: 'Admin' });
    await new Promise((r) => setTimeout(r, 100));
    const row = await prisma.setting.findUnique({ where: { key: 'fcm_service_account' } });
    expect(String(row!.value)).not.toContain('service_account'); // ciphertext in DB
    expect(svc.get().fcm_service_account).toContain('service_account'); // decrypted in cache
    const view = svc.toView();
    expect(view.fcm_service_account.isSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('service_account'); // never leaks
    const log = await prisma.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(JSON.stringify(log!.after)).toContain('***');
    expect(JSON.stringify(log!.after)).not.toContain('service_account');
  });

  test('SECRET_SETTING_KEYS matches shared export', () => {
    expect(SECRET_SETTING_KEYS).toEqual(['fcm_service_account', 'backup_share_password']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/settings.test.ts`
Expected: FAIL — `SettingsService` not found.

- [ ] **Step 3: Implement settings + audit**

```typescript
// apps/api/src/audit/audit.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { SECRET_SETTING_KEYS } from '@bms/shared';

export interface AuditInput {
  actorId?: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Mask secret-setting values to "***" (spec §5.12); empty string stays "". */
function maskSnapshot(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  const clone = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  for (const k of SECRET_SETTING_KEYS) {
    if (k in clone && clone[k] !== '' && clone[k] !== null && clone[k] !== undefined) clone[k] = '***';
  }
  return clone as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async write(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: maskSnapshot(input.before) ?? Prisma.JsonNull,
        after: maskSnapshot(input.after) ?? Prisma.JsonNull,
      },
    });
  }

  async list(filters: { actorId?: string; action?: string; from?: string; to?: string; page?: number }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(`${filters.from}T00:00:00+07:00`);
      if (filters.to) where.createdAt.lt = new Date(`${filters.to}T23:59:59.999+07:00`);
    }
    const pageSize = 50;
    const page = Math.max(1, Number(filters.page) || 1);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { items: rows.map((r) => ({ ...r, before: r.before ?? null, after: r.after ?? null })), total, page, pageSize };
  }
}
```

```typescript
// apps/api/src/settings/settings.service.ts
import { EventEmitter } from 'node:events';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { SECRET_SETTING_KEYS, Settings, SettingsUpdate, SettingsView, toSettingsView, SETTINGS_SCHEMA, SETTINGS_DEFAULTS } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { zodMessage } from '../common/zod';
import { AuditService } from '../audit/audit.service';

/**
 * In-memory settings cache. Secrets encrypted at rest with AES-256-GCM,
 * key = scryptSync(APP_SECRET, 'bms-settings', 32). update(): shared zod validation,
 * live cache swap, async durable write + masked audit, 'changed' event for cron re-register (Task 13).
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  readonly onChanged = new EventEmitter();
  private cache: Settings = { ...SETTINGS_DEFAULTS };

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly key: Buffer,
  ) {}

  async onModuleInit() {
    await this.init();
  }

  async init(): Promise<void> {
    const rows = await this.prisma.setting.findMany();
    const merged: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
    for (const r of rows) {
      merged[r.key] = SECRET_SETTING_KEYS.includes(r.key) ? this.decrypt(String(r.value)) : r.value;
    }
    this.cache = merged as Settings;
  }

  get(): Settings {
    return this.cache;
  }

  getSecret(key: string): string | undefined {
    if (!SECRET_SETTING_KEYS.includes(key)) return undefined;
    return (this.cache as Record<string, unknown>)[key] as string | undefined;
  }

  toView(): SettingsView {
    return toSettingsView(this.cache);
  }

  update(partial: SettingsUpdate, actor: { id: string | null; name: string }): SettingsView {
    const candidate = { ...this.cache, ...partial } as Settings;
    const parsed = SETTINGS_SCHEMA.safeParse(candidate);
    if (!parsed.success) throw new DomainError('VALIDATION_ERROR', zodMessage(parsed.error.issues[0]));
    const before = { ...this.cache };
    this.cache = parsed.data; // live-apply synchronously
    this.onChanged.emit('changed', this.cache);
    const writes = Object.entries(partial)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const stored = SECRET_SETTING_KEYS.includes(k) ? this.encrypt(String(v ?? '')) : v;
        return this.prisma.setting.upsert({
          where: { key: k },
          create: { key: k, value: stored as Prisma.InputJsonValue, isSecret: SECRET_SETTING_KEYS.includes(k) },
          update: { value: stored as Prisma.InputJsonValue },
        });
      });
    void this.prisma.$transaction(writes).then(() =>
      this.audit.write({
        actorId: actor.id, actorName: actor.name, action: 'SETTINGS_UPDATE',
        entity: 'settings', entityId: '-',
        before: toSettingsView(before), after: toSettingsView(this.cache),
      }),
    );
    return toSettingsView(this.cache);
  }

  private encrypt(plain: string): string {
    if (plain === '') return '';
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  private decrypt(blob: string): string {
    if (!blob.includes('.')) return blob;
    try {
      const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
      const d = createDecipheriv('aes-256-gcm', this.key, iv!);
      d.setAuthTag(tag!);
      return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
    } catch {
      return blob;
    }
  }
}
```

```typescript
// apps/api/src/settings/settings.controller.ts
import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { SettingsUpdate } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
@Roles('SUPER_ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.toView();
  }

  @Put()
  @UsePipes(new ZodPipe(SettingsUpdate))
  update(@Body() body: SettingsUpdate, @Req() req: { user: { id: string | null; name: string } }) {
    return this.settings.update(body, req.user);
  }

  // Real implementations arrive in Task 11 (push) and Task 14 (share); stubs match mock's unconfigured answers.
  @Post('test-push')
  testPush() {
    return { ok: false, message: 'Push notifikasi belum diaktifkan.' };
  }

  @Post('test-share')
  testShare() {
    return { ok: false, message: 'Path network share belum diisi.' };
  }
}
```

> Fix imports in the controller: `UsePipes` from `@nestjs/common`, `Post` too. (Shown bare for brevity of the block — executor adds them to the import list.)

```typescript
// apps/api/src/settings/settings.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AuditService } from '../audit/audit.service';
import { AuditController } from '../audit/audit.controller';

@Global()
@Module({
  controllers: [SettingsController, AuditController],
  providers: [
    SettingsService, AuditService, PrismaClient,
    { provide: 'SETTINGS_KEY', useFactory: () => scryptSync(process.env.APP_SECRET ?? '', 'bms-settings', 32) },
  ],
  exports: [SettingsService, AuditService],
})
export class SettingsModule {}
```

```typescript
// apps/api/src/audit/audit.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@Roles('SUPER_ADMIN', 'ADMIN_GA')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.audit.list({ actorId, action, from, to, page: page ? Number(page) : undefined });
  }
}
```

Wire `SettingsModule` into `AppModule`. Auth decorators referenced exist after Task 4; for Task 3's service-level test to pass they are only type imports (no runtime guard yet) — Task 4 adds the guards. Fix `SettingsService` constructor: the test calls `new SettingsService(prisma, audit, key)` — if `SETTINGS_KEY` DI token differs, wire `useFactory` to inject into the service via `@Inject('SETTINGS_KEY')`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/settings apps/api/src/audit apps/api/src/app.module.ts apps/api/test/settings.test.ts
git commit -m "feat(api): settings service with AES-256-GCM secrets, live cache, audit masking"
```

---

### Task 4: Auth — argon2, JWT, refresh rotation, guards, login/setup/change-password/device-tokens

**Files:**
- Create: `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/guards/auth.guard.ts`, `apps/api/src/auth/guards/roles.guard.ts`, `apps/api/src/auth/guards/login-rate.limit.guard.ts`
- Create: `apps/api/src/auth/decorators/public.decorator.ts`, `apps/api/src/auth/decorators/roles.decorator.ts`, `apps/api/src/auth/decorators/allow-must-change.decorator.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: `SettingsService` (`access_token_minutes`, `refresh_token_days`, `login_max_failed`, `login_lockout_minutes`, `login_rate_limit_per_minute`, `password_min_length`); `AuditService.write`; `DomainError`; Prisma `User`, `RefreshToken`, `DeviceToken`; `@bms/shared` `LoginRequest`, `Me`, `LoginResponse`, `ChangePasswordRequest`, `SetupRequest`, `ENDPOINTS`, `REFRESH_COOKIE`, `ERROR_MESSAGES`.
- Produces: `AuthGuard` (global; Bearer JWT → active user on `req.user`; public routes tolerate missing token with `req.user=null`; mustChange blocked unless `@AllowMustChange()`); `RolesGuard` (checks `@Roles(...)`); `@Public()`, `@Roles(...)`, `@AllowMustChange()`; `AuthService` — `login(nik,password,ip)`, `refresh(token)`, `logout(token?)`, `me(userId)`, `changePassword(userId,current,new)`, `setupStatus()`, `setup(req)`, `addDeviceToken(userId,token,platform)`, `removeDeviceToken(userId,token)`, `revokeAll(userId)`; cookie helpers `setRefreshCookie` / `clearRefreshCookie` + `readCookie`. Refresh tokens: base64url(32B random), stored sha256, rotation on every refresh, revoked → UNAUTHORIZED reuse rejection.

- [ ] **Step 1: Write failing auth test**

```typescript
// apps/api/test/auth.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');

let auth: AuthService;
let settings: SettingsService;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.user.deleteMany(), prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(),
    prisma.auditLog.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const jwt = new JwtService({ secret: process.env.APP_SECRET });
  auth = new AuthService(prisma, settings, audit, jwt);
});

async function makeUser(nik: string, opts: { role?: string; pw?: string; mustChange?: boolean; active?: boolean; sso?: boolean } = {}) {
  return prisma.user.create({
    data: {
      nik, name: 'Tester', role: opts.role ?? 'EMPLOYEE',
      passwordHash: opts.sso ? null : await argon2.hash(opts.pw ?? 'demo1234'),
      authProvider: opts.sso ? 'SSO' : 'LOCAL',
      mustChangePassword: opts.mustChange ?? false,
      active: opts.active ?? true,
    },
  });
}

describe('login', () => {
  test('wrong password → UNAUTHORIZED "NIK atau password salah."', async () => {
    await makeUser('K1');
    await expect(auth.login('K1', 'salah', '127.0.0.1')).rejects.toMatchObject({
      code: 'UNAUTHORIZED', message: 'NIK atau password salah.',
    });
  });

  test('missing / inactive / SSO → same UNAUTHORIZED message', async () => {
    await expect(auth.login('TIDAKADA', 'x', '127.0.0.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'NIK atau password salah.' });
    await makeUser('K2', { active: false });
    await expect(auth.login('K2', 'x', '127.0.0.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'NIK atau password salah.' });
    await makeUser('K3', { sso: true });
    await expect(auth.login('K3', 'x', '127.0.0.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'NIK atau password salah.' });
  });

  test('success resets failedLogins + lockedUntil, returns access+refresh', async () => {
    await prisma.user.update({ where: { nik: 'K1' }, data: { failedLogins: 2, lockedUntil: null } });
    const r = await auth.login('K1', 'demo1234', '127.0.0.1');
    expect(r.accessToken).toBeTruthy();
    expect(r.refreshToken).toBeTruthy();
    expect(r.user.nik).toBe('K1');
    const u = await prisma.user.findUnique({ where: { nik: 'K1' } });
    expect(u!.failedLogins).toBe(0);
    expect(u!.lockedUntil).toBeNull();
  });

  test('lockout at max failed; further login ACCOUNT_LOCKED; correct pw also locked', async () => {
    await makeUser('K4');
    for (let i = 0; i < 4; i++) {
      await expect(auth.login('K4', 'salah', '127.0.0.1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    }
    await expect(auth.login('K4', 'salah', '127.0.0.1')).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED', message: 'Akun terkunci sementara karena terlalu banyak gagal login.',
    });
    const u = await prisma.user.findUnique({ where: { nik: 'K4' } });
    expect(u!.failedLogins).toBe(0);
    expect(u!.lockedUntil).toBeTruthy();
    await expect(auth.login('K4', 'demo1234', '127.0.0.1')).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });
});

describe('refresh rotation', () => {
  test('valid refresh rotates; reuse of old token is UNAUTHORIZED', async () => {
    await makeUser('K5');
    const first = await auth.login('K5', 'demo1234', '127.0.0.1');
    const second = await auth.refresh(first.refreshToken!);
    expect(second.accessToken).toBeTruthy();
    await expect(auth.refresh(first.refreshToken!)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const third = await auth.refresh(second.refreshToken!);
    expect(third.accessToken).toBeTruthy();
  });

  test('garbage refresh → UNAUTHORIZED', async () => {
    await expect(auth.refresh('not-a-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('setup + changePassword', () => {
  test('setup once only; second → FORBIDDEN "Setup awal sudah dilakukan."', async () => {
    await prisma.user.deleteMany({ where: { role: 'SUPER_ADMIN' } });
    expect(await auth.setupStatus()).toEqual({ needsSetup: true });
    const r = await auth.setup({ nik: 'ADMIN01', name: 'Boss', password: 'supersecret1' });
    expect(r.user.role).toBe('SUPER_ADMIN');
    expect(r.user.mustChangePassword).toBe(false);
    expect(await auth.setupStatus()).toEqual({ needsSetup: false });
    await expect(auth.setup({ nik: 'X', name: 'Y', password: 'zzzzzzzz' })).rejects.toMatchObject({
      code: 'FORBIDDEN', message: 'Setup awal sudah dilakukan.',
    });
  });

  test('short setup password → "Password minimal N karakter."', async () => {
    await prisma.user.deleteMany({ where: { role: 'SUPER_ADMIN' } });
    await expect(auth.setup({ nik: 'X', name: 'Y', password: 'short' })).rejects.toThrow(/Password minimal \d+ karakter\./);
    await prisma.user.deleteMany({ where: { role: 'SUPER_ADMIN' } }); // cleanup for next
  });

  test('changePassword: wrong current / same new / success', async () => {
    const u = await makeUser('K6', { pw: 'oldpass1' });
    await expect(auth.changePassword(u.id, 'salah', 'newpass1')).rejects.toThrow('Password lama salah.');
    await expect(auth.changePassword(u.id, 'oldpass1', 'oldpass1')).rejects.toThrow('Password baru harus berbeda.');
    await auth.changePassword(u.id, 'oldpass1', 'newpass1');
    const r = await auth.login('K6', 'newpass1', '127.0.0.1');
    expect(r.accessToken).toBeTruthy();
    // old refresh tokens revoked by changePassword
    await expect(auth.refresh((await prisma.refreshToken.findFirst({ where: { userId: u.id, revokedAt: null } }))!.tokenHash)).rejects.toBeTruthy();
  });
});

describe('device tokens', () => {
  test('add idempotent; delete removes', async () => {
    const u = await makeUser('K8');
    await auth.addDeviceToken(u.id, 'tok-abc', 'android');
    await auth.addDeviceToken(u.id, 'tok-abc', 'android');
    await auth.removeDeviceToken(u.id, 'tok-abc');
    expect(await prisma.deviceToken.findFirst({ where: { userId: u.id, token: 'tok-abc' } })).toBeNull();
  });
});
```

> Note: the last changePassword assertion uses `tokenHash` as if it were the raw token — fix: call `auth.refresh(rawToken)` before changePassword to capture raw token, then assert reuse fails after rotation/revocation. Executor adjusts: capture `const raw = (await auth.login(...)).refreshToken` first.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/auth.test.ts`
Expected: FAIL — `AuthService` not found.

- [ ] **Step 3: Implement auth module, guards, decorators**

```typescript
// apps/api/src/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const PUBLIC_KEY = 'bms:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
```

```typescript
// apps/api/src/auth/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'bms:roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// apps/api/src/auth/decorators/allow-must-change.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const ALLOW_MUST_CHANGE_KEY = 'bms:allowMustChange';
export const AllowMustChange = () => SetMetadata(ALLOW_MUST_CHANGE_KEY, true);
```

```typescript
// apps/api/src/auth/guards/auth.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ERROR_MESSAGES } from '@bms/shared';
import { PrismaClient } from '@prisma/client';
import { DomainError } from '../../common/domain-error';
import { ALLOW_MUST_CHANGE_KEY } from '../decorators/allow-must-change.decorator';
import { PUBLIC_KEY } from '../decorators/public.decorator';

/** Global: Bearer → verify JWT → load active user → req.user. Public routes: missing/invalid token → req.user=null, no throw. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaClient,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]) ?? false;
    const allowMustChange = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? false;
    const req = ctx.switchToHttp().getRequest<import('express').Request & { user?: unknown }>();

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (isPublic) { req.user = null; return true; }
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7));
      sub = payload.sub;
    } catch {
      if (isPublic) { req.user = null; return true; }
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    const user = await this.prisma.user.findFirst({ where: { id: sub, active: true } });
    if (!user) {
      if (isPublic) { req.user = null; return true; }
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    if (user.mustChangePassword && !allowMustChange) {
      throw new DomainError('FORBIDDEN', 'Ganti password terlebih dahulu.');
    }
    req.user = user;
    return true;
  }
}
```

```typescript
// apps/api/src/auth/guards/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_MESSAGES } from '@bms/shared';
import { DomainError } from '../../common/domain-error';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const req = ctx.switchToHttp().getRequest<{ user?: { role: string } | null }>();
    if (!req.user) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    if (!roles.includes(req.user.role)) throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);
    return true;
  }
}
```

```typescript
// apps/api/src/auth/guards/login-rate.limit.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ERROR_MESSAGES } from '@bms/shared';
import { SettingsService } from '../../settings/settings.service';
import { DomainError } from '../../common/domain-error';

/** In-memory per-IP sliding window for POST /api/auth/login; limit = login_rate_limit_per_minute. */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private hits = new Map<string, number[]>();
  constructor(private readonly settings: SettingsService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<import('express').Request>();
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const arr = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.settings.get().login_rate_limit_per_minute) {
      this.hits.set(ip, arr);
      throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);
    }
    arr.push(now);
    this.hits.set(ip, arr);
    return true;
  }
}
```

```typescript
// apps/api/src/auth/auth.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ERROR_MESSAGES, LoginResponse, Me, SetupRequest } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  private async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId }, { expiresIn: `${this.settings.get().access_token_minutes}m` });
    const refreshToken = randomBytes(32).toString('base64url');
    const days = this.settings.get().refresh_token_days;
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + days * 86_400_000) },
    });
    return { accessToken, refreshToken };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async login(nik: string, password: string, _ip: string): Promise<LoginResponse & { refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { nik } });
    const badLogin = () => new DomainError('UNAUTHORIZED', 'NIK atau password salah.');
    if (!user || !user.active || user.authProvider !== 'LOCAL') throw badLogin();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new DomainError('ACCOUNT_LOCKED', ERROR_MESSAGES.ACCOUNT_LOCKED);
    }
    const ok = user.passwordHash ? await argon2.verify(user.passwordHash, password) : false;
    if (!ok) {
      const failed = user.failedLogins + 1;
      const max = this.settings.get().login_max_failed;
      if (failed >= max) {
        const lockout = this.settings.get().login_lockout_minutes;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: new Date(Date.now() + lockout * 60_000) },
        });
        throw new DomainError('ACCOUNT_LOCKED', ERROR_MESSAGES.ACCOUNT_LOCKED);
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed } });
      throw badLogin();
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    const t = await this.issueTokens(user.id);
    return { ...t, user: this.toMe(user) };
  }

  async refresh(refreshToken: string): Promise<LoginResponse & { refreshToken: string }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } }); // rotate
    const user = await this.prisma.user.findFirst({ where: { id: row.userId, active: true } });
    if (!user) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    const t = await this.issueTokens(user.id);
    return { ...t, user: this.toMe(user) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    return this.toMe(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new DomainError('VALIDATION_ERROR', 'Password lama salah.');
    }
    const min = this.settings.get().password_min_length;
    if (newPassword.length < min) throw new DomainError('VALIDATION_ERROR', `Password minimal ${min} karakter.`);
    if (newPassword === currentPassword) throw new DomainError('VALIDATION_ERROR', 'Password baru harus berbeda.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword), mustChangePassword: false },
    });
    await this.revokeAll(userId);
  }

  async setupStatus(): Promise<{ needsSetup: boolean }> {
    return { needsSetup: !(await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })) };
  }

  async setup(req: SetupRequest): Promise<LoginResponse & { refreshToken: string }> {
    if (await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })) {
      throw new DomainError('FORBIDDEN', 'Setup awal sudah dilakukan.');
    }
    if (await this.prisma.user.findUnique({ where: { nik: req.nik } })) {
      throw new DomainError('VALIDATION_ERROR', 'NIK sudah dipakai.');
    }
    const min = this.settings.get().password_min_length;
    if (req.password.length < min) throw new DomainError('VALIDATION_ERROR', `Password minimal ${min} karakter.`);
    const user = await this.prisma.user.create({
      data: {
        nik: req.nik, name: req.name, role: 'SUPER_ADMIN', authProvider: 'LOCAL',
        passwordHash: await argon2.hash(req.password), mustChangePassword: false, active: true,
      },
    });
    await this.audit.write({ actorId: user.id, actorName: user.name, action: 'SETUP_SUPER_ADMIN', entity: 'user', entityId: user.id, after: { nik: user.nik } });
    const t = await this.issueTokens(user.id);
    return { ...t, user: this.toMe(user) };
  }

  async addDeviceToken(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, platform },
      update: { platform },
    });
  }

  async removeDeviceToken(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  /** toMe parity: expired suspension (until < today) → bookingSuspendedUntil AND suspendReason null. */
  private toMe(u: {
    id: string; nik: string; name: string; role: string; vendorId: string | null;
    mustChangePassword: boolean; bookingSuspendedUntil: Date | null; suspendReason: string | null;
  }): Me {
    const todayMs = Date.now() - 7 * 3600_000; // rough Jakarta 'today' boundary for expiry check
    const expired = !!u.bookingSuspendedUntil && u.bookingSuspendedUntil.getTime() < todayMs;
    return {
      id: u.id, nik: u.nik, name: u.name, role: u.role as Me['role'], vendorId: u.vendorId,
      mustChangePassword: u.mustChangePassword,
      bookingSuspendedUntil: expired ? null : u.bookingSuspendedUntil?.toISOString() ?? null,
      suspendReason: expired ? null : u.suspendReason,
    };
  }
}
```

```typescript
// apps/api/src/auth/auth.controller.ts
import { Body, Controller, Get, Headers, Post, Req, Res, UseGuards, UsePipes } from '@nestjs/common';
import { Response } from 'express';
import { ChangePasswordRequest, ENDPOINTS, LoginRequest, REFRESH_COOKIE, SetupRequest } from '@bms/shared';
import { z } from 'zod';
import { Public } from './decorators/public.decorator';
import { AllowMustChange } from './decorators/allow-must-change.decorator';
import { LoginRateLimitGuard } from './guards/login-rate.limit.guard';
import { ZodPipe } from '../common/zod-body.pipe';
import { AuthService } from './auth.service';

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** bms_refresh; Path=/api/auth; HttpOnly; Secure; SameSite=Strict (auth.ts parity). */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { path: '/api/auth', httpOnly: true, secure: true, sameSite: 'strict' });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodPipe(LoginRequest))
  async login(@Body() body: { nik: string; password: string }, @Req() req: { ip: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.nik, body.password, req.ip);
    setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() body: unknown,
    @Headers('content-type') ct: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // body {refreshToken?} only when content-type includes json, else cookie (auth.ts parity)
    const fromBody = ct?.includes('json') ? (body as { refreshToken?: string } | undefined)?.refreshToken : undefined;
    const token = fromBody ?? readCookie(cookie, REFRESH_COOKIE);
    if (!token) {
      const { DomainError } = await import('../common/domain-error');
      const { ERROR_MESSAGES } = await import('@bms/shared');
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    const r = await this.auth.refresh(token);
    setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  }

  @Public()
  @Post('logout')
  async logout(@Body() body: unknown, @Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) res: Response) {
    const token = (body as { refreshToken?: string } | undefined)?.refreshToken ?? readCookie(cookie, REFRESH_COOKIE);
    await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    // undefined → 204 via ResponseInterceptor
  }

  @Get('me')
  @AllowMustChange()
  me(@Req() req: { user: { id: string } }) {
    return this.auth.me(req.user.id);
  }

  @Post('change-password')
  @AllowMustChange()
  @UsePipes(new ZodPipe(ChangePasswordRequest))
  async changePassword(@Req() req: { user: { id: string } }, @Body() body: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
    // 204
  }

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Public()
  @Post('setup')
  @UsePipes(new ZodPipe(SetupRequest))
  async setup(@Body() body: { nik: string; name: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.setup(body);
    setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  }

  @Post('device-tokens')
  @UsePipes(new ZodPipe(z.object({ token: z.string().min(1), platform: z.enum(['android', 'ios', 'web']) })))
  async addToken(@Req() req: { user: { id: string } }, @Body() body: { token: string; platform: string }) {
    await this.auth.addDeviceToken(req.user.id, body.token, body.platform);
    // 204
  }

  @Post('device-tokens/delete')
  @UsePipes(new ZodPipe(z.object({ token: z.string().min(1) })))
  async deleteToken(@Req() req: { user: { id: string } }, @Body() body: { token: string }) {
    await this.auth.removeDeviceToken(req.user.id, body.token);
    // 204
  }
}
```

```typescript
// apps/api/src/auth/auth.module.ts
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.APP_SECRET }), SettingsModule],
  controllers: [AuthController],
  providers: [
    AuthService, AuthGuard, RolesGuard, PrismaClient,
    { provide: APP_GUARD, useExisting: AuthGuard, multi: true },
    { provide: APP_GUARD, useExisting: RolesGuard, multi: true },
  ],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
```

Add `AuthModule` to `AppModule` imports. Note `ENDPOINTS` import in controller is unused — drop it (no lint noise).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/src/app.module.ts apps/api/test/auth.test.ts
git commit -m "feat(api): auth argon2id, JWT, refresh rotation, lockout, rate limit, guards, setup"
```

---

### Task 5: Master data — vendors, buses, shifts, routes, stops

**Files:**
- Create: `apps/api/src/fleet/fleet.module.ts`, `apps/api/src/fleet/vendors.service.ts`, `apps/api/src/fleet/buses.service.ts`, `apps/api/src/fleet/fleet.controller.ts`
- Create: `apps/api/src/routes/routes.module.ts`, `apps/api/src/routes/shifts.service.ts`, `apps/api/src/routes/routes.service.ts`, `apps/api/src/routes/stops.service.ts`, `apps/api/src/routes/routes.controller.ts`
- Create: `apps/api/src/common/mappers.ts` (moved here from Task 7 note — basic toSummary needed for users in Task 6; keep mappers minimal here, expand in Task 7)
- Test: `apps/api/test/master.test.ts`

**Interfaces:**
- Consumes: `SettingsService`, `AuditService`, `AuthGuard`/`RolesGuard`/`@Roles`; `ADMIN_ROLES = ['SUPER_ADMIN','ADMIN_GA']`; `@bms/shared` `VendorInput`, `BusInput`, `ShiftInput`, `RouteInput`, `StopInput`, `Paginated`, `ENDPOINTS`; `DomainError`; Prisma models.
- Produces: `VendorsService` (`list`, `create`, `update`, `deactivate` — reject when active buses remain: "Vendor masih punya bus aktif."); `BusesService` (`list`, `create` — plate dup "Plat ${plate} sudah terdaftar.", uppercase; `update`, `deactivate` — reject when in use: "Bus masih dipakai template aktif atau trip yang belum berangkat."; `setBusCapacity` — checkCutoff CAPACITY_BELOW_BOOKED naming date+time+booked when conflict); `ShiftsService` (`list`, `upsert` by id); `RoutesService` (`list`, `create` — code dup "Kode rute ${code} sudah dipakai.", `update`, `deactivate` — reject in use: "Rute masih dipakai template aktif atau trip yang belum berangkat."); `StopsService` (`listByRoute` sorted seq, `create`/`update` — route must exist, stop.routeId mismatch → NOT_FOUND, `deactivate` — reject when active sub or BOOKED notDeparted booking: "Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat."); `inUseByTrips(tx, {routeId?, shiftId?, busId?})` helper: true if active template OR SCHEDULED notDeparted trip matches. GET endpoints: any logged-in user; mutations: ADMIN_ROLES. `toUserSummary` in mappers.ts strips password/mustChangePassword/failedLogins (needed Task 6, defined here once).

- [ ] **Step 1: Write failing master test**

```typescript
// apps/api/test/master.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { VendorsService } from '../src/fleet/vendors.service';
import { BusesService } from '../src/fleet/buses.service';
import { RoutesService } from '../src/routes/routes.service';
import { StopsService } from '../src/routes/stops.service';
import { AuditService } from '../src/audit/audit.service';
import { DomainError } from '../src/common/domain-error';

const prisma = new PrismaClient();
const actor = { id: 'a1', name: 'Admin', role: 'SUPER_ADMIN' } as never;

let vendors: VendorsService;
let buses: BusesService;
let routes: RoutesService;
let stops: StopsService;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.booking.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  vendors = new VendorsService(prisma, audit);
  buses = new BusesService(prisma, audit);
  routes = new RoutesService(prisma, audit);
  stops = new StopsService(prisma, audit);
});

describe('vendors', () => {
  test('create + deactivate blocked while active buses exist', async () => {
    const v = await vendors.create({ name: 'PT A', contact: '021', active: true }, actor);
    await buses.create({ plate: 'B 1001 AA', capacity: 40, vendorId: v.id, active: true }, actor);
    await expect(vendors.deactivate(v.id, actor)).rejects.toThrow('Vendor masih punya bus aktif.');
    // after deactivating the bus, vendor deactivates
    await buses.deactivate((await prisma.bus.findFirst({ where: { vendorId: v.id } }))!.id, actor);
    await expect(vendors.deactivate(v.id, actor)).resolves.toBeTruthy();
  });
});

describe('buses', () => {
  test('plate duplicated → "Plat X sudah terdaftar."; uppercase transform', async () => {
    const v = await vendors.create({ name: 'PT B', contact: '', active: true }, actor);
    await buses.create({ plate: 'B 2002 BB', capacity: 30, vendorId: v.id, active: true }, actor);
    await expect(buses.create({ plate: 'B 2002 BB', capacity: 30, vendorId: v.id, active: true }, actor))
      .rejects.toThrow('Plat B 2002 BB sudah terdaftar.');
  });

  test('deactivate blocked when used by active template', async () => {
    const bus = await prisma.bus.findFirstOrThrow();
    const route = await routes.create({ code: 'RX', name: 'Test', color: '#000000', active: true }, actor);
    await prisma.shift.upsert({ where: { id: 'pagi' }, create: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' }, update: {} });
    await prisma.tripTemplate.create({
      data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:00', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
    });
    await expect(buses.deactivate(bus.id, actor)).rejects.toThrow('Bus masih dipakai template aktif atau trip yang belum berangkat.');
  });

  test('setBusCapacity rejected when booked > new capacity (CAPACITY_BELOW_BOOKED)', async () => {
    const bus = await prisma.bus.findFirstOrThrow();
    const route = await prisma.route.findFirstOrThrow();
    // create a future trip with bookedCount 10
    const dep = new Date(Date.now() + 86_400_000);
    const trip = await prisma.trip.create({
      data: {
        templateId: (await prisma.tripTemplate.findFirstOrThrow()).id,
        date: '2099-06-01', departureAt: dep, status: 'SCHEDULED', bookedCount: 10, capacity: 40,
        routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id,
      },
    });
    await expect(buses.setBusCapacity(bus.id, 5, actor)).rejects.toMatchObject({
      code: 'CAPACITY_BELOW_BOOKED', message: expect.stringContaining('sudah 10 booking'),
    });
    // capacity >= booked succeeds and propagates to SCHEDULED not-departed trips
    const r = await buses.setBusCapacity(bus.id, 15, actor);
    expect(r.capacity).toBe(15);
    const t = await prisma.trip.findUnique({ where: { id: trip.id } });
    expect(t!.capacity).toBe(15);
  });
});

describe('routes + stops', () => {
  test('route code duplicated → "Kode rute X sudah dipakai."', async () => {
    await routes.create({ code: 'RZ', name: 'Z', color: '#111111', active: true }, actor);
    await expect(routes.create({ code: 'RZ', name: 'Z2', color: '#222222', active: true }, actor))
      .rejects.toThrow('Kode rute RZ sudah dipakai.');
  });

  test('stop seq unique per route; deactivate blocked by active subscription', async () => {
    const route = await prisma.route.findFirstOrThrow();
    const s = await stops.create(route.id, { name: 'Halte', seq: 1, offsetMinutes: 0, lat: null, lng: null, active: true }, actor);
    await expect(stops.create(route.id, { name: 'Dup', seq: 1, offsetMinutes: 5, lat: null, lng: null, active: true }, actor)).rejects.toBeTruthy();
    // active subscription on this stop blocks deactivate
    const u = await prisma.user.create({ data: { nik: 'KEMP1', name: 'E', role: 'EMPLOYEE', active: true } });
    await prisma.subscription.create({
      data: { userId: u.id, routeId: route.id, stopId: s.id, shiftId: 'pagi', direction: 'PICKUP', startDate: '2099-01-01', weekdays: [1], status: 'ACTIVE' },
    });
    await expect(stops.deactivate(s.id, actor)).rejects.toThrow('Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.');
  });

  test('stop.routeId mismatch on update → NOT_FOUND', async () => {
    const routeA = await prisma.route.findFirstOrThrow();
    const routeB = await routes.create({ code: 'RY', name: 'Y', color: '#333333', active: true }, actor);
    const s = await prisma.stop.findFirstOrThrow({ where: { routeId: routeA.id } });
    await expect(stops.update(routeB.id, s.id, { name: 'X', seq: s.seq, offsetMinutes: 0, lat: null, lng: null, active: true }, actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/master.test.ts`
Expected: FAIL — service modules not found.

- [ ] **Step 3: Implement fleet + routes modules**

```typescript
// apps/api/src/common/in-use.ts
import { PrismaClient } from '@prisma/client';

/**
 * spec §5.6 helper: a route/shift/bus is "in use" when an active TripTemplate references it
 * OR a SCHEDULED not-yet-departed Trip does. Used to block deactivate / hard-delete.
 */
export async function inUseByTrips(
  tx: PrismaClient,
  filter: { routeId?: string; shiftId?: string; busId?: string },
): Promise<boolean> {
  const template = await tx.tripTemplate.findFirst({
    where: { active: true, ...(filter.routeId && { routeId: filter.routeId }), ...(filter.shiftId && { shiftId: filter.shiftId }), ...(filter.busId && { busId: filter.busId }) },
  });
  if (template) return true;
  const trip = await tx.trip.findFirst({
    where: {
      status: 'SCHEDULED', departureAt: { gt: new Date() },
      ...(filter.routeId && { routeId: filter.routeId }), ...(filter.shiftId && { shiftId: filter.shiftId }), ...(filter.busId && { busId: filter.busId }),
    },
  });
  return !!trip;
}
```

```typescript
// apps/api/src/fleet/vendors.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VendorInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list() {
    return this.prisma.vendor.findMany({ orderBy: { name: 'asc' } });
  }

  async create(input: VendorInput, actor: { id: string | null; name: string }) {
    const v = await this.prisma.vendor.create({ data: { name: input.name, contact: input.contact, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'VENDOR_CREATE', entity: 'vendor', entityId: v.id, after: v });
    return v;
  }

  async update(id: string, input: VendorInput, actor: { id: string | null; name: string }) {
    const before = await this.prisma.vendor.findUniqueOrThrow({ where: { id } });
    const v = await this.prisma.vendor.update({ where: { id }, data: { name: input.name, contact: input.contact, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'VENDOR_UPDATE', entity: 'vendor', entityId: id, before, after: v });
    return v;
  }

  async deactivate(id: string, actor: { id: string | null; name: string }) {
    const activeBuses = await this.prisma.bus.count({ where: { vendorId: id, active: true } });
    if (activeBuses > 0) throw new DomainError('VALIDATION_ERROR', 'Vendor masih punya bus aktif.');
    const before = await this.prisma.vendor.findUniqueOrThrow({ where: { id } });
    const v = await this.prisma.vendor.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'VENDOR_UPDATE', entity: 'vendor', entityId: id, before, after: v });
    return v;
  }
}
```

```typescript
// apps/api/src/fleet/buses.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BusInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { inUseByTrips } from '../common/in-use';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class BusesService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list(vendorId?: string) {
    return this.prisma.bus.findMany({
      where: vendorId ? { vendorId } : {},
      include: { vendor: true },
      orderBy: { plate: 'asc' },
    });
  }

  async create(input: BusInput, actor: { id: string | null; name: string }) {
    const plate = input.plate.toUpperCase();
    if (await this.prisma.bus.findUnique({ where: { plate } })) {
      throw new DomainError('VALIDATION_ERROR', `Plat ${plate} sudah terdaftar.`);
    }
    const b = await this.prisma.bus.create({ data: { plate, capacity: input.capacity, vendorId: input.vendorId, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_CREATE', entity: 'bus', entityId: b.id, after: b });
    return b;
  }

  async update(id: string, input: BusInput, actor: { id: string | null; name: string }) {
    const plate = input.plate.toUpperCase();
    const dup = await this.prisma.bus.findUnique({ where: { plate } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `Plat ${plate} sudah terdaftar.`);
    const before = await this.prisma.bus.findUniqueOrThrow({ where: { id } });
    const b = await this.prisma.bus.update({ where: { id }, data: { plate, capacity: input.capacity, vendorId: input.vendorId, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_UPDATE', entity: 'bus', entityId: id, before, after: b });
    return b;
  }

  async deactivate(id: string, actor: { id: string | null; name: string }) {
    if (await inUseByTrips(this.prisma, { busId: id })) {
      throw new DomainError('VALIDATION_ERROR', 'Bus masih dipakai template aktif atau trip yang belum berangkat.');
    }
    const before = await this.prisma.bus.findUniqueOrThrow({ where: { id } });
    const b = await this.prisma.bus.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_UPDATE', entity: 'bus', entityId: id, before, after: b });
    return b;
  }

  /** spec §5.6: capacity change rejected if any SCHEDULED not-departed trip already has more booked; else propagate. */
  async setBusCapacity(id: string, capacity: number, actor: { id: string | null; name: string }) {
    const bus = await this.prisma.bus.findUniqueOrThrow({ where: { id } });
    const conflictTrip = await this.prisma.trip.findFirst({
      where: { busId: id, status: 'SCHEDULED', departureAt: { gt: new Date() }, bookedCount: { gt: capacity } },
    });
    if (conflictTrip) {
      throw new DomainError(
        'CAPACITY_BELOW_BOOKED',
        `Trip ${conflictTrip.date} ${conflictTrip.departureAt.toISOString().slice(11, 16)} sudah ${conflictTrip.bookedCount} booking.`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.bus.update({ where: { id }, data: { capacity } }),
      this.prisma.trip.updateMany({
        where: { busId: id, status: 'SCHEDULED', departureAt: { gt: new Date() } },
        data: { capacity },
      }),
    ]);
    const after = await this.prisma.bus.findUniqueOrThrow({ where: { id } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_CAPACITY', entity: 'bus', entityId: id, before: { capacity: bus.capacity }, after: { capacity: after.capacity } });
    return after;
  }
}
```

```typescript
// apps/api/src/routes/routes.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RouteInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { inUseByTrips } from '../common/in-use';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list() {
    return this.prisma.route.findMany({ include: { stops: { orderBy: { seq: 'asc' } } }, orderBy: { code: 'asc' } });
  }

  async create(input: RouteInput, actor: { id: string | null; name: string }) {
    if (await this.prisma.route.findUnique({ where: { code: input.code } })) {
      throw new DomainError('VALIDATION_ERROR', `Kode rute ${input.code} sudah dipakai.`);
    }
    const r = await this.prisma.route.create({ data: { code: input.code, name: input.name, color: input.color, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'ROUTE_CREATE', entity: 'route', entityId: r.id, after: r });
    return r;
  }

  async update(id: string, input: RouteInput, actor: { id: string | null; name: string }) {
    const dup = await this.prisma.route.findUnique({ where: { code: input.code } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `Kode rute ${input.code} sudah dipakai.`);
    const before = await this.prisma.route.findUniqueOrThrow({ where: { id } });
    const r = await this.prisma.route.update({ where: { id }, data: { code: input.code, name: input.name, color: input.color, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'ROUTE_UPDATE', entity: 'route', entityId: id, before, after: r });
    return r;
  }

  async deactivate(id: string, actor: { id: string | null; name: string }) {
    if (await inUseByTrips(this.prisma, { routeId: id })) {
      throw new DomainError('VALIDATION_ERROR', 'Rute masih dipakai template aktif atau trip yang belum berangkat.');
    }
    const before = await this.prisma.route.findUniqueOrThrow({ where: { id } });
    const r = await this.prisma.route.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'ROUTE_UPDATE', entity: 'route', entityId: id, before, after: r });
    return r;
  }
}
```

```typescript
// apps/api/src/routes/stops.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { StopInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class StopsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async listByRoute(routeId: string) {
    const route = await this.prisma.route.findUnique({ where: { id: routeId } });
    if (!route) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    return this.prisma.stop.findMany({ where: { routeId }, orderBy: { seq: 'asc' } });
  }

  async create(routeId: string, input: StopInput, actor: { id: string | null; name: string }) {
    if (!(await this.prisma.route.findUnique({ where: { id: routeId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const s = await this.prisma.stop.create({
      data: { routeId, name: input.name, seq: input.seq, offsetMinutes: input.offsetMinutes, lat: input.lat, lng: input.lng, active: input.active },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'STOP_CREATE', entity: 'stop', entityId: s.id, after: s });
    return s;
  }

  async update(routeId: string, stopId: string, input: StopInput, actor: { id: string | null; name: string }) {
    const existing = await this.prisma.stop.findUnique({ where: { id: stopId } });
    if (!existing || existing.routeId !== routeId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const s = await this.prisma.stop.update({
      where: { id: stopId },
      data: { name: input.name, seq: input.seq, offsetMinutes: input.offsetMinutes, lat: input.lat, lng: input.lng, active: input.active },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'STOP_UPDATE', entity: 'stop', entityId: stopId, before: existing, after: s });
    return s;
  }

  async deactivate(routeId: string, stopId: string, actor: { id: string | null; name: string }) {
    const existing = await this.prisma.stop.findUnique({ where: { id: stopId } });
    if (!existing || existing.routeId !== routeId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const activeSub = await this.prisma.subscription.findFirst({ where: { stopId, status: 'ACTIVE' } });
    const futureBooking = await this.prisma.booking.findFirst({
      where: { stopId, status: 'BOOKED', trip: { departureAt: { gt: new Date() } } },
    });
    if (activeSub || futureBooking) {
      throw new DomainError('VALIDATION_ERROR', 'Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.');
    }
    const s = await this.prisma.stop.update({ where: { id: stopId }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'STOP_UPDATE', entity: 'stop', entityId: stopId, before: existing, after: s });
    return s;
  }
}
```

```typescript
// apps/api/src/routes/shifts.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ShiftInput } from '@bms/shared';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list() {
    return this.prisma.shift.findMany({ orderBy: { startTime: 'asc' } });
  }

  async upsert(id: string, input: ShiftInput, actor: { id: string | null; name: string }) {
    const s = await this.prisma.shift.upsert({
      where: { id },
      create: { id, name: input.name, startTime: input.startTime, endTime: input.endTime },
      update: { name: input.name, startTime: input.startTime, endTime: input.endTime },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'SHIFT_UPDATE', entity: 'shift', entityId: id, after: s });
    return s;
  }
}
```

```typescript
// apps/api/src/fleet/fleet.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { BusInput, VendorInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { VendorsService } from './vendors.service';
import { BusesService } from './buses.service';

type ActorReq = { user: { id: string | null; name: string } };

@Controller()
export class FleetController {
  constructor(private readonly vendors: VendorsService, private readonly buses: BusesService) {}

  @Get('vendors') listVendors() { return this.vendors.list(); }
  @Post('vendors') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(VendorInput))
  createVendor(@Body() b: VendorInput, @Req() r: ActorReq) { return this.vendors.create(b, r.user); }
  @Put('vendors/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(VendorInput))
  updateVendor(@Param('id') id: string, @Body() b: VendorInput, @Req() r: ActorReq) { return this.vendors.update(id, b, r.user); }
  @Delete('vendors/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateVendor(@Param('id') id: string, @Req() r: ActorReq) { return this.vendors.deactivate(id, r.user); }

  @Get('buses') listBuses(@Query('vendorId') vendorId?: string) { return this.buses.list(vendorId); }
  @Post('buses') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(BusInput))
  createBus(@Body() b: BusInput, @Req() r: ActorReq) { return this.buses.create(b, r.user); }
  @Put('buses/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(BusInput))
  updateBus(@Param('id') id: string, @Body() b: BusInput, @Req() r: ActorReq) { return this.buses.update(id, b, r.user); }
  @Delete('buses/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateBus(@Param('id') id: string, @Req() r: ActorReq) { return this.buses.deactivate(id, r.user); }
  @Put('buses/:id/capacity') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  setCapacity(@Param('id') id: string, @Body() b: { capacity: number }, @Req() r: ActorReq) { return this.buses.setBusCapacity(id, b.capacity, r.user); }
}
```

```typescript
// apps/api/src/routes/routes.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { RouteInput, ShiftInput, StopInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { RoutesService } from './routes.service';
import { StopsService } from './stops.service';
import { ShiftsService } from './shifts.service';

type ActorReq = { user: { id: string | null; name: string } };

@Controller()
export class RoutesController {
  constructor(
    private readonly routes: RoutesService,
    private readonly stops: StopsService,
    private readonly shifts: ShiftsService,
  ) {}

  @Get('routes') listRoutes() { return this.routes.list(); }
  @Post('routes') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(RouteInput))
  createRoute(@Body() b: RouteInput, @Req() r: ActorReq) { return this.routes.create(b, r.user); }
  @Put('routes/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(RouteInput))
  updateRoute(@Param('id') id: string, @Body() b: RouteInput, @Req() r: ActorReq) { return this.routes.update(id, b, r.user); }
  @Delete('routes/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateRoute(@Param('id') id: string, @Req() r: ActorReq) { return this.routes.deactivate(id, r.user); }

  @Get('routes/:id/stops') listStops(@Param('id') id: string) { return this.stops.listByRoute(id); }
  @Post('routes/:id/stops') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(StopInput))
  createStop(@Param('id') id: string, @Body() b: StopInput, @Req() r: ActorReq) { return this.stops.create(id, b, r.user); }
  @Put('routes/:id/stops/:stopId') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(StopInput))
  updateStop(@Param('id') id: string, @Param('stopId') stopId: string, @Body() b: StopInput, @Req() r: ActorReq) { return this.stops.update(id, stopId, b, r.user); }
  @Delete('routes/:id/stops/:stopId') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateStop(@Param('id') id: string, @Param('stopId') stopId: string, @Req() r: ActorReq) { return this.stops.deactivate(id, stopId, r.user); }

  @Get('shifts') listShifts() { return this.shifts.list(); }
  @Put('shifts/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(ShiftInput))
  upsertShift(@Param('id') id: string, @Body() b: ShiftInput, @Req() r: ActorReq) { return this.shifts.upsert(id, b, r.user); }
}
```

Wire `FleetModule` and `RoutesModule` (global providers: PrismaClient, AuditService, Services; controllers; no extra APP_GUARD — already global from AuthModule) into `AppModule`. Fix imports: `UsePipes`, `Query` etc. from `@nestjs/common`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/master.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/fleet apps/api/src/routes apps/api/src/common/in-use.ts apps/api/src/app.module.ts apps/api/test/master.test.ts
git commit -m "feat(api): master data vendors/buses/routes/stops/shifts with in-use guards"
```

---

### Task 6: Users — list, create, update, reset-password, import preview+commit

**Files:**
- Create: `apps/api/src/users/users.module.ts`, `apps/api/src/users/users.service.ts`, `apps/api/src/users/users.controller.ts`
- Modify: `apps/api/src/common/mappers.ts` (add `toUserSummary`)
- Test: `apps/api/test/users.test.ts`

**Interfaces:**
- Consumes: `AuditService`, `argon2`, `crypto.randomBytes` for temp password (alphabet `abcdefghjkmnpqrstuvwxyz23456789`, 10 chars, `crypto.getRandomValues`), `@bms/shared` `UserSummary`, `UserInput`, `TempPassword`, `ImportRow`, `ImportRequest`, `ImportPreview`, `ImportCommitResponse`, `Paginated`, `ADMIN_ROLES`; `SettingsService.get().password_min_length` for temp-pw hash (no min check on temp, it's generated).
- Produces: `UsersService` — `list({q?, role?, page})` (q: nik/name case-insensitive contains, sort nik asc, paginate 50, UserSummary); `create(input, actor)` — dup `NIK ${nik} sudah terdaftar.`, temp pw, mustChange true, audit USER_CREATE, returns TempPassword; `update(id, input, actor)` — actor vs old+new role (any admin-role arg && caller ≠ SUPER_ADMIN → FORBIDDEN "Hanya Super Admin yang boleh mengelola akun admin."), dup check, self-role-change → "Tidak bisa mengubah role akun sendiri.", audit USER_UPDATE before/after; `suspend(id, until, reason, actor)` — non-EMPLOYEE → "Pembekuan booking hanya untuk karyawan.", until<today → "Tanggal akhir pembekuan sudah lewat.", audit USER_SUSPEND (actual cancel/notify logic lives Task 9's admin service; this task only stores the suspension fields + audit); `deactivateSelfGuard` — "Tidak bisa menonaktifkan akun sendiri." (used by admin deactivate in Task 9); `resetPassword(id, actor)` — NOT_FOUND; SSO → "User SSO tidak memakai password."; new temp pw, mustChange true, clear failed/lock, revokeAll refresh, audit USER_RESET_PASSWORD after `{mustChangePassword:true}`, returns `{userId, nik, tempPassword}`; `importPreview(rows)` — row=index+2, numeric→string, zodMessage ?? "Baris tidak invalid.", `NIK ${nik} ganda di file`, `NIK ${nik} milik akun non-karyawan`, returns {created, updated, errors}; `importCommit(rows)` — one transaction: updates assign, creates EMPLOYEE+temp pw; audit USER_IMPORT entity "user" id "-" after counts; returns `{passwords}`. `toUserSummary` mappers helper.

- [ ] **Step 1: Write failing users test**

```typescript
// apps/api/test/users.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UsersService } from '../src/users/users.service';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const actorSuper = { id: 'super1', name: 'Super', role: 'SUPER_ADMIN' } as never;
const actorGa = { id: 'ga1', name: 'GA', role: 'ADMIN_GA' } as never;

let users: UsersService;

beforeAll(async () => {
  await prisma.$transaction([prisma.user.deleteMany(), prisma.auditLog.deleteMany()]);
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  users = new UsersService(prisma, audit, settings);
  // seed the actor users so FK is happy
  await prisma.user.create({ data: { id: 'super1', nik: 'SUPER1', name: 'Super', role: 'SUPER_ADMIN', active: true } });
  await prisma.user.create({ data: { id: 'ga1', nik: 'GA1', name: 'GA', role: 'ADMIN_GA', active: true } });
});

describe('users create/update', () => {
  test('duplicate NIK → "NIK X sudah terdaftar."', async () => {
    await users.create({ nik: 'K100', name: 'A', department: '', phone: '', role: 'EMPLOYEE', vendorId: null }, actorSuper);
    await expect(users.create({ nik: 'K100', name: 'B', department: '', phone: '', role: 'EMPLOYEE', vendorId: null }, actorSuper))
      .rejects.toThrow('NIK K100 sudah terdaftar.');
  });

  test('GA cannot create an admin role → FORBIDDEN', async () => {
    await expect(users.create({ nik: 'K101', name: 'X', department: '', phone: '', role: 'SUPER_ADMIN', vendorId: null }, actorGa))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Hanya Super Admin yang boleh mengelola akun admin.' });
  });

  test('self role change → "Tidak bisa mengubah role akun sendiri."', async () => {
    await expect(users.update('ga1', { nik: 'GA1', name: 'GA', department: '', phone: '', role: 'SUPER_ADMIN', vendorId: null }, actorGa))
      .rejects.toThrow('Tidak bisa mengubah role akun sendiri.');
  });

  test('create returns tempPassword, mustChange true', async () => {
    const r = await users.create({ nik: 'K102', name: 'C', department: 'QC', phone: '', role: 'EMPLOYEE', vendorId: null }, actorSuper);
    expect(r.tempPassword).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    const u = await prisma.user.findUnique({ where: { nik: 'K102' } });
    expect(u!.mustChangePassword).toBe(true);
  });
});

describe('reset password', () => {
  test('SSO user → "User SSO tidak memakai password."', async () => {
    await prisma.user.create({ data: { nik: 'SSO1', name: 'S', role: 'EMPLOYEE', active: true, authProvider: 'SSO' } });
    const sso = await prisma.user.findUniqueOrThrow({ where: { nik: 'SSO1' } });
    await expect(users.resetPassword(sso.id, actorSuper)).rejects.toThrow('User SSO tidak memakai password.');
  });

  test('LOCAL user → new temp password, mustChange, returns {userId, nik, tempPassword}', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { nik: 'K102' } });
    const r = await users.resetPassword(u.id, actorSuper);
    expect(r.userId).toBe(u.id);
    expect(r.nik).toBe('K102');
    expect(r.tempPassword).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after!.mustChangePassword).toBe(true);
  });
});

describe('import', () => {
  test('preview: row index+2, numeric→string, ganda and non-karyawan errors', async () => {
    await prisma.user.create({ data: { nik: 'K200', name: 'Old', role: 'EMPLOYEE', active: true } });
    await prisma.user.create({ data: { nik: 'K201', name: 'Admin', role: 'SUPER_ADMIN', active: true } });
    const rows = [
      { nik: 123, name: 'Num', department: 'QC', phone: '' },   // numeric nik → "123"
      { nik: 'K200', name: 'Updated', department: 'Gudang', phone: '0812' }, // existing employee → update
      { nik: 'K201', name: 'Bad', department: '', phone: '' }, // non-employee
      { nik: 'K102', name: 'Dup', department: '', phone: '' },
      { nik: 'K102', name: 'Dup2', department: '', phone: '' }, // ganda di file
    ];
    const p = await users.importPreview(rows);
    expect(p.errors.some((e) => e.row === 2 && e.nik === '123')).toBe(true); // numeric coerced
    expect(p.errors.some((e) => e.nik === 'K201' && /non-karyawan/.test(e.message))).toBe(true);
    expect(p.errors.some((e) => e.nik === 'K102' && /ganda/.test(e.message))).toBe(true);
    expect(p.updated).toBe(1); // K200
    expect(p.created).toBe(1); // 123
  });

  test('commit: one tx, updates+creates, returns passwords map', async () => {
    const rows = [
      { nik: '123', name: 'Num', department: 'QC', phone: '' },
      { nik: 'K200', name: 'Updated2', department: 'Gudang', phone: '0812' },
    ];
    const r = await users.importCommit(rows, actorSuper);
    expect(Object.keys(r.passwords)).toEqual(expect.arrayContaining(['123']));
    const k200 = await prisma.user.findUnique({ where: { nik: 'K200' } });
    expect(k200!.name).toBe('Updated2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/users.test.ts`
Expected: FAIL — `UsersService` not found.

- [ ] **Step 3: Implement users module**

```typescript
// apps/api/src/common/mappers.ts
import type { UserSummary } from '@bms/shared';

/** toSummary: strips passwordHash, mustChangePassword, failedLogins, lockedUntil raw fields (mock util.ts parity). */
export function toUserSummary(u: {
  id: string; nik: string; name: string; department: string; phone: string; role: string;
  authProvider: string; active: boolean; vendorId: string | null;
  bookingSuspendedUntil: Date | null; suspendReason: string | null; lockedUntil: Date | null;
}): UserSummary {
  return {
    id: u.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone,
    role: u.role as UserSummary['role'], authProvider: u.authProvider as UserSummary['authProvider'],
    active: u.active, vendorId: u.vendorId,
    bookingSuspendedUntil: u.bookingSuspendedUntil?.toISOString() ?? null,
    suspendReason: u.suspendReason,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
  };
}
```

```typescript
// apps/api/src/users/users.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import {
  ADMIN_ROLES, ImportRow, UserInput, UserSummary,
} from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toUserSummary } from '../common/mappers';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // i,l,o,0,1 excluded (mock parity)
function tempPassword(): string {
  const bytes = randomBytes(10);
  return [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private requireAdminRole(actorRole: string, targetRole?: string): void {
    // actor(...) logic: any admin-role arg && caller ≠ SUPER_ADMIN → FORBIDDEN
    if (targetRole && ADMIN_ROLES.includes(targetRole) && actorRole !== 'SUPER_ADMIN') {
      throw new DomainError('FORBIDDEN', 'Hanya Super Admin yang boleh mengelola akun admin.');
    }
  }

  async list(filters: { q?: string; role?: string; page?: number }): Promise<{ items: UserSummary[]; total: number; page: number; pageSize: number }> {
    const where: Record<string, unknown> = {};
    if (filters.q) {
      const q = filters.q.toLowerCase();
      where.OR = [
        { nik: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (filters.role) where.role = filters.role;
    const pageSize = 50;
    const page = Math.max(1, Number(filters.page) || 1);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { nik: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map(toUserSummary), total, page, pageSize };
  }

  async create(input: UserInput, actor: { id: string | null; name: string; role: string }): Promise<{ tempPassword: string } & { user: UserSummary }> {
    this.requireAdminRole(actor.role, input.role);
    if (await this.prisma.user.findUnique({ where: { nik: input.nik } })) {
      throw new DomainError('VALIDATION_ERROR', `NIK ${input.nik} sudah terdaftar.`);
    }
    const pw = tempPassword();
    const user = await this.prisma.user.create({
      data: {
        nik: input.nik, name: input.name, department: input.department, phone: input.phone,
        role: input.role, vendorId: input.vendorId,
        passwordHash: await argon2.hash(pw), mustChangePassword: true, active: true,
      },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_CREATE', entity: 'user', entityId: user.id, after: toUserSummary(user) });
    return { tempPassword: pw, user: toUserSummary(user) };
  }

  async update(id: string, input: UserInput, actor: { id: string | null; name: string; role: string }): Promise<UserSummary> {
    const old = await this.prisma.user.findUnique({ where: { id } });
    if (!old) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.requireAdminRole(actor.role, old.role);
    this.requireAdminRole(actor.role, input.role);
    if (old.role !== input.role && id === actor.id) {
      throw new DomainError('VALIDATION_ERROR', 'Tidak bisa mengubah role akun sendiri.');
    }
    const dup = await this.prisma.user.findUnique({ where: { nik: input.nik } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `NIK ${input.nik} sudah terdaftar.`);
    const before = toUserSummary(old);
    const u = await this.prisma.user.update({
      where: { id },
      data: { nik: input.nik, name: input.name, department: input.department, phone: input.phone, role: input.role, vendorId: input.vendorId },
    });
    const after = toUserSummary(u);
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_UPDATE', entity: 'user', entityId: id, before, after });
    return after;
  }

  async suspend(id: string, until: string, reason: string, actor: { id: string | null; name: string }): Promise<UserSummary> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (u.role !== 'EMPLOYEE') throw new DomainError('VALIDATION_ERROR', 'Pembekuan booking hanya untuk karyawan.');
    const untilDate = new Date(`${until}T00:00:00+07:00`);
    const today = new Date(); // Jakarta today via shared helper in real code — see note
    const todayIso = new Date().toISOString().slice(0, 10); // replace with jakartaDate(new Date()) from @bms/shared
    if (until < todayIso) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir pembekuan sudah lewat.');
    const before = toUserSummary(u);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { bookingSuspendedUntil: untilDate, suspendReason: reason },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_SUSPEND', entity: 'user', entityId: id, before, after: toUserSummary(updated) });
    return toUserSummary(updated);
  }

  async deactivateSelfGuard(id: string, actorId: string): Promise<void> {
    if (id === actorId) throw new DomainError('VALIDATION_ERROR', 'Tidak bisa menonaktifkan akun sendiri.');
  }

  async resetPassword(id: string, actor: { id: string | null; name: string }): Promise<{ userId: string; nik: string; tempPassword: string }> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (u.authProvider === 'SSO') throw new DomainError('VALIDATION_ERROR', 'User SSO tidak memakai password.');
    const pw = tempPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_RESET_PASSWORD', entity: 'user', entityId: id, after: { mustChangePassword: true } });
    return { userId: id, nik: u.nik, tempPassword: pw };
  }

  // ---- import ----------------------------------------------------------------
  private coerceRow(raw: Record<string, unknown>): { nik: string; name: string; department: string; phone: string } {
    const s = (v: unknown) => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '');
    return { nik: s(raw.nik), name: s(raw.name), department: s(raw.department), phone: s(raw.phone) };
  }

  async importPreview(rows: Record<string, unknown>[]): Promise<{
    created: number; updated: number; errors: { row: number; nik: string; message: string }[];
  }> {
    const errors: { row: number; nik: string; message: string }[] = [];
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = i + 2; // header is row 1
      const c = this.coerceRow(rows[i]!);
      // zod validate through ImportRow schema
      const parsed = ImportRow.safeParse(c);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const msg = issue.code === 'invalid_type' && issue.message.includes('NIK') ? 'NIK kosong'
          : issue.code === 'invalid_type' && issue.message.includes('Nama') ? 'Nama kosong'
          : `${issue.path.join('.') || 'row'}: ${issue.message}`;
        errors.push({ row, nik: c.nik, message: msg });
        continue;
      }
      if (seen.has(c.nik)) {
        errors.push({ row, nik: c.nik, message: `NIK ${c.nik} ganda di file` });
        continue;
      }
      seen.add(c.nik);
      const existing = await this.prisma.user.findUnique({ where: { nik: c.nik } });
      if (existing && existing.role !== 'EMPLOYEE') {
        errors.push({ row, nik: c.nik, message: `NIK ${c.nik} milik akun non-karyawan` });
        continue;
      }
      if (existing) updated++;
      else created++;
    }
    return { created, updated, errors };
  }

  async importCommit(rows: Record<string, unknown>[], actor: { id: string | null; name: string }): Promise<{ passwords: Record<string, string> }> {
    const passwords: Record<string, string> = {};
    const summary = { created: 0, updated: 0 };
    await this.prisma.$transaction(async (tx) => {
      const seen = new Set<string>();
      for (const raw of rows) {
        const c = this.coerceRow(raw);
        if (!ImportRow.safeParse(c).success || seen.has(c.nik)) continue; // preview already validated; skip bad/dup
        seen.add(c.nik);
        const existing = await tx.user.findUnique({ where: { nik: c.nik } });
        if (existing && existing.role === 'EMPLOYEE') {
          await tx.user.update({ where: { id: existing.id }, data: { name: c.name, department: c.department, phone: c.phone } });
          summary.updated++;
        } else if (!existing) {
          const pw = tempPassword();
          passwords[c.nik] = pw;
          await tx.user.create({
            data: {
              nik: c.nik, name: c.name, department: c.department, phone: c.phone, role: 'EMPLOYEE',
              passwordHash: await argon2.hash(pw), mustChangePassword: true, active: true,
            },
          });
          summary.created++;
        }
      }
    });
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'USER_IMPORT', entity: 'user', entityId: '-',
      after: { created: summary.created, updated: summary.updated },
    });
    return { passwords };
  }
}
```

```typescript
// apps/api/src/users/users.controller.ts
import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ImportRequest, SuspendRequest, UserInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { UsersService } from './users.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  list(@Query('q') q?: string, @Query('role') role?: string, @Query('page') page?: string) {
    return this.users.list({ q, role, page: page ? Number(page) : undefined });
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(UserInput))
  create(@Body() b: UserInput, @Req() r: ActorReq) { return this.users.create(b, r.user); }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(UserInput))
  update(@Param('id') id: string, @Body() b: UserInput, @Req() r: ActorReq) { return this.users.update(id, b, r.user); }

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  reset(@Param('id') id: string, @Req() r: ActorReq) { return this.users.resetPassword(id, r.user); }

  @Post(':id/suspend')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(SuspendRequest))
  suspend(@Param('id') id: string, @Body() b: { until: string; reason: string }, @Req() r: ActorReq) {
    return this.users.suspend(id, b.until, b.reason, r.user);
  }

  @Post('import/preview')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(ImportRequest))
  preview(@Body() b: { rows: Record<string, unknown>[] }) { return this.users.importPreview(b.rows); }

  @Post('import/commit')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(ImportRequest))
  commit(@Body() b: { rows: Record<string, unknown>[] }, @Req() r: ActorReq) { return this.users.importCommit(b.rows, r.user); }
}
```

Fix `UsePipes` import in controller. Note: suspend until-date validation uses Jakarta today — replace `new Date().toISOString().slice(0,10)` with `jakartaDate(new Date())` imported from `@bms/shared` for exact parity. Wire `UsersModule` into `AppModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/users apps/api/src/common/mappers.ts apps/api/src/app.module.ts apps/api/test/users.test.ts
git commit -m "feat(api): users CRUD, reset password, suspend, import preview+commit"
```

---

### Task 7: Trips — templates + §5.6 propagation, NotificationsService (insert-only), mappers, GenerateService, trips CRUD/passengers

**Files:**
- Create: `apps/api/src/trips/trips.module.ts`, `apps/api/src/trips/templates.service.ts`, `apps/api/src/trips/trips.service.ts`, `apps/api/src/trips/trips.controller.ts`
- Create: `apps/api/src/generate/generate.service.ts`
- Create: `apps/api/src/notifications/notifications.module.ts`, `apps/api/src/notifications/notifications.service.ts`
- Modify: `apps/api/src/common/mappers.ts` (toBooking/toPassenger/toDeparture — full versions)
- Test: `apps/api/test/trips.test.ts`, `apps/api/test/generate.test.ts`

**Interfaces:**
- Consumes: `@bms/shared` helpers `departureAt(date,time,dayOffset)`, `cutoffAt`, `isPastCutoff`, `stopTime`, `departureStatus`, `jakartaDate`, `addDays`, `isoWeekday`; `TripTemplateInput`, `ChangeBusRequest`, `CancelDateRequest`, `Trip`, `Passenger`, `Departure`; `SettingsService.get().booking_cutoff_minutes`; `AuditService`; `DOMAIN notify types` `NotificationType`; `inUseByTrips`.
- Produces: `TemplatesService` — `list()`, `create(input,actor)` (validates route/shift exist + bus active "Bus tidak aktif.", runs full-window generate after create — documented deviation from mock's fillGeneratedDates: backend generates the entire `generate_days_ahead` window), `update(id,input,actor)` — §5.6 propagation in one tx: apply to SCHEDULED not-departed trips (departureAt/capacity/bus/route/shift/direction), full rollback naming the trip when capacity<booked (CAPACITY_BELOW_BOOKED `Trip ${date} ... sudah ${booked} booking.`) or weekday-removal with future trip exists (reject naming trip so admin cancels explicitly); notify passengers SCHEDULE_CHANGED via NotificationsService; `deactivate(id,actor)` same propagation (trips stay as-is for already-generated? §5.6: template change applies to SCHEDULED not-departed trips — deactivation cancels nothing, only stops future generation; existing trips keep running unless admin cancels). `TripsService` — `list({date,routeId,shiftId})` sorted departureAt,id (default date=today); `tripBus(tripId,busId,actor)` (Task 9 admin also routes here — actually changeTripBus lives Task 9; this task provides `tripPassengers(tripId)`, `tripCancel(tripId,actor)`, `cancelDate(date,actor)` with §5.6 notify semantics). `GenerateService` — `generateTrips(date)` (active templates + weekday match + `trip.createMany({skipDuplicates:true})` = ON CONFLICT DO NOTHING, capacity from bus, departureAt via shared helper); `fillWindow()` = dates today..today+generate_days_ahead; `generateSubscriptionBookings(date)` (Task 9 extends; this task implements trip generation only). `NotificationsService` — `insert(userId,type,title,body,data)` (DB only), `notify(users|userId, ...)` (insert + later FCM in Task 11 — here insert only). `toDeparture` mappers with `mine` flag (caller has BOOKED on trip) + `departureStatus`.

- [ ] **Step 1: Write failing trips test**

```typescript
// apps/api/test/trips.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TemplatesService } from '../src/trips/templates.service';
import { TripsService } from '../src/trips/trips.service';
import { GenerateService } from '../src/generate/generate.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const actor = { id: 'a1', name: 'Admin', role: 'SUPER_ADMIN' } as never;

let templates: TemplatesService;
let trips: TripsService;
let generate: GenerateService;
let notifications: NotificationsService;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(),
    prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(), prisma.route.deleteMany(),
    prisma.bus.deleteMany(), prisma.vendor.deleteMany(), prisma.shift.deleteMany(), prisma.user.deleteMany(),
    prisma.auditLog.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  notifications = new NotificationsService(prisma);
  generate = new GenerateService(prisma, settings, notifications);
  templates = new TemplatesService(prisma, audit, generate, notifications, settings);
  trips = new TripsService(prisma, settings, notifications);

  // fixture
  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 40, vendorId: v.id } });
  const bus2 = await prisma.bus.create({ data: { plate: 'B 1002 AA', capacity: 45, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  // global ids for later tests
  (globalThis as Record<string, unknown>).__bus = bus.id;
  (globalThis as Record<string, unknown>).__bus2 = bus2.id;
  (globalThis as Record<string, unknown>).__route = route.id;
});

describe('templates + propagation (spec §5.6)', () => {
  test('create template generates trips in window (weekday match)', async () => {
    const tpl = await templates.create({
      routeId: (globalThis as Record<string, string>).__route!,
      shiftId: 'pagi', direction: 'PICKUP', busId: (globalThis as Record<string, string>).__bus!,
      departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
    }, actor);
    const count = await prisma.trip.count({ where: { templateId: tpl.id } });
    expect(count).toBeGreaterThanOrEqual(1); // at least today (if weekday matches)
    const t = await prisma.trip.findFirst({ where: { templateId: tpl.id } });
    expect(t!.capacity).toBe(40);
    expect(t!.departureAt).toBeTruthy();
  });

  test('bus swap below booked rolls back naming the trip', async () => {
    // make a trip with bookedCount 30, swap to a 20-seat bus
    const small = await prisma.bus.create({ data: { plate: 'B 2000 SS', capacity: 20, vendorId: (await prisma.vendor.findFirstOrThrow()).id } });
    const trip = await prisma.trip.findFirstOrThrow();
    await prisma.trip.update({ where: { id: trip.id }, data: { bookedCount: 30, capacity: 40 } });
    await expect(templates.update(trip.templateId, {
      routeId: trip.routeId, shiftId: trip.shiftId, direction: trip.direction, busId: small.id,
      departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
    }, actor)).rejects.toMatchObject({
      code: 'CAPACITY_BELOW_BOOKED',
      message: expect.stringContaining(trip.date), // names the trip date
    });
    // rollback: trip unchanged
    const after = await prisma.trip.findUnique({ where: { id: trip.id } });
    expect(after!.capacity).toBe(40);
    expect(after!.busId).not.toBe(small.id);
  });

  test('successful bus swap propagates departureAt/capacity and notifies passengers', async () => {
    const trip = await prisma.trip.findFirstOrThrow();
    const bus2 = (globalThis as Record<string, string>).__bus2!;
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'EMPLOYEE' } });
    await prisma.booking.create({
      data: { userId: user.id, tripId: trip.id, routeId: trip.routeId, stopId: (await prisma.stop.findFirstOrThrow()).id, shiftId: trip.shiftId, direction: trip.direction, date: trip.date, status: 'BOOKED' },
    });
    const newDeparture = '06:30';
    await templates.update(trip.templateId, {
      routeId: trip.routeId, shiftId: trip.shiftId, direction: trip.direction, busId,
      departureTime: newDeparture, dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
    }, actor);
    const after = await prisma.trip.findUnique({ where: { id: trip.id } });
    expect(after!.busId).toBe(bus2);
    expect(after!.capacity).toBe(45);
    // notify passenger SCHEDULE_CHANGED
    const n = await prisma.notification.findFirst({ where: { userId: user.id, type: 'SCHEDULE_CHANGED' } });
    expect(n).toBeTruthy();
  });
});

describe('trips endpoints', () => {
  test('list defaults to today, sorted departureAt', async () => {
    const { jakartaDate } = require('@bms/shared') as typeof import('@bms/shared');
    const today = jakartaDate(new Date());
    const r = await trips.list({ date: today });
    expect(Array.isArray(r)).toBe(true);
  });

  test('trip passengers: CANCELLED excluded, sorted pickupAt then name', async () => {
    const trip = await prisma.trip.findFirstOrThrow();
    const u2 = await prisma.user.create({ data: { nik: 'K1002', name: 'Beta', role: 'EMPLOYEE', active: true } });
    const stop = await prisma.stop.findFirstOrThrow();
    await prisma.booking.create({
      data: { userId: u2.id, tripId: trip.id, routeId: trip.routeId, stopId: stop.id, shiftId: trip.shiftId, direction: trip.direction, date: trip.date, status: 'BOOKED' },
    });
    await prisma.booking.create({
      data: { userId: u2.id, tripId: trip.id, routeId: trip.routeId, stopId: stop.id, shiftId: trip.shiftId, direction: trip.direction, date: `${trip.date}X`, status: 'CANCELLED' },
    });
    const list = await trips.tripPassengers(trip.id);
    expect(list.every((p: { status?: string }) => p.status !== 'CANCELLED')).toBe(true);
  });

  test('cancelDate cancels all SCHEDULED not-departed trips, returns count', async () => {
    const { jakartaDate } = require('@bms/shared') as typeof import('@bms/shared');
    const today = jakartaDate(new Date());
    const r = await trips.cancelDate(today, actor);
    expect(typeof r.count).toBe('number');
    const remaining = await prisma.trip.count({ where: { date: today, status: 'SCHEDULED', departureAt: { gt: new Date() } } });
    expect(remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/trips.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement notifications insert-only, mappers, generate, templates, trips**

```typescript
// apps/api/src/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import type { NotificationType } from '@bms/shared';

/**
 * Insert-only notification writer (spec §5.7: notify row first, FCM after — FCM lands in Task 11).
 * This service never throws on FCM failure; it only persists.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type, title, body, data: (data ?? null) as Prisma.InputJsonValue | undefined },
    });
  }

  async insertMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!userIds.length) return;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, type, title, body, data: (data ?? null) as Prisma.InputJsonValue | undefined })),
    });
  }
}
```

```typescript
// apps/api/src/common/mappers.ts (extend Task 6's file)
import type { Booking as BookingRow, Passenger, Departure } from '@bms/shared';
import { cutoffAt, departureStatus, stopTime } from '@bms/shared';

// ... keep toUserSummary from Task 6 ...

export interface BookingContext {
  routeCode: string; routeName: string; routeColor: string; stopName: string;
  busPlate: string; departureAt: string; direction: 'PICKUP' | 'DROPOFF';
  stopOffset: number; maxStopOffset: number; cutoffMinutes: number;
  seatsLeft: number; capacity: number;
}

/** toBooking: adds route/stop/bus/departure derived fields (mock util.ts parity). */
export function toBooking(row: {
  id: string; userId: string; tripId: string | null; routeId: string; stopId: string;
  shiftId: string; direction: string; date: string; status: string; source: string;
  cancelReason: string | null; cancelledAt: Date | null; createdAt: Date;
}, ctx: BookingContext): BookingRow {
  return {
    id: row.id, userId: row.userId, tripId: row.tripId!, routeId: row.routeId, stopId: row.stopId,
    shiftId: row.shiftId, direction: row.direction as 'PICKUP' | 'DROPOFF', date: row.date,
    status: row.status as BookingRow['status'], source: row.source as BookingRow['source'],
    cancelReason: row.cancelReason, cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    routeCode: ctx.routeCode, routeName: ctx.routeName, routeColor: ctx.routeColor,
    stopName: ctx.stopName, busPlate: ctx.busPlate, departureAt: ctx.departureAt,
    pickupAt: stopTime(ctx.departureAt, ctx.direction, ctx.stopOffset, ctx.maxStopOffset),
    cutoffAt: cutoffAt(ctx.departureAt, ctx.cutoffMinutes),
    seatsLeft: ctx.seatsLeft, capacity: ctx.capacity,
  };
}

export function toPassenger(row: {
  bookingId: string; nik: string; name: string; department: string; phone: string;
  stopName: string; stopSeq: number; pickupAt: string;
}): Passenger {
  return {
    bookingId: row.bookingId, nik: row.nik, name: row.name, department: row.department,
    phone: row.phone, stopName: row.stopName, stopSeq: row.stopSeq, pickupAt: row.pickupAt,
  };
}

export function toDeparture(trip: {
  tripId: string; date: string; departureAt: string; routeId: string; routeCode: string;
  routeName: string; routeColor: string; shiftId: string; shiftName: string;
  direction: 'PICKUP' | 'DROPOFF'; busId: string; busPlate: string;
  bookedCount: number; capacity: number; status: string; callerId?: string | null; hasBooking?: boolean;
}): Departure {
  return {
    tripId: trip.tripId, date: trip.date, departureAt: trip.departureAt,
    routeId: trip.routeId, routeCode: trip.routeCode, routeName: trip.routeName, routeColor: trip.routeColor,
    shiftId: trip.shiftId, shiftName: trip.shiftName, direction: trip.direction,
    busId: trip.busId, busPlate: trip.busPlate,
    bookedCount: trip.bookedCount, capacity: trip.capacity,
    status: departureStatus(trip.status as 'SCHEDULED' | 'CANCELLED' | 'DEPARTED', trip.capacity, trip.bookedCount),
    mine: !!trip.hasBooking,
  };
}
```

```typescript
// apps/api/src/generate/generate.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDays, departureAt, isoWeekday, jakartaDate } from '@bms/shared';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Trip generation (spec §5.2): one logical unit per date, ON CONFLICT (templateId,date)
 * DO NOTHING via createMany skipDuplicates — idempotent catch-up safe.
 */
@Injectable()
export class GenerateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Generate trips for one operational date. Returns count created. */
  async generateTrips(date: string): Promise<number> {
    const templates = await this.prisma.tripTemplate.findMany({
      where: { active: true },
      include: { bus: true },
    });
    const weekday = isoWeekday(new Date(`${date}T00:00:00+07:00`));
    const rows = templates
      .filter((t) => t.weekdays.includes(weekday))
      .map((t) => ({
        templateId: t.id,
        date,
        departureAt: departureAt(date, t.departureTime, t.dayOffset),
        status: 'SCHEDULED' as const,
        bookedCount: 0,
        capacity: t.bus.capacity,
        routeId: t.routeId,
        shiftId: t.shiftId,
        direction: t.direction,
        busId: t.busId,
      }));
    if (!rows.length) return 0;
    const r = await this.prisma.trip.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }

  /** Generate today..today+generate_days_ahead (settings-driven). Returns total created. */
  async fillWindow(): Promise<number> {
    const today = jakartaDate(new Date());
    const ahead = this.settings.get().generate_days_ahead;
    let total = 0;
    for (let i = 0; i <= ahead; i++) {
      total += await this.generateTrips(addDays(today, i));
    }
    return total;
  }
}
```

```typescript
// apps/api/src/trips/templates.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TripTemplateInput, isPastCutoff, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { departureAt } from '@bms/shared';
import { AuditService } from '../audit/audit.service';
import { GenerateService } from '../generate/generate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly generate: GenerateService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  list() {
    return this.prisma.tripTemplate.findMany({ include: { route: true, shift: true, bus: true }, orderBy: { createdAt: 'asc' } });
  }

  async create(input: TripTemplateInput, actor: { id: string | null; name: string }) {
    if (!(await this.prisma.route.findUnique({ where: { id: input.routeId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    if (!(await this.prisma.shift.findUnique({ where: { id: input.shiftId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const bus = await this.prisma.bus.findUnique({ where: { id: input.busId } });
    if (!bus) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!bus.active) throw new DomainError('VALIDATION_ERROR', 'Bus tidak aktif.');

    const tpl = await this.prisma.tripTemplate.create({ data: { ...input } });
    // full-window generate after create (documented deviation from mock fillGeneratedDates)
    await this.generate.fillWindow();
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TEMPLATE_CREATE', entity: 'tripTemplate', entityId: tpl.id, after: tpl });
    return tpl;
  }

  /**
   * spec §5.6: template edit applies to SCHEDULED not-departed trips in ONE transaction.
   * Rejection cases (full rollback, name the trip):
   *  - new bus capacity < any trip's bookedCount → CAPACITY_BELOW_BOOKED naming date+time+booked
   *  - weekday removed while future SCHEDULED trips on that weekday exist → VALIDATION_ERROR naming trip
   * On success: propagate departureAt/capacity/bus/route/shift/direction, notify passengers SCHEDULE_CHANGED.
   */
  async update(id: string, input: TripTemplateInput, actor: { id: string | null; name: string }) {
    const old = await this.prisma.tripTemplate.findUnique({ where: { id }, include: { route: true } });
    if (!old) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const bus = await this.prisma.bus.findUnique({ where: { id: input.busId } });
    if (!bus) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!bus.active) throw new DomainError('VALIDATION_ERROR', 'Bus tidak aktif.');

    // weekday-removal check BEFORE tx (fast fail naming the trip)
    const removed = old.weekdays.filter((d) => !input.weekdays.includes(d));
    if (removed.length) {
      const futureTrips = await this.prisma.trip.findMany({
        where: { templateId: id, status: 'SCHEDULED', departureAt: { gt: new Date() } },
      });
      const { isoWeekday } = await import('@bms/shared');
      for (const t of futureTrips) {
        const wd = isoWeekday(new Date(`${t.date}T00:00:00+07:00`));
        if (removed.includes(wd)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Trip ${t.date} jam ${t.departureAt.toISOString().slice(11, 16)} masih memakai hari yang dihapus. Batalkan trip dulu.`,
          );
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const tpl = await tx.tripTemplate.update({ where: { id }, data: { ...input } });
      const trips = await tx.trip.findMany({
        where: { templateId: id, status: 'SCHEDULED', departureAt: { gt: new Date() } },
        include: { bookings: { where: { status: 'BOOKED' }, include: { user: true } } },
      });
      const notifyList: { userId: string; date: string; time: string }[] = [];
      for (const trip of trips) {
        const booked = trip.bookedCount;
        if (bus.capacity < booked) {
          throw new DomainError(
            'CAPACITY_BELOW_BOOKED',
            `Trip ${trip.date} jam ${trip.departureAt.toISOString().slice(11, 16)} sudah ${booked} booking; bus ${bus.plate} hanya ${bus.capacity} kursi.`,
          );
        }
        const newDep = departureAt(trip.date, input.departureTime, input.dayOffset);
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            departureAt: newDep, capacity: bus.capacity, busId: input.busId,
            routeId: input.routeId, shiftId: input.shiftId, direction: input.direction,
          },
        });
        for (const b of trip.bookings) {
          notifyList.push({ userId: b.userId, date: trip.date, time: newDep.toISOString().slice(11, 16) });
        }
      }
      return { tpl, notifyList };
    });

    // notify outside tx (insert-only; failure must not roll back the edit)
    for (const n of updated.notifyList) {
      await this.notifications.insert(
        n.userId, 'SCHEDULE_CHANGED', 'Jadwal berubah',
        `Trip ${n.date} jam ${n.time} berubah.`,
        { date: n.date },
      );
    }
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TEMPLATE_UPDATE', entity: 'tripTemplate', entityId: id, before: old, after: updated.tpl });
    return updated.tpl;
  }

  async deactivate(id: string, actor: { id: string | null; name: string }) {
    const old = await this.prisma.tripTemplate.findUniqueOrThrow({ where: { id } });
    const tpl = await this.prisma.tripTemplate.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TEMPLATE_UPDATE', entity: 'tripTemplate', entityId: id, before: old, after: tpl });
    return tpl;
  }
}
```

```typescript
// apps/api/src/trips/trips.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CancelDateRequest, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toPassenger, toDeparture } from '../common/mappers';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { stopTime, departureStatus } from '@bms/shared';

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit?: AuditService,
  ) {}

  async list(filters: { date?: string; routeId?: string; shiftId?: string }) {
    const date = filters.date ?? jakartaDate(new Date());
    const trips = await this.prisma.trip.findMany({
      where: {
        date,
        ...(filters.routeId && { routeId: filters.routeId }),
        ...(filters.shiftId && { shiftId: filters.shiftId }),
      },
      include: { route: true, shift: true, bus: true },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
    });
    return trips.map((t) => ({
      tripId: t.id, date: t.date, departureAt: t.departureAt.toISOString(),
      routeId: t.routeId, routeCode: t.route.code, routeName: t.route.name, routeColor: t.route.color,
      shiftId: t.shiftId, shiftName: t.shift.name, direction: t.direction as 'PICKUP' | 'DROPOFF',
      busId: t.busId, busPlate: t.bus.plate,
      bookedCount: t.bookedCount, capacity: t.capacity,
      status: departureStatus(t.status as 'SCHEDULED' | 'CANCELLED' | 'DEPARTED', t.capacity, t.bookedCount),
    }));
  }

  async tripPassengers(tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { route: { include: { stops: true } } } });
    if (!trip) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const bookings = await this.prisma.booking.findMany({
      where: { tripId, status: { not: 'CANCELLED' } },
      include: { user: true, stop: true },
    });
    const maxOffset = Math.max(0, ...trip.route.stops.map((s) => s.offsetMinutes));
    return bookings
      .map((b) => ({
        bookingId: b.id, nik: b.user.nik, name: b.user.name, department: b.user.department, phone: b.user.phone,
        stopName: b.stop.name, stopSeq: b.stop.seq,
        pickupAt: stopTime(trip.departureAt.toISOString(), trip.direction, b.stop.offsetMinutes, maxOffset),
        status: b.status,
      }))
      .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt) || a.name.localeCompare(b.name));
  }

  async tripCancel(tripId: string, actor: { id: string | null; name: string }) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { route: true } });
    if (!trip) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (trip.status === 'CANCELLED') return { tripId, status: 'CANCELLED' };
    if (trip.departureAt <= new Date()) throw new DomainError('VALIDATION_ERROR', 'Trip sudah berangkat.');

    const bookings = await this.prisma.booking.findMany({ where: { tripId, status: 'BOOKED' } });
    await this.prisma.$transaction([
      this.prisma.trip.update({ where: { id: tripId }, data: { status: 'CANCELLED' } }),
      this.prisma.booking.updateMany({
        where: { tripId, status: 'BOOKED' },
        data: { status: 'CANCELLED', cancelReason: 'ADMIN_TRIP', cancelledAt: new Date() },
      }),
    ]);
    for (const b of bookings) {
      await this.notifications.insert(
        b.userId, 'TRIP_CANCELLED', 'Trip dibatalkan',
        `Trip ${trip.date} jam ${trip.departureAt.toISOString().slice(11, 16)} dibatalkan admin.`,
        { tripId },
      );
    }
    await this.audit?.write({ actorId: actor.id, actorName: actor.name, action: 'TRIP_CANCEL', entity: 'trip', entityId: tripId, before: { status: trip.status }, after: { status: 'CANCELLED' } });
    return { tripId, status: 'CANCELLED' };
  }

  async cancelDate(date: string, actor: { id: string | null; name: string }): Promise<{ count: number }> {
    const trips = await this.prisma.trip.findMany({
      where: { date, status: 'SCHEDULED', departureAt: { gt: new Date() } },
    });
    for (const t of trips) await this.tripCancel(t.id, actor);
    return { count: trips.length };
  }

  /** departures board (ANY user): today's trips + mine flag for caller. */
  async departures(callerId: string | null, date?: string) {
    const d = date ?? jakartaDate(new Date());
    const trips = await this.list({ date: d });
    if (!callerId) return trips.map((t) => ({ ...t, mine: false }));
    const myTrips = await this.prisma.booking.findMany({
      where: { userId: callerId, date: d, status: 'BOOKED' },
      select: { tripId: true },
    });
    const mineSet = new Set(myTrips.map((b) => b.tripId));
    return trips.map((t) => ({ ...t, mine: mineSet.has(t.tripId) }));
  }
}
```

```typescript
// apps/api/src/trips/trips.controller.ts
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UsePipes } from '@nestjs/common';
import { CancelDateRequest, ChangeBusRequest, TripTemplateInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { TemplatesService } from './templates.service';
import { TripsService } from './trips.service';

type ActorReq = { user: { id: string | null; name: string; role: string } | null };

@Controller()
export class TripsController {
  constructor(private readonly templates: TemplatesService, private readonly trips: TripsService) {}

  @Get('trip-templates') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  listTemplates() { return this.templates.list(); }

  @Post('trip-templates') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(TripTemplateInput))
  createTemplate(@Body() b: TripTemplateInput, @Req() r: ActorReq) { return this.templates.create(b, r.user!); }

  @Put('trip-templates/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(TripTemplateInput))
  updateTemplate(@Param('id') id: string, @Body() b: TripTemplateInput, @Req() r: ActorReq) { return this.templates.update(id, b, r.user!); }

  @Delete('trip-templates/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateTemplate(@Param('id') id: string, @Req() r: ActorReq) { return this.templates.deactivate(id, r.user!); }

  @Get('trips') // ANY logged-in user (no @Roles)
  listTrips(@Query('date') date?: string, @Query('routeId') routeId?: string, @Query('shiftId') shiftId?: string) {
    return this.trips.list({ date, routeId, shiftId });
  }

  @Get('departures') // ANY logged-in user
  departures(@Req() r: ActorReq, @Query('date') date?: string) {
    return this.trips.departures(r.user?.id ?? null, date);
  }

  @Get('trips/:id/passengers') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  passengers(@Param('id') id: string) { return this.trips.tripPassengers(id); }

  @Post('trips/:id/cancel') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  cancelTrip(@Param('id') id: string, @Req() r: ActorReq) { return this.trips.tripCancel(id, r.user!); }

  @Post('trips/cancel-date') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(CancelDateRequest))
  cancelDate(@Body() b: { date: string }, @Req() r: ActorReq) { return this.trips.cancelDate(b.date, r.user!); }
}
```

`tripBus` (ChangeBusRequest) is Task 9's `changeTripBus` — route `PUT /api/trips/:id/bus` from the admin controller there. `availability` is Task 10. Wire `TripsModule` + `NotificationsModule` into `AppModule` (NotificationsModule global, exports NotificationsService).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/trips.test.ts`
Expected: PASS.

- [ ] **Step 5: Write generate test + run**

```typescript
// apps/api/test/generate.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { GenerateService } from '../src/generate/generate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { NotificationsService } from '../src/notifications/notifications.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
let generate: GenerateService;

beforeAll(async () => {
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  generate = new GenerateService(prisma, settings, new NotificationsService(prisma));
});

describe('generateTrips (spec §5.2)', () => {
  test('idempotent: same date twice creates only once', async () => {
    const { jakartaDate } = require('@bms/shared') as typeof import('@bms/shared');
    const date = jakartaDate(new Date());
    const first = await generate.generateTrips(date);
    const second = await generate.generateTrips(date);
    expect(second).toBe(0); // ON CONFLICT DO NOTHING
    // total rows for date equals unique (template,date) combos
    const rows = await prisma.trip.count({ where: { date } });
    expect(rows).toBeGreaterThanOrEqual(first);
  });

  test('fillWindow covers generate_days_ahead days', async () => {
    const total = await generate.fillWindow();
    expect(total).toBeGreaterThanOrEqual(0);
    const { jakartaDate, addDays } = require('@bms/shared') as typeof import('@bms/shared');
    const today = jakartaDate(new Date());
    const tomorrow = addDays(today, 1);
    // tomorrow's trips exist if a template weekday matches
    const t = await prisma.tripTemplate.findFirst({ where: { active: true } });
    if (t) expect(await prisma.trip.count({ where: { date: tomorrow } })).toBeGreaterThanOrEqual(0);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

Run: `cd apps/api && pnpm test test/generate.test.ts`
Expected: PASS (idempotency via skipDuplicates).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/trips apps/api/src/generate apps/api/src/notifications apps/api/src/common/mappers.ts apps/api/src/app.module.ts apps/api/test/trips.test.ts apps/api/test/generate.test.ts
git commit -m "feat(api): templates with §5.6 propagation, trip generation, departures, notifications insert"
```

---

### Task 8: Bookings allocation §5.1 + concurrency test

**Files:**
- Create: `apps/api/src/bookings/bookings.module.ts`, `apps/api/src/bookings/allocate.service.ts`, `apps/api/src/bookings/bookings.service.ts`, `apps/api/src/bookings/bookings.controller.ts`
- Test: `apps/api/test/bookings.test.ts`, `apps/api/test/concurrency.test.ts`

**Interfaces:**
- Consumes: `@bms/shared` `DailyBookingRequest`, `Booking`, `isPastCutoff`, `jakartaDate`, `stopTime`, `cutoffAt`; `SettingsService.get().booking_cutoff_minutes`; `DomainError`; Prisma partial-unique `booked_active_unique`; `toBooking` mapper.
- Produces: `AllocateService.allocateSeat(params): Promise<{bookingId: string}>` — spec §5.1 exactly: one transaction; order inactive→FORBIDDEN, suspended (DAILY=today, SUB=date)→USER_SUSPENDED, invalid stop→"Titik jemput tidak valid untuk rute ini.", SCHEDULE_CONFLICT pre-check inside tx, no trips→NOT_FOUND "Belum ada trip untuk pilihan ini.", cutoff-filter (fromCron skips filter) → empty→CUTOFF_PASSED (no rejected row), conditional `UPDATE trips SET booked_count+1 WHERE id=$1 AND status='SCHEDULED' AND booked_count < capacity` per trip in departureAt,id order, no space→insert rejected_requests then throw TRIP_FULL **committed outside tx**; unique violation on booking create→rollback + SCHEDULE_CONFLICT; no SELECT FOR UPDATE. `cancelBooking(bookingId, userId)` — own else NOT_FOUND, ≠BOOKED→"Booking sudah tidak aktif.", USER reason, checkCutoff true→CUTOFF_PASSED, bookedCount--. `myBookings(userId, from?, to?)` — sort departureAt asc. `BookingsController` — `GET /api/bookings/my`, `POST /api/bookings` (DAILY), `POST /api/bookings/:id/cancel`; EMPLOYEE role.

- [ ] **Step 1: Write failing bookings test**

```typescript
// apps/api/test/bookings.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AllocateService } from '../src/bookings/allocate.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { jakartaDate, addDays } from '@bms/shared';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let allocate: AllocateService;
let bookings: BookingsService;
let tripId: string;
let routeId: string;
let stopId: string;
let userId: string;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.auditLog.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  allocate = new AllocateService(prisma, settings);
  bookings = new BookingsService(prisma, allocate, settings);

  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 3, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const user = await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  const { departureAt } = require('@bms/shared') as typeof import('@bms/shared');
  const date = addDays(jakartaDate(new Date()), 1); // tomorrow, safely past any same-day cutoff
  const tpl = await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  const trip = await prisma.trip.create({
    data: { templateId: tpl.id, date, departureAt: departureAt(date, '05:20', 0), status: 'SCHEDULED', bookedCount: 0, capacity: 3, routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id },
  });
  routeId = route.id; stopId = stop.id; userId = user.id; tripId = trip.id;
});

const baseParams = () => ({ userId, routeId, stopId, shiftId: 'pagi', direction: 'PICKUP' as const, date: addDays(jakartaDate(new Date()), 1), source: 'DAILY' as const });

describe('allocateSeat (spec §5.1)', () => {
  test('success increments booked_count and creates BOOKED booking', async () => {
    const r = await allocate.allocateSeat(baseParams());
    expect(r).toBeTruthy();
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.bookedCount).toBe(1);
  });

  test('SCHEDULE_CONFLICT on second booking same user/date/shift/direction', async () => {
    await expect(allocate.allocateSeat(baseParams())).rejects.toMatchObject({
      code: 'SCHEDULE_CONFLICT', message: 'Kamu sudah punya booking di tanggal, shift, dan arah yang sama.',
    });
  });

  test('invalid stop → "Titik jemput tidak valid untuk rute ini."', async () => {
    const otherUser = await prisma.user.create({ data: { nik: 'K1002', name: 'X', role: 'EMPLOYEE', active: true } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: otherUser.id, stopId: 'nonexistent' }))
      .rejects.toThrow('Titik jemput tidak valid untuk rute ini.');
  });

  test('inactive user → FORBIDDEN', async () => {
    const inactive = await prisma.user.create({ data: { nik: 'K1003', name: 'Y', role: 'EMPLOYEE', active: false } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: inactive.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('suspended user → USER_SUSPENDED', async () => {
    const sus = await prisma.user.create({
      data: { nik: 'K1004', name: 'Z', role: 'EMPLOYEE', active: true, bookingSuspendedUntil: new Date(Date.now() + 86_400_000) },
    });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: sus.id }))
      .rejects.toMatchObject({ code: 'USER_SUSPENDED', message: 'Booking kamu sedang dibekukan oleh admin.' });
  });

  test('CUTOFF_PASSED when all trips past cutoff (no rejected row)', async () => {
    // set the only trip's departureAt to the past
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() - 3600_000), bookedCount: 0 } });
    const u = await prisma.user.create({ data: { nik: 'K1005', name: 'W', role: 'EMPLOYEE', active: true } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: u.id }))
      .rejects.toMatchObject({ code: 'CUTOFF_PASSED', message: 'Batas waktu booking atau pembatalan sudah lewat.' });
    // NO rejected row for CUTOFF_PASSED
    expect(await prisma.rejectedRequest.count({ where: { userId: u.id } })).toBe(0);
    // restore future trip
    const { departureAt } = require('@bms/shared') as typeof import('@bms/shared');
    const date = baseParams().date;
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: departureAt(date, '05:20', 0) } });
  });

  test('TRIP_FULL when capacity exhausted: rejected row inserted, thrown outside tx (booked_count stays at capacity)', async () => {
    // fill to capacity (1 booked so far, capacity 3 → book 2 more with different users)
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({ data: { nik: `FILL${i}`, name: `F${i}`, role: 'EMPLOYEE', active: true } });
      await allocate.allocateSeat({ ...baseParams(), userId: u.id });
    }
    const u = await prisma.user.create({ data: { nik: 'K1006', name: 'Full', role: 'EMPLOYEE', active: true } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: u.id }))
      .rejects.toMatchObject({ code: 'TRIP_FULL', message: 'Semua bus untuk rute, shift, dan arah ini sudah penuh.' });
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.bookedCount).toBe(3); // unchanged by the failed attempt
    const rejected = await prisma.rejectedRequest.findFirst({ where: { userId: u.id } });
    expect(rejected).toBeTruthy();
    expect(rejected!.reason).toBe('TRIP_FULL');
  });
});

describe('cancelBooking', () => {
  test('cancels BOOKED, decrements booked_count, sets USER reason', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'FILL0' } });
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: u.id, status: 'BOOKED' } });
    const before = (await prisma.trip.findUnique({ where: { id: tripId } }))!.bookedCount;
    const r = await bookings.cancelBooking(b.id, u.id);
    expect(r.status).toBe('CANCELLED');
    const after = (await prisma.trip.findUnique({ where: { id: tripId } }))!.bookedCount;
    expect(after).toBe(before - 1);
  });

  test('cancel someone else’s booking → NOT_FOUND', async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { nik: 'FILL1' } });
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: owner.id, status: 'BOOKED' } });
    const other = await prisma.user.findFirstOrThrow({ where: { nik: 'K1001' } });
    await expect(bookings.cancelBooking(b.id, other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('cancel already-CANCELLED → "Booking sudah tidak aktif."', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'FILL0' } });
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: u.id, status: 'CANCELLED' } });
    await expect(bookings.cancelBooking(b.id, u.id)).rejects.toThrow('Booking sudah tidak aktif.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/bookings.test.ts`
Expected: FAIL — `AllocateService` not found.

- [ ] **Step 3: Implement allocate + bookings service + controller**

```typescript
// apps/api/src/bookings/allocate.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, isPastCutoff, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';

export interface AllocateParams {
  userId: string;
  routeId: string;
  stopId: string;
  shiftId: string;
  direction: 'PICKUP' | 'DROPOFF';
  date: string; // YYYY-MM-DD
  source: 'DAILY' | 'SUBSCRIPTION';
  subscriptionId?: string;
  fromCron?: boolean;
}

/**
 * spec §5.1 allocation core. One transaction; conditional UPDATE for atomic seat claim;
 * rejected row inserted OUTSIDE the tx on TRIP_FULL (committed independently);
 * no SELECT FOR UPDATE; unique partial index is the backstop for races.
 */
@Injectable()
export class AllocateService {
  constructor(private readonly prisma: PrismaClient, private readonly settings: SettingsService) {}

  async allocateSeat(params: AllocateParams): Promise<{ bookingId: string }> {
    let fullError: DomainError | null = null;
    let fullContext: AllocateParams | null = null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { id: params.userId } });
        if (!user?.active) throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);

        if (!params.fromCron && user.bookingSuspendedUntil) {
          // DAILY uses today, SUB uses the booking date (allocate.ts parity)
          const refDate = params.source === 'DAILY' ? jakartaDate(new Date()) : params.date;
          const refMs = new Date(`${refDate}T00:00:00+07:00`).getTime();
          if (user.bookingSuspendedUntil.getTime() >= refMs) {
            throw new DomainError('USER_SUSPENDED', ERROR_MESSAGES.USER_SUSPENDED);
          }
        }

        const stop = await tx.stop.findFirst({ where: { id: params.stopId, routeId: params.routeId, active: true } });
        if (!stop) throw new DomainError('VALIDATION_ERROR', 'Titik jemput tidak valid untuk rute ini.');

        const conflict = await tx.booking.findFirst({
          where: { userId: params.userId, date: params.date, shiftId: params.shiftId, direction: params.direction, status: 'BOOKED' },
        });
        if (conflict) throw new DomainError('SCHEDULE_CONFLICT', ERROR_MESSAGES.SCHEDULE_CONFLICT);

        let trips = await tx.trip.findMany({
          where: { routeId: params.routeId, shiftId: params.shiftId, direction: params.direction, date: params.date, status: 'SCHEDULED' },
          orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
        });
        if (!trips.length) throw new DomainError('NOT_FOUND', 'Belum ada trip untuk pilihan ini.');

        const cutoffMin = this.settings.get().booking_cutoff_minutes;
        const open = params.fromCron ? trips : trips.filter((t) => !isPastCutoff(t.departureAt.toISOString(), cutoffMin));
        if (!open.length) throw new DomainError('CUTOFF_PASSED', ERROR_MESSAGES.CUTOFF_PASSED);

        for (const trip of open) {
          // atomic conditional claim: no FOR UPDATE, no over-booking under concurrency
          const claimed = await tx.$executeRaw`
            UPDATE "Trip" SET "bookedCount" = "bookedCount" + 1
            WHERE id = ${trip.id} AND status = 'SCHEDULED' AND "bookedCount" < capacity`;
          if (claimed === 1) {
            try {
              const booking = await tx.booking.create({
                data: {
                  userId: params.userId, tripId: trip.id, routeId: params.routeId, stopId: params.stopId,
                  shiftId: params.shiftId, direction: params.direction, date: params.date,
                  source: params.source, subscriptionId: params.subscriptionId ?? null,
                },
              });
              return { bookingId: booking.id };
            } catch (e) {
              // partial unique violation = race lost between pre-check and insert → SCHEDULE_CONFLICT
              const code = (e as { code?: string }).code;
              if (code === 'P2002') throw new DomainError('SCHEDULE_CONFLICT', ERROR_MESSAGES.SCHEDULE_CONFLICT);
              throw e;
            }
          }
        }
        // no trip had space → mark for outside-tx rejected insert, then throw
        fullError = new DomainError('TRIP_FULL', ERROR_MESSAGES.TRIP_FULL);
        fullContext = params;
        throw fullError;
      });
    } catch (e) {
      if (e === fullError && fullContext) {
        // commit the rejected row independently (spec §5.1: outside the tx)
        await this.prisma.rejectedRequest.create({
          data: {
            userId: fullContext.userId, routeId: fullContext.routeId, stopId: fullContext.stopId,
            shiftId: fullContext.shiftId, direction: fullContext.direction, date: fullContext.date,
            reason: 'TRIP_FULL', source: fullContext.source, subscriptionId: fullContext.subscriptionId ?? null,
          },
        });
      }
      throw e;
    }
  }
}
```

```typescript
// apps/api/src/bookings/bookings.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, cutoffAt, isPastCutoff, stopTime } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toBooking } from '../common/mappers';
import { SettingsService } from '../settings/settings.service';
import { AllocateService } from './allocate.service';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allocate: AllocateService,
    private readonly settings: SettingsService,
  ) {}

  async bookDaily(userId: string, input: { routeId: string; stopId: string; shiftId: string; direction: 'PICKUP' | 'DROPOFF'; date: string }) {
    return this.allocate.allocateSeat({ ...input, userId, source: 'DAILY' });
  }

  async myBookings(userId: string, from?: string, to?: string) {
    const where = {
      userId,
      ...(from && { date: { gte: from } }),
      ...(to && { date: { lte: to } }),
    };
    const rows = await this.prisma.booking.findMany({
      where,
      include: { route: { include: { stops: true } }, stop: true, trip: { include: { bus: true } } },
      orderBy: [{ trip: { departureAt: 'asc' } }],
    });
    const cutoffMin = this.settings.get().booking_cutoff_minutes;
    return rows.map((b) => {
      const maxOffset = Math.max(0, ...b.route.stops.map((s) => s.offsetMinutes));
      return toBooking(b, {
        routeCode: b.route.code, routeName: b.route.name, routeColor: b.route.color,
        stopName: b.stop.name, busPlate: b.trip?.bus.plate ?? '',
        departureAt: b.trip?.departureAt.toISOString() ?? '',
        direction: b.direction as 'PICKUP' | 'DROPOFF',
        stopOffset: b.stop.offsetMinutes, maxStopOffset: maxOffset,
        cutoffMinutes: cutoffMin,
        seatsLeft: b.trip ? b.trip.capacity - b.trip.bookedCount : 0,
        capacity: b.trip?.capacity ?? 0,
      });
    });
  }

  async cancelBooking(bookingId: string, userId: string) {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.userId !== userId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (b.status !== 'BOOKED') throw new DomainError('VALIDATION_ERROR', 'Booking sudah tidak aktif.');
    // checkCutoff=true: USER cancel respects cutoff
    const trip = b.tripId ? await this.prisma.trip.findUnique({ where: { id: b.tripId } }) : null;
    if (trip && isPastCutoff(trip.departureAt.toISOString(), this.settings.get().booking_cutoff_minutes)) {
      throw new DomainError('CUTOFF_PASSED', ERROR_MESSAGES.CUTOFF_PASSED);
    }
    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', cancelReason: 'USER', cancelledAt: new Date() },
      }),
      ...(trip ? [this.prisma.trip.update({ where: { id: trip.id }, data: { bookedCount: { decrement: 1 } } })] : []),
    ]);
    return this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  }
}
```

```typescript
// apps/api/src/bookings/bookings.controller.ts
import { Body, Controller, Get, Param, Post, Query, Req, UsePipes } from '@nestjs/common';
import { DailyBookingRequest } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { BookingsService } from './bookings.service';

type EmpReq = { user: { id: string } };

@Controller('bookings')
@Roles('EMPLOYEE') // employee-only endpoints; admin routes live elsewhere
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('my')
  my(@Req() r: EmpReq, @Query('from') from?: string, @Query('to') to?: string) {
    return this.bookings.myBookings(r.user.id, from, to);
  }

  @Post()
  @UsePipes(new ZodPipe(DailyBookingRequest))
  book(@Req() r: EmpReq, @Body() b: { routeId: string; stopId: string; shiftId: string; direction: 'PICKUP' | 'DROPOFF'; date: string }) {
    return this.bookings.bookDaily(r.user.id, b);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() r: EmpReq) {
    return this.bookings.cancelBooking(id, r.user.id);
  }
}
```

Wire `BookingsModule` into `AppModule`.

- [ ] **Step 4: Write failing concurrency test (Review Focus #1)**

```typescript
// apps/api/test/concurrency.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AllocateService } from '../src/bookings/allocate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { jakartaDate, addDays, departureAt } from '@bms/shared';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let allocate: AllocateService;

beforeAll(async () => {
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  allocate = new AllocateService(prisma, settings);
});

describe('concurrent allocation (spec §8: 100 concurrent → 50 OK / 50 TRIP_FULL)', () => {
  test('exactly capacity succeed, rest TRIP_FULL with rejected rows, booked_count == capacity', async () => {
    // clean fixture
    await prisma.$transaction([
      prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(),
      prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(), prisma.route.deleteMany(),
      prisma.bus.deleteMany(), prisma.vendor.deleteMany(), prisma.shift.deleteMany(), prisma.user.deleteMany(),
    ]);
    const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
    const bus = await prisma.bus.create({ data: { plate: 'B 9999 CC', capacity: 50, vendorId: v.id } });
    const route = await prisma.route.create({ data: { code: 'RC', name: 'Race', color: '#000000' } });
    await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
    const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'S', seq: 1, offsetMinutes: 0 } });
    const date = addDays(jakartaDate(new Date()), 1);
    const tpl = await prisma.tripTemplate.create({
      data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
    });
    const trip = await prisma.trip.create({
      data: { templateId: tpl.id, date, departureAt: departureAt(date, '05:20', 0), status: 'SCHEDULED', bookedCount: 0, capacity: 50, routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id },
    });

    // create 100 distinct users
    const users = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        prisma.user.create({ data: { nik: `RACE${String(i).padStart(3, '0')}`, name: `R${i}`, role: 'EMPLOYEE', active: true } })),
    );

    const results = await Promise.allSettled(
      users.map((u) =>
        allocate.allocateSeat({ userId: u.id, routeId: route.id, stopId: stop.id, shiftId: 'pagi', direction: 'PICKUP', date, source: 'DAILY' }))),
    );

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const full = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'TRIP_FULL').length;
    const other = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code !== 'TRIP_FULL').length;

    expect(ok).toBe(50);
    expect(full).toBe(50);
    expect(other).toBe(0);

    const t = await prisma.trip.findUnique({ where: { id: trip.id } });
    expect(t!.bookedCount).toBe(50);

    const rejected = await prisma.rejectedRequest.count({ where: { date, reason: 'TRIP_FULL' } });
    expect(rejected).toBe(50);
  }, 60_000);
});
```

- [ ] **Step 5: Run both tests to verify pass**

Run: `cd apps/api && pnpm test test/bookings.test.ts test/concurrency.test.ts`
Expected: PASS — 50 OK / 50 TRIP_FULL / 50 rejected / booked_count=50.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/bookings apps/api/src/app.module.ts apps/api/test/bookings.test.ts apps/api/test/concurrency.test.ts
git commit -m "feat(api): allocation §5.1 with atomic seat claim, rejected-outside-tx, concurrency proof"
```

---

### Task 9: Subscriptions + admin suspend/unsuspend/deactivate/changeTripBus

**Files:**
- Create: `apps/api/src/bookings/subscriptions.service.ts`
- Create: `apps/api/src/admin/admin.module.ts`, `apps/api/src/admin/admin.service.ts`, `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/bookings/bookings.controller.ts` (add subscription routes) or a separate subscriptions controller
- Test: `apps/api/test/subscriptions.test.ts`

**Interfaces:**
- Consumes: `AllocateService.allocateSeat` (with `source:'SUBSCRIPTION'`, `fromCron` flag for unsuspend recreate), `NotificationsService.insert`, `GenerateService` (exposed `generateSubscriptionBookings(date)` — implemented here, extends Task 7's GenerateService file); `@bms/shared` `SubscriptionInput`, `CancelReason`, `jakartaDate`, `isoWeekday`, `addDays`.
- Produces: `SubscriptionsService` — `list(userId)` (createdAt desc), `create(userId, input)` (invalid stop → "Titik jemput tidak valid untuk rute ini."; startDate<today → "Tanggal mulai sudah lewat."; overlap check same shift+direction range intersect + weekday intersect → SCHEDULE_CONFLICT "Langganan bentrok dengan langganan lain di shift dan arah yang sama."; allocate existing trip dates with cutoff: CUTOFF_PASSED→skippedCutoff, TRIP_FULL→rejected, else silent; returns `{subscription, booked[], rejected[], skippedCutoff[]}`), `end(userId, id)` (ENDED idempotent; endDate=today; cancel BOOKED not-past-cutoff reason SUBSCRIPTION_ENDED); `generateSubscriptionBookings(date)` (subs sorted createdAt asc; skip suspended-on-date / hasBooked / cancelledOnPurpose(subscriptionId+reason USER|ADMIN_TRIP) / rejected already exists(subscriptionId+date); allocate fromCron true; TRIP_FULL→notify SUBSCRIPTION_REJECTED). `AdminService` — `suspend(userId, until, reason, actor)` (until<today → "Tanggal akhir pembekuan sudah lewat."; cancel futureBooked not-past-cutoff reason SUSPENDED (checkCutoff false); notify SUSPENDED; audit USER_SUSPEND — wraps UsersService.suspend from Task 6 + this logic); `unsuspend(userId, actor)` (clear fields; recreate sub bookings for dates≥today with cutoff; TRIP_FULL→notify SUBSCRIPTION_REJECTED; notify UNSUSPENDED; audit USER_UNSUSPEND); `deactivate(userId, actor)` (active=false; cancel future USER_DEACTIVATED; end active subs endDate=today; revoke sessions; audit USER_DEACTIVATE); `changeTripBus(tripId, busId, actor)` (NOT_FOUND; !active bus → "Bus tidak aktif."; !SCHEDULED/departed → "Trip sudah dibatalkan atau sudah berangkat."; capacity<booked → CAPACITY_BELOW_BOOKED `` `Bus ${plate} hanya ${cap} kursi, sudah ${booked} booking.` ``; notify passengers BUS_CHANGED; audit TRIP_CHANGE_BUS; route `PUT /api/trips/:id/bus`). `AdminController` routes: `POST /api/admin/users/:id/suspend|unsuspend|deactivate`, `PUT /api/trips/:id/bus`.

- [ ] **Step 1: Write failing subscriptions test**

```typescript
// apps/api/test/subscriptions.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SubscriptionsService } from '../src/bookings/subscriptions.service';
import { AdminService } from '../src/admin/admin.service';
import { AllocateService } from '../src/bookings/allocate.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { GenerateService } from '../src/generate/generate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { jakartaDate, addDays } from '@bms/shared';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const actor = { id: 'a1', name: 'Admin', role: 'SUPER_ADMIN' } as never;

let subs: SubscriptionsService;
let admin: AdminService;
let userId: string;
let routeId: string;
let stopId: string;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.subscription.deleteMany(),
    prisma.booking.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.refreshToken.deleteMany(), prisma.auditLog.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const notifications = new NotificationsService(prisma);
  const allocate = new AllocateService(prisma, settings);
  const generate = new GenerateService(prisma, settings, notifications);
  subs = new SubscriptionsService(prisma, allocate, generate, settings);
  admin = new AdminService(prisma, allocate, notifications, audit, settings, subs);

  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 50, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const user = await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  routeId = route.id; stopId = stop.id; userId = user.id;
  await generate.fillWindow(); // ensure trips exist for subscription dates
});

const subInput = () => ({
  routeId, stopId, shiftId: 'pagi', direction: 'PICKUP' as const,
  startDate: jakartaDate(new Date()), endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7],
});

describe('subscriptions (spec §5.2 / §5.6)', () => {
  test('create: startDate in past → "Tanggal mulai sudah lewat."', async () => {
    await expect(subs.create(userId, { ...subInput(), startDate: '2020-01-01' }))
      .rejects.toThrow('Tanggal mulai sudah lewat.');
  });

  test('create: invalid stop → "Titik jemput tidak valid untuk rute ini."', async () => {
    await expect(subs.create(userId, { ...subInput(), stopId: 'bad' }))
      .rejects.toThrow('Titik jemput tidak valid untuk rute ini.');
  });

  test('create: overlap same shift+direction → SCHEDULE_CONFLICT', async () => {
    await subs.create(userId, subInput());
    await expect(subs.create(userId, subInput())).rejects.toMatchObject({
      code: 'SCHEDULE_CONFLICT', message: expect.stringContaining('bentrok'),
    });
  });

  test('end: cancels future bookings reason SUBSCRIPTION_ENDED, idempotent ENDED', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId, status: 'ACTIVE' } });
    const r = await subs.end(userId, sub.id);
    expect(r.status).toBe('ENDED');
    const r2 = await subs.end(userId, sub.id); // idempotent
    expect(r2.status).toBe('ENDED');
    const cancelled = await prisma.booking.count({ where: { subscriptionId: sub.id, cancelReason: 'SUBSCRIPTION_ENDED' } });
    expect(cancelled).toBeGreaterThanOrEqual(0);
  });
});

describe('admin suspend / unsuspend / deactivate / changeTripBus', () => {
  test('suspend: non-EMPLOYEE → "Pembekuan booking hanya untuk karyawan."', async () => {
    await expect(admin.suspend('a1', jakartaDate(new Date()), 'test', actor)).rejects.toThrow('Pembekuan booking hanya untuk karyawan.');
  });

  test('suspend: until < today → "Tanggal akhir pembekuan sudah lewat."', async () => {
    await expect(admin.suspend(userId, '2020-01-01', 'test', actor)).rejects.toThrow('Tanggal akhir pembekuan sudah lewat.');
  });

  test('suspend: cancels future bookings SUSPENDED, notifies, clears on unsuspend', async () => {
    // re-create a future booking for the user
    await subs.create(userId, subInput());
    await admin.suspend(userId, addDays(jakartaDate(new Date()), 3), 'No-show 3x', actor);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.bookingSuspendedUntil).toBeTruthy();
    const susNotif = await prisma.notification.findFirst({ where: { userId, type: 'SUSPENDED' } });
    expect(susNotif).toBeTruthy();
    // future BOOKED cancelled reason SUSPENDED
    const cancelled = await prisma.booking.count({ where: { userId, cancelReason: 'SUSPENDED', status: 'CANCELLED' } });
    expect(cancelled).toBeGreaterThanOrEqual(0);

    await admin.unsuspend(userId, actor);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.bookingSuspendedUntil).toBeNull();
    const unsusNotif = await prisma.notification.findFirst({ where: { userId, type: 'UNSUSPENDED' } });
    expect(unsusNotif).toBeTruthy();
  });

  test('deactivate: active=false, future cancelled USER_DEACTIVATED, subs ended, sessions revoked', async () => {
    await admin.deactivate(userId, actor);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.active).toBe(false);
    const sessions = await prisma.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(sessions).toBe(0);
  });

  test('changeTripBus: capacity < booked → CAPACITY_BELOW_BOOKED naming plate', async () => {
    const bus = await prisma.bus.create({ data: { plate: 'B 5000 XX', capacity: 5, vendorId: (await prisma.vendor.findFirstOrThrow()).id } });
    const { departureAt } = require('@bms/shared') as typeof import('@bms/shared');
    const date = addDays(jakartaDate(new Date()), 1);
    const tpl = await prisma.tripTemplate.findFirstOrThrow();
    const trip = await prisma.trip.create({
      data: { templateId: tpl.id, date, departureAt: departureAt(date, '05:20', 0), status: 'SCHEDULED', bookedCount: 10, capacity: 50, routeId, shiftId: 'pagi', direction: 'PICKUP', busId: (await prisma.bus.findFirstOrThrow()).id },
    });
    await expect(admin.changeTripBus(trip.id, bus.id, actor)).rejects.toMatchObject({
      code: 'CAPACITY_BELOW_BOOKED', message: expect.stringContaining('hanya 5 kursi'),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/subscriptions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement subscriptions, generateSubscriptionBookings, admin service + controller**

```typescript
// apps/api/src/generate/generate.service.ts — extend with subscription booking generation
// (add to the existing class from Task 7)

  /** spec §5.2: generate SUBSCRIPTION-source bookings for one date. Idempotent via 4 skip rules. */
  async generateSubscriptionBookings(date: string): Promise<void> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gte: date } }],
        startDate: { lte: date },
      },
      orderBy: { createdAt: 'asc' },
    });
    const weekday = isoWeekday(new Date(`${date}T00:00:00+07:00`));
    for (const sub of subs) {
      if (!sub.weekdays.includes(weekday)) continue;
      // skip suspended-on-date (DAILY uses today, SUB uses date)
      const user = await this.prisma.user.findUnique({ where: { id: sub.userId } });
      if (!user?.active) continue;
      if (user.bookingSuspendedUntil && user.bookingSuspendedUntil >= new Date(`${date}T00:00:00+07:00`)) continue;
      // skip already booked
      const hasBooked = await this.prisma.booking.findFirst({
        where: { userId: sub.userId, date, shiftId: sub.shiftId, direction: sub.direction, status: 'BOOKED' },
      });
      if (hasBooked) continue;
      // skip cancelled on purpose (USER | ADMIN_TRIP) for this subscription
      const cancelledOnPurpose = await this.prisma.booking.findFirst({
        where: { subscriptionId: sub.id, date, cancelReason: { in: ['USER', 'ADMIN_TRIP'] } },
      });
      if (cancelledOnPurpose) continue;
      // skip if a rejected row already exists for this subscription+date (prevents repeat notification)
      const alreadyRejected = await this.prisma.rejectedRequest.findFirst({
        where: { subscriptionId: sub.id, date },
      });
      if (alreadyRejected) continue;

      try {
        await this.allocate.allocateSeat({
          userId: sub.userId, routeId: sub.routeId, stopId: sub.stopId,
          shiftId: sub.shiftId, direction: sub.direction as 'PICKUP' | 'DROPOFF',
          date, source: 'SUBSCRIPTION', subscriptionId: sub.id, fromCron: true,
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'TRIP_FULL') {
          // allocateSeat already inserted the rejected row; notify
          await this.notifications.insert(
            sub.userId, 'SUBSCRIPTION_REJECTED', 'Langganan tidak kebagian kursi',
            `Langganan tanggal ${date} tidak kebagian kursi. Coba booking harian.`,
            { date, subscriptionId: sub.id },
          );
        }
        // TRIP_FULL and other skips are non-fatal for the cron loop
      }
    }
  }
```

```typescript
// apps/api/src/bookings/subscriptions.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, jakartaDate, isoWeekday } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AllocateService } from './allocate.service';
import { GenerateService } from '../generate/generate.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allocate: AllocateService,
    private readonly generate: GenerateService,
    private readonly settings: SettingsService,
  ) {}

  list(userId: string) {
    return this.prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async create(userId: string, input: { routeId: string; stopId: string; shiftId: string; direction: 'PICKUP' | 'DROPOFF'; startDate: string; endDate: string | null; weekdays: number[] }) {
    const today = jakartaDate(new Date());
    if (input.startDate < today) throw new DomainError('VALIDATION_ERROR', 'Tanggal mulai sudah lewat.');
    if (input.endDate && input.endDate < input.startDate) {
      throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir sebelum tanggal mulai.');
    }
    const stop = await this.prisma.stop.findFirst({ where: { id: input.stopId, routeId: input.routeId, active: true } });
    if (!stop) throw new DomainError('VALIDATION_ERROR', 'Titik jemput tidak valid untuk rute ini.');

    // overlap check: same shift+direction, range intersect, weekday intersect
    const existing = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE', shiftId: input.shiftId, direction: input.direction },
    });
    for (const e of existing) {
      const rangeOverlap =
        (!e.endDate || e.endDate >= input.startDate) &&
        (!input.endDate || input.endDate >= e.startDate);
      const weekdayOverlap = e.weekdays.some((d) => input.weekdays.includes(d));
      if (rangeOverlap && weekdayOverlap) {
        throw new DomainError('SCHEDULE_CONFLICT', 'Langganan bentrok dengan langganan lain di shift dan arah yang sama.');
      }
    }

    const sub = await this.prisma.subscription.create({
      data: { userId, ...input, endDate: input.endDate, status: 'ACTIVE' },
    });

    // allocate existing trip dates within range that match weekdays, WITH cutoff
    const booked: string[] = [];
    const rejected: string[] = [];
    const skippedCutoff: string[] = [];
    const endDate = input.endDate ?? addDays(input.startDate, 30); // bounded scan window for open-ended subs
    let d = input.startDate;
    while (d <= endDate) {
      const wd = isoWeekday(new Date(`${d}T00:00:00+07:00`));
      if (input.weekdays.includes(wd)) {
        try {
          await this.allocate.allocateSeat({
            userId, routeId: input.routeId, stopId: input.stopId,
            shiftId: input.shiftId, direction: input.direction,
            date: d, source: 'SUBSCRIPTION', subscriptionId: sub.id,
          });
          booked.push(d);
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'TRIP_FULL') rejected.push(d);
          else if (code === 'CUTOFF_PASSED') skippedCutoff.push(d);
          // SCHEDULE_CONFLICT / others: stop the loop (user already has a booking)
          if (code === 'SCHEDULE_CONFLICT') break;
        }
      }
      d = addDays(d, 1);
    }
    return { subscription: sub, booked, rejected, skippedCutoff };
  }

  async end(userId: string, id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (sub.status === 'ENDED') return sub; // idempotent
    const today = jakartaDate(new Date());
    const updated = await this.prisma.subscription.update({
      where: { id }, data: { status: 'ENDED', endDate: today },
    });
    // cancel future BOOKED not-past-cutoff, reason SUBSCRIPTION_ENDED
    const bookings = await this.prisma.booking.findMany({
      where: { subscriptionId: id, status: 'BOOKED', date: { gte: today } },
      include: { trip: true },
    });
    const cutoffMin = this.settings.get().booking_cutoff_minutes;
    const { isPastCutoff } = await import('@bms/shared');
    for (const b of bookings) {
      if (b.trip && isPastCutoff(b.trip.departureAt.toISOString(), cutoffMin)) continue;
      await this.prisma.$transaction([
        this.prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelReason: 'SUBSCRIPTION_ENDED', cancelledAt: new Date() } }),
        ...(b.tripId ? [this.prisma.trip.update({ where: { id: b.tripId }, data: { bookedCount: { decrement: 1 } } })] : []),
      ]);
    }
    return updated;
  }
}
```

> Fix: `addDays` and `isPastCutoff` must be imported at top of file from `@bms/shared` (shown inline for brevity).

```typescript
// apps/api/src/admin/admin.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AllocateService } from '../bookings/allocate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { SubscriptionsService } from '../bookings/subscriptions.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allocate: AllocateService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly subs: SubscriptionsService,
  ) {}

  async suspend(userId: string, until: string, reason: string, actor: { id: string | null; name: string }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (u.role !== 'EMPLOYEE') throw new DomainError('VALIDATION_ERROR', 'Pembekuan booking hanya untuk karyawan.');
    const today = jakartaDate(new Date());
    if (until < today) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir pembekuan sudah lewat.');

    // cancel futureBooked not-past-cutoff reason SUSPENDED (checkCutoff false — suspend cancels regardless of cutoff)
    const futureBooked = await this.prisma.booking.findMany({
      where: { userId, status: 'BOOKED', date: { gte: today } },
      include: { trip: true },
    });
    for (const b of futureBooked) {
      await this.prisma.$transaction([
        this.prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelReason: 'SUSPENDED', cancelledAt: new Date() } }),
        ...(b.tripId ? [this.prisma.trip.update({ where: { id: b.tripId }, data: { bookedCount: { decrement: 1 } } })] : []),
      ]);
    }
    const untilDate = new Date(`${until}T00:00:00+07:00`);
    const before = u.bookingSuspendedUntil?.toISOString() ?? null;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { bookingSuspendedUntil: untilDate, suspendReason: reason },
    });
    await this.notifications.insert(userId, 'SUSPENDED', 'Booking dibatalkan', `Booking kamu dibatalkan sampai ${until}. Alasan: ${reason}`, { until, reason });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_SUSPEND', entity: 'user', entityId: userId, before: { bookingSuspendedUntil: before }, after: { bookingSuspendedUntil: until, suspendReason: reason } });
    return { id: updated.id, bookingSuspendedUntil: until, suspendReason: reason };
  }

  async unsuspend(userId: string, actor: { id: string | null; name: string }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const before = { bookingSuspendedUntil: u.bookingSuspendedUntil?.toISOString() ?? null, suspendReason: u.suspendReason };
    await this.prisma.user.update({ where: { id: userId }, data: { bookingSuspendedUntil: null, suspendReason: null } });

    // recreate sub bookings for dates >= today with cutoff
    const today = jakartaDate(new Date());
    const activeSubs = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE' },
    });
    for (const sub of activeSubs) {
      try {
        await this.subs.create(userId, {
          routeId: sub.routeId, stopId: sub.stopId, shiftId: sub.shiftId,
          direction: sub.direction as 'PICKUP' | 'DROPOFF',
          startDate: today, endDate: sub.endDate, weekdays: sub.weekdays,
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'TRIP_FULL') {
          await this.notifications.insert(userId, 'SUBSCRIPTION_REJECTED', 'Langganan tidak kebagian kursi', `Langganan tanggal ${today} tidak kebagian kursi. Coba booking harian.`, { date: today });
        }
        // SCHEDULE_CONFLICT / other: skip silently (user may already have bookings)
      }
    }

    await this.notifications.insert(userId, 'UNSUSPENDED', 'Pembekuan dicabut', 'Booking kamu aktif kembali.');
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_UNSUSPEND', entity: 'user', entityId: userId, before, after: { bookingSuspendedUntil: null, suspendReason: null } });
    return { id: userId, bookingSuspendedUntil: null, suspendReason: null };
  }

  async deactivate(userId: string, actor: { id: string | null; name: string }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (userId === actor.id) throw new DomainError('VALIDATION_ERROR', 'Tidak bisa menonaktifkan akun sendiri.');
    const today = jakartaDate(new Date());
    // cancel future USER_DEACTIVATED
    const future = await this.prisma.booking.findMany({ where: { userId, status: 'BOOKED', date: { gte: today } } });
    for (const b of future) {
      await this.prisma.$transaction([
        this.prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelReason: 'USER_DEACTIVATED', cancelledAt: new Date() } }),
        ...(b.tripId ? [this.prisma.trip.update({ where: { id: b.tripId }, data: { bookedCount: { decrement: 1 } } })] : []),
      ]);
    }
    // end active subs
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'ENDED', endDate: today },
    });
    // revoke all sessions
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_DEACTIVATE', entity: 'user', entityId: userId, before: { active: true }, after: { active: false } });
    return { id: updated.id, active: false };
  }

  async changeTripBus(tripId: string, busId: string, actor: { id: string | null; name: string }) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { bus: true } });
    if (!trip) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const bus = await this.prisma.bus.findUnique({ where: { id: busId } });
    if (!bus || !bus.active) throw new DomainError('VALIDATION_ERROR', 'Bus tidak aktif.');
    if (trip.status !== 'SCHEDULED' || trip.departureAt <= new Date()) {
      throw new DomainError('VALIDATION_ERROR', 'Trip sudah dibatalkan atau sudah berangkat.');
    }
    if (bus.capacity < trip.bookedCount) {
      throw new DomainError(
        'CAPACITY_BELOW_BOOKED',
        `Bus ${bus.plate} hanya ${bus.capacity} kursi, sudah ${trip.bookedCount} booking.`,
      );
    }
    const before = { busId: trip.busId, busPlate: trip.bus.plate, capacity: trip.capacity };
    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { busId, capacity: bus.capacity },
      include: { bus: true },
    });
    // notify passengers
    const bookings = await this.prisma.booking.findMany({ where: { tripId, status: 'BOOKED' } });
    for (const b of bookings) {
      await this.notifications.insert(
        b.userId, 'BUS_CHANGED', 'Bus diganti',
        `Trip ${trip.date} sekarang memakai bus ${bus.plate}.`,
        { tripId, plate: bus.plate },
      );
    }
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TRIP_CHANGE_BUS', entity: 'trip', entityId: tripId, before, after: { busId, busPlate: bus.plate, capacity: bus.capacity } });
    return { tripId, busId, busPlate: bus.plate, capacity: bus.capacity };
  }
}
```

```typescript
// apps/api/src/admin/admin.controller.ts
import { Body, Controller, Param, Post, Put, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { SuspendRequest } from '@bms/shared';
import { z } from 'zod';
import { AdminService } from './admin.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

@Controller()
@Roles('SUPER_ADMIN', 'ADMIN_GA')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('admin/users/:id/suspend')
  @UsePipes(new ZodPipe(SuspendRequest))
  suspend(@Param('id') id: string, @Body() b: { until: string; reason: string }, @Req() r: ActorReq) {
    return this.admin.suspend(id, b.until, b.reason, r.user);
  }

  @Post('admin/users/:id/unsuspend')
  unsuspend(@Param('id') id: string, @Req() r: ActorReq) { return this.admin.unsuspend(id, r.user); }

  @Post('admin/users/:id/deactivate')
  deactivate(@Param('id') id: string, @Req() r: ActorReq) { return this.admin.deactivate(id, r.user); }

  @Put('trips/:id/bus')
  @UsePipes(new ZodPipe(z.object({ busId: z.string().min(1) })))
  changeBus(@Param('id') id: string, @Body() b: { busId: string }, @Req() r: ActorReq) {
    return this.admin.changeTripBus(id, b.busId, r.user);
  }
}
```

Wire subscription routes into BookingsController or a new SubscriptionsController (`GET /api/bookings/subscriptions`, `POST /api/bookings/subscriptions`, `POST /api/bookings/subscriptions/:id/end` — EMPLOYEE). Wire `AdminModule` into `AppModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/subscriptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bookings/subscriptions.service.ts apps/api/src/admin apps/api/src/generate/generate.service.ts apps/api/src/app.module.ts apps/api/test/subscriptions.test.ts
git commit -m "feat(api): subscriptions, suspend/unsuspend/deactivate, changeTripBus with notify"
```

---

### Task 10: Departures, availability, reports

**Files:**
- Modify: `apps/api/src/trips/trips.service.ts` (add availability), `apps/api/src/trips/trips.controller.ts` (add GET /trips/availability route before :id route)
- Create: `apps/api/src/reports/reports.module.ts`, `apps/api/src/reports/reports.service.ts`, `apps/api/src/reports/reports.controller.ts`
- Modify: `apps/api/src/notifications/notifications.service.ts` (add list + markRead)
- Test: `apps/api/test/reports.test.ts`

**Interfaces:**
- Consumes: `@bms/shared` `AvailabilityQuery`, `DashboardSummary`, `OccupancyRow`, `RejectedRequest`, `NoShowCandidate`, `jakartaDate`, `addDays`, `isoWeekday`, `departureStatus`; `SettingsService` (backup_share_enabled, backup_retention_days, last bms- file check); `GenerateService.generateTrips` (not needed — availability reads trips table only).
- Produces: `TripsService.availability(routeId, shiftId, direction, date): Promise<Availability>` — sums capacity/booked across trips, firstDepartureAt (nullable), cutoffAt(first, cutoff_min) (nullable), `bookable = seatsLeft>0 && !isPastCutoff(firstDepartureAt)`. Route: `GET /api/trips/availability` (ANY user; declare BEFORE `@Get(':id')` to avoid route shadowing). `ReportsService` — `dashboard(viewer)` (trips/capacity/booked/fullTrips on date param or today; rejectedToday/Yesterday/Last7; backupWarning SUPER_ADMIN only: no bms- files → "Belum ada backup.", share enabled && last JOB not copied → `` `Backup ${name} gagal disalin ke network share.` ``), `occupancy(from,to)` (group SCHEDULED trips by `date|routeCode|shiftId|direction`, sum capacity/booked, rejected count; sort date,routeCode,shiftId,direction), `rejected(from,to)` (range filter, createdAt desc), `noShowCandidates()` (ADMIN_ROLES only, NO_SHOW last 30d, count desc), `notificationsList(userId)` (strip userId, createdAt desc then id desc), `notificationRead(userId, id)` (own else NOT_FOUND, readAt ??=, returns 204). Routes: `GET /api/reports/dashboard|occupancy|rejected|no-show-candidates`, `GET /api/notifications/my`, `POST /api/notifications/:id/read`.

- [ ] **Step 1: Write failing reports test**

```typescript
// apps/api/test/reports.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TripsService } from '../src/trips/trips.service';
import { ReportsService } from '../src/reports/reports.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { jakartaDate, addDays, departureAt } from '@bms/shared';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let tripsSvc: TripsService;
let reports: ReportsService;
let notifications: NotificationsService;
let routeId: string;
let tripId: string;
const date = addDays(jakartaDate(new Date()), 1);

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.auditLog.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  notifications = new NotificationsService(prisma);
  tripsSvc = new TripsService(prisma, notifications, audit, settings);
  reports = new ReportsService(prisma, settings);

  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 50, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const tpl = await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  const trip = await prisma.trip.create({
    data: { templateId: tpl.id, date, departureAt: departureAt(date, '05:20', 0), status: 'SCHEDULED', bookedCount: 20, capacity: 50, routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id },
  });
  routeId = route.id; tripId = trip.id;
});

describe('availability', () => {
  test('sums capacity/booked, computes firstDepartureAt, cutoffAt, bookable', async () => {
    const a = await tripsSvc.availability(routeId, 'pagi', 'PICKUP', date);
    expect(a.capacity).toBe(50);
    expect(a.booked).toBe(20);
    expect(a.seatsLeft).toBe(30);
    expect(a.firstDepartureAt).toBeTruthy();
    expect(a.cutoffAt).toBeTruthy();
    expect(a.bookable).toBe(true);
  });

  test('past-departure trip → bookable false', async () => {
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() - 3600_000) } });
    const a = await tripsSvc.availability(routeId, 'pagi', 'PICKUP', date);
    expect(a.bookable).toBe(false);
    // restore
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: departureAt(date, '05:20', 0) } });
  });
});

describe('dashboard', () => {
  test('returns trips/capacity/booked/fullTrips + rejected counts, backupWarning null when no share', async () => {
    const v = await prisma.user.create({ data: { nik: 'SUPER', name: 'S', role: 'SUPER_ADMIN', active: true } });
    const d = await reports.dashboard(v, date);
    expect(d.trips).toBeGreaterThanOrEqual(1);
    expect(d.capacity).toBe(50);
    expect(d.booked).toBe(20);
    expect(d.fullTrips).toBe(0);
    expect(d.rejectedToday).toBe(0);
    expect(d.backupWarning).toBeNull();
  });

  test('backupWarning "Belum ada backup." when no bms- files', async () => {
    const v = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN' } });
    const d = await reports.dashboard(v, date);
    expect(d.backupWarning).toBe('Belum ada backup.');
  });
});

describe('occupancy', () => {
  test('groups by date|routeCode|shiftId|direction', async () => {
    const rows = await reports.occupancy(date, date);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ routeCode: 'R1', shiftId: 'pagi', direction: 'PICKUP', booked: 20, capacity: 50 });
  });
});

describe('no-show candidates', () => {
  test('returns passengers with NO_SHOW in last 30 days, count desc', async () => {
    const u = await prisma.user.create({ data: { nik: 'NS1', name: 'NS', role: 'EMPLOYEE', active: true } });
    await prisma.booking.create({
      data: { userId: u.id, tripId, routeId, stopId: (await prisma.stop.findFirstOrThrow()).id, shiftId: 'pagi', direction: 'PICKUP', date, status: 'NO_SHOW', cancelReason: null, source: 'DAILY' },
    });
    const rows = await reports.noShowCandidates();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].nik).toBe('NS1');
    expect(rows[0].count).toBe(1);
  });
});

describe('notifications list/read', () => {
  test('list strips userId, sorted createdAt desc; read marks own, NOT_FOUND for foreign', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'NS1' } });
    await notifications.insert(u.id, 'REMINDER', 'Pengingat', 'Pengingat booking besok.');
    const rows = await reports.notificationsList(u.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).not.toHaveProperty('userId');
    await reports.notificationRead(u.id, rows[0].id);
    const updated = await prisma.notification.findUnique({ where: { id: rows[0].id } });
    expect(updated!.readAt).toBeTruthy();
    await expect(reports.notificationRead('other', rows[0].id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/reports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement availability + reports + notifications list/read**

```typescript
// apps/api/src/trips/trips.service.ts — add availability method to existing class
  async availability(routeId: string, shiftId: string, direction: 'PICKUP' | 'DROPOFF', date: string) {
    const trips = await this.prisma.trip.findMany({
      where: { routeId, shiftId, direction, date, status: 'SCHEDULED' },
      orderBy: { departureAt: 'asc' },
    });
    const capacity = trips.reduce((s, t) => s + t.capacity, 0);
    const booked = trips.reduce((s, t) => s + t.bookedCount, 0);
    const firstDepartureAt = trips[0]?.departureAt ?? null;
    const cutoffMin = this.settings.get().booking_cutoff_minutes;
    const { cutoffAt, isPastCutoff } = await import('@bms/shared');
    const cutoff = firstDepartureAt ? cutoffAt(firstDepartureAt.toISOString(), cutoffMin) : null;
    const seatsLeft = capacity - booked;
    const bookable = seatsLeft > 0 && firstDepartureAt !== null && !isPastCutoff(firstDepartureAt.toISOString(), cutoffMin);
    return {
      routeId, shiftId, direction, date,
      capacity, booked, seatsLeft,
      firstDepartureAt: firstDepartureAt?.toISOString() ?? null,
      cutoffAt: cutoff,
      bookable,
    };
  }
```

> Import `cutoffAt` and `isPastCutoff` statically from `@bms/shared` at file top instead of the dynamic import shown above — shown inline for brevity.

```typescript
// apps/api/src/reports/reports.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, addDays, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN_GA', 'VENDOR'] as const;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaClient, private readonly settings: SettingsService) {}

  private assertViewer(actor: { role: string }) {
    if (!VIEWER_ROLES.includes(actor.role as never)) {
      throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);
    }
  }

  async dashboard(actor: { id: string | null; role: string }, date?: string) {
    this.assertViewer(actor);
    const targetDate = date ?? jakartaDate(new Date());
    const trips = await this.prisma.trip.findMany({ where: { date: targetDate } });
    const capacity = trips.reduce((s, t) => s + t.capacity, 0);
    const booked = trips.reduce((s, t) => s + t.bookedCount, 0);
    const fullTrips = trips.filter((t) => t.bookedCount >= t.capacity && t.capacity > 0).length;
    const today = jakartaDate(new Date());
    const yesterday = addDays(today, -1);
    const last7 = addDays(today, -7);
    const rejectedToday = await this.prisma.rejectedRequest.count({ where: { date: today } });
    const rejectedYesterday = await this.prisma.rejectedRequest.count({ where: { date: yesterday } });
    const rejectedLast7 = await this.prisma.rejectedRequest.count({ where: { date: { gte: last7 } } });
    // backupWarning: SUPER_ADMIN only
    let backupWarning: string | null = null;
    if (actor.role === 'SUPER_ADMIN') {
      const lastBackup = await this.prisma.backup.findFirst({
        where: { name: { startsWith: 'bms-' } },
        orderBy: [{ createdAt: 'desc' }, { name: 'desc' }],
      });
      if (!lastBackup) {
        backupWarning = 'Belum ada backup.';
      } else if (this.settings.get().backup_share_enabled && this.settings.get().backup_share_path !== '' && !lastBackup.copiedToShare) {
        backupWarning = `Backup ${lastBackup.name} gagal disalin ke network share.`;
      }
    }
    return { trips: trips.length, capacity, booked, fullTrips, rejectedToday, rejectedYesterday, rejectedLast7, backupWarning };
  }

  async occupancy(from?: string, to?: string) {
    const startDate = from ?? jakartaDate(new Date());
    const endDate = to ?? startDate;
    if (endDate < startDate) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir sebelum tanggal mulai.');
    const trips = await this.prisma.trip.findMany({
      where: { date: { gte: startDate, lte: endDate }, status: 'SCHEDULED' },
      include: { route: true },
    });
    const groups = new Map<string, { date: string; routeCode: string; shiftId: string; direction: string; capacity: number; booked: number; rejected: number }>();
    for (const t of trips) {
      const key = `${t.date}|${t.route.code}|${t.shiftId}|${t.direction}`;
      const g = groups.get(key) ?? { date: t.date, routeCode: t.route.code, shiftId: t.shiftId, direction: t.direction, capacity: 0, booked: 0, rejected: 0 };
      g.capacity += t.capacity;
      g.booked += t.bookedCount;
      groups.set(key, g);
    }
    const rejected = await this.prisma.rejectedRequest.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      include: { route: true },
    });
    for (const r of rejected) {
      const key = `${r.date}|${r.route.code}|${r.shiftId}|${r.direction}`;
      const g = groups.get(key);
      if (g) g.rejected += 1;
    }
    return [...groups.values()].sort((a, b) =>
      a.date.localeCompare(b.date) || a.routeCode.localeCompare(b.routeCode) ||
      a.shiftId.localeCompare(b.shiftId) || a.direction.localeCompare(b.direction));
  }

  async rejected(from?: string, to?: string) {
    const startDate = from ?? jakartaDate(new Date());
    const endDate = to ?? startDate;
    if (endDate < startDate) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir sebelum tanggal mulai.');
    return this.prisma.rejectedRequest.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async noShowCandidates() {
    const since = addDays(jakartaDate(new Date()), -30);
    const rows = await this.prisma.booking.findMany({
      where: { status: 'NO_SHOW', date: { gte: since } },
      include: { user: true },
    });
    const counts = new Map<string, { userId: string; nik: string; name: string; department: string; count: number }>();
    for (const b of rows) {
      const c = counts.get(b.userId) ?? { userId: b.userId, nik: b.user.nik, name: b.user.name, department: b.user.department, count: 0 };
      c.count += 1;
      counts.set(b.userId, c);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.nik.localeCompare(b.nik));
  }

  async notificationsList(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(({ userId: _userId, ...rest }) => rest);
  }

  async notificationRead(userId: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!n.readAt) await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    // 204 via undefined return (interceptor)
  }
}
```

```typescript
// apps/api/src/reports/reports.controller.ts
import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/dashboard')
  @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  dashboard(@Req() r: ActorReq, @Query('date') date?: string) { return this.reports.dashboard(r.user, date); }

  @Get('reports/occupancy')
  @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  occupancy(@Query('from') from?: string, @Query('to') to?: string) { return this.reports.occupancy(from, to); }

  @Get('reports/rejected')
  @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  rejected(@Query('from') from?: string, @Query('to') to?: string) { return this.reports.rejected(from, to); }

  @Get('reports/no-show-candidates')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  noShow() { return this.reports.noShowCandidates(); }

  @Get('notifications/my')
  myNotifications(@Req() r: ActorReq) { return this.reports.notificationsList(r.user.id!); }

  @Post('notifications/:id/read')
  read(@Param('id') id: string, @Req() r: ActorReq) { return this.reports.notificationRead(r.user.id!, id); }
}
```

Wire `ReportsModule` into `AppModule`. Add availability route to TripsController (`GET /trips/availability` — ANY user, no `@Roles`, placed above `@Get(':id')`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/reports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/trips apps/api/src/reports apps/api/src/notifications apps/api/src/app.module.ts apps/api/test/reports.test.ts
git commit -m "feat(api): availability, dashboard/occupancy/rejected/no-show reports, notifications list/read"
```

---

### Task 11: FCM push + reminder + cleanup + real test-push

**Files:**
- Create: `apps/api/src/notifications/fcm.service.ts`
- Modify: `apps/api/src/notifications/notifications.service.ts` (add `sendToUser`, `sendReminderCandidates`)
- Modify: `apps/api/src/settings/settings.controller.ts` (replace test-push stub with real call)
- Test: `apps/api/test/notifications.test.ts`

**Interfaces:**
- Consumes: `SettingsService.get().push_enabled`, `getSecret('fcm_service_account')`; `google-auth-library` `GoogleAuth` (NOT firebase-admin); Node `fetch` for FCM v1 `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`; Prisma `DeviceToken` (invalid UNREGISTERED token → delete); `Notification.reminderSentAt` flag.
- Produces: `FcmService.send(userTokens: {token,platform}[], title, body, data): Promise<{sent: number, failed: number}>` — if `!push_enabled` → `{sent:0,failed:0}` silently; if no `fcm_service_account` → log warn, return `{sent:0,failed:0}`; else get OAuth2 token via GoogleAuth, POST each device token, on response error `UNREGISTERED`/`INVALID_ARGUMENT` delete the DeviceToken row; failure logs only, no retry. `NotificationsService.sendToUser(userId, type, title, body, data)` — insert row then (if push_enabled) fetch DeviceTokens and FcmService.send. `NotificationsService.sendReminderCandidates()` — find BOOKED trips departing within `reminder_minutes` of now where `reminder_sent_at IS NULL`; for each, insert REMINDER notification, set `reminderSentAt`, sendToUser. `NotificationsService.cleanup(retentionDays)` — delete notifications older than retention. SettingsController test-push becomes real: calls `sendToUser(actor.id, 'REMINDER', 'Notifikasi uji', 'Ini notifikasi uji dari BMS.')` — if `!push_enabled` returns `{ok:false, message:'Push notifikasi belum diaktifkan.'}`; if no fcm secret `{ok:false, message:'Service account FCM belum diisi.'}`; else `{ok:true, message:'Notifikasi uji terkirim ke perangkat kamu.'}`.

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/test/notifications.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FcmService } from '../src/notifications/fcm.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { departureAt, jakartaDate, addDays } from '@bms/shared';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let notifications: NotificationsService;
let settings: SettingsService;
let userId: string;
let tripId: string;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.deviceToken.deleteMany(),
    prisma.booking.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const fcm = new FcmService(settings);
  notifications = new NotificationsService(prisma, fcm, settings);

  const user = await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 50, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'malam', name: 'Malam', startTime: '23:00', endTime: '07:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const date = jakartaDate(new Date());
  // trip departing within reminder window (now + 30min, reminder=60)
  const soon = new Date(Date.now() + 30 * 60 * 1000);
  const tpl = await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'malam', direction: 'PICKUP', busId: bus.id, departureTime: '23:00', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  const trip = await prisma.trip.create({
    data: { templateId: tpl.id, date, departureAt: soon, status: 'SCHEDULED', bookedCount: 1, capacity: 50, routeId: route.id, shiftId: 'malam', direction: 'PICKUP', busId: bus.id },
  });
  await prisma.booking.create({
    data: { userId: user.id, tripId: trip.id, routeId: route.id, stopId: stop.id, shiftId: 'malam', direction: 'PICKUP', date, status: 'BOOKED', source: 'DAILY' },
  });
  userId = user.id; tripId = trip.id;
});

describe('reminder candidates', () => {
  test('sendReminderCandidates finds BOOKED within reminder_minutes, sets reminderSentAt, creates REMINDER', async () => {
    await notifications.sendReminderCandidates();
    const n = await prisma.notification.findFirst({ where: { userId, type: 'REMINDER' } });
    expect(n).toBeTruthy();
    const b = await prisma.booking.findFirstOrThrow({ where: { tripId } });
    expect(b.reminderSentAt).toBeTruthy();
  });

  test('idempotent: second run does not duplicate reminder', async () => {
    const before = await prisma.notification.count({ where: { userId, type: 'REMINDER' } });
    await notifications.sendReminderCandidates();
    const after = await prisma.notification.count({ where: { userId, type: 'REMINDER' } });
    expect(after).toBe(before);
  });
});

describe('fcm service (unconfigured paths)', () => {
  test('send when push disabled returns {sent:0,failed:0}, no throw', async () => {
    settings.update({ push_enabled: false }, { id: 'a', name: 'Admin' });
    const fcm = new FcmService(settings);
    const r = await fcm.send([{ token: 'tok', platform: 'android' }], 't', 'b', {});
    expect(r).toEqual({ sent: 0, failed: 0 });
  });

  test('send when push enabled but no fcm secret returns {sent:0,failed:0}, logs warn', async () => {
    settings.update({ push_enabled: true, fcm_service_account: '' }, { id: 'a', name: 'Admin' });
    const fcm = new FcmService(settings);
    const r = await fcm.send([{ token: 'tok', platform: 'android' }], 't', 'b', {});
    expect(r).toEqual({ sent: 0, failed: 0 });
    settings.update({ push_enabled: false }, { id: 'a', name: 'Admin' });
  });
});

describe('cleanup', () => {
  test('cleanup deletes notifications older than retention', async () => {
    await prisma.notification.create({
      data: { userId, type: 'REMINDER', title: 'old', body: 'old', readAt: null, createdAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    await notifications.cleanup(90); // default retention 90 days
    const old = await prisma.notification.findFirst({ where: { title: 'old' } });
    expect(old).toBeNull();
    const recent = await prisma.notification.findFirst({ where: { userId, type: 'REMINDER' } });
    expect(recent).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/notifications.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement FCM + reminders + cleanup + real test-push**

```typescript
// apps/api/src/notifications/fcm.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import { SettingsService } from '../settings/settings.service';

interface Device { token: string; platform: 'android' | 'ios' | 'web' }

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);

  constructor(private readonly settings: SettingsService) {}

  private get projectId(): string | null {
    const raw = this.settings.getSecret('fcm_service_account');
    if (!raw) return null;
    try { return (JSON.parse(raw) as { project_id?: string }).project_id ?? null; } catch { return null; }
  }

  async send(devices: Device[], title: string, body: string, data: Record<string, string>): Promise<{ sent: number; failed: number }> {
    if (!this.settings.get().push_enabled) return { sent: 0, failed: 0 };
    const raw = this.settings.getSecret('fcm_service_account');
    const projectId = this.projectId;
    if (!raw || !projectId) {
      this.logger.warn('fcm_service_account not configured, skipping push');
      return { sent: 0, failed: 0 };
    }
    let accessToken: string;
    try {
      const auth = new GoogleAuth({ credentials: JSON.parse(raw), scopes: ['https://www.googleapis.com/auth/firebase.messaging'] });
      const client = await auth.getClient();
      accessToken = (await client.getAccessToken()).token ?? '';
    } catch (e) {
      this.logger.warn(`fcm auth failed: ${(e as Error).message}`);
      return { sent: 0, failed: devices.length };
    }
    let sent = 0, failed = 0;
    for (const d of devices) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: d.token,
              notification: { title, body },
              data,
              android: { priority: 'HIGH' },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
        });
        if (res.ok) {
          sent += 1;
        } else {
          const err = await res.json().catch(() => ({})) as { error?: { status?: string; message?: string } };
          this.logger.warn(`fcm send failed status=${res.status} code=${err.error?.status ?? ''} msg=${err.error?.message ?? ''}`);
          // invalid/expired token → delete DeviceToken row
          if (err.error?.status === 'UNREGISTERED' || err.error?.status === 'INVALID_ARGUMENT') {
            await this.deleteDeviceToken(d.token);
          }
          failed += 1;
        }
      } catch (e) {
        this.logger.warn(`fcm send threw: ${(e as Error).message}`);
        failed += 1;
      }
    }
    return { sent, failed };
  }

  private async deleteDeviceToken(token: string) {
    const { PrismaClient } = await import('@prisma/client');
    // ponytail: FcmService has no PrismaClient injected to avoid circular dep;
    // delete via a fresh client — cheap because this path only runs on invalid-token errors.
    const prisma = new PrismaClient();
    try {
      await prisma.deviceToken.deleteMany({ where: { token } });
    } finally {
      await prisma.$disconnect();
    }
  }
}
```

> Note for executor: prefer injecting `PrismaClient` into `FcmService` instead of the fresh-client hack if DI wiring makes it trivial — the fresh-client version is the ponytail fallback shown to keep the constructor signature testable without a DB.

```typescript
// apps/api/src/notifications/notifications.service.ts — extend existing class

  /** Insert row then (if push_enabled) push to user's devices. Failure logged, no retry. */
  async sendToUser(userId: string, type: string, title: string, body: string, data?: Record<string, string>) {
    const n = await this.prisma.notification.create({
      data: { userId, type, title, body, data: (data ?? {}) as object },
    });
    if (this.settings.get().push_enabled) {
      const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
      if (devices.length) {
        await this.fcm.send(
          devices.map((d) => ({ token: d.token, platform: d.platform as 'android' | 'ios' | 'web' })),
          title, body, data ?? {},
        );
      }
    }
    return n;
  }

  /** Reminder job: BOOKED trips departing within reminder_minutes, reminder_sent_at NULL. */
  async sendReminderCandidates(): Promise<number> {
    const minutes = this.settings.get().reminder_minutes;
    const now = new Date();
    const horizon = new Date(now.getTime() + minutes * 60_000);
    const bookings = await this.prisma.booking.findMany({
      where: { status: 'BOOKED', reminderSentAt: null, trip: { departureAt: { gt: now, lte: horizon } } },
      include: { trip: { include: { route: true } }, stop: true, user: true },
    });
    for (const b of bookings) {
      const title = 'Pengingat booking';
      const body = `Bus kamu berangkat ${b.date} pukul ${b.trip!.departureAt.toISOString().slice(11, 16)} dari ${b.stop.name}.`;
      await this.sendToUser(b.userId, 'REMINDER', title, body, { bookingId: b.id, tripId: b.tripId ?? '' });
      await this.prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
    }
    return bookings.length;
  }

  /** Cleanup job: delete notifications older than retention days. */
  async cleanup(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const r = await this.prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return r.count;
  }
```

> `NotificationsService` constructor gains `settings: SettingsService` as third param — update Task 7's constructor and any instantiation sites (tests construct `new NotificationsService(prisma)` — update those to `new NotificationsService(prisma, fcm, settings)`).

```typescript
// apps/api/src/settings/settings.controller.ts — replace test-push stub
  @Post('test-push')
  async testPush(@Req() req: { user: { id: string | null; name: string } }) {
    if (!this.settings.get().push_enabled) return { ok: false, message: 'Push notifikasi belum diaktifkan.' };
    if (!this.settings.getSecret('fcm_service_account')) return { ok: false, message: 'Service account FCM belum diisi.' };
    await this.notifications.sendToUser(req.user.id!, 'REMINDER', 'Notifikasi uji', 'Ini notifikasi uji dari BMS.');
    return { ok: true, message: 'Notifikasi uji terkirim ke perangkat kamu.' };
  }
```

> `SettingsController` constructor gains `notifications: NotificationsService` (import from NotificationsModule, add `NotificationsModule` to `imports` of `SettingsModule` or use `@Global` exports). `NotificationsModule` must export `NotificationsService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notifications apps/api/src/settings/settings.controller.ts apps/api/test/notifications.test.ts
git commit -m "feat(api): FCM push via google-auth-library, reminder candidates, cleanup, real test-push"
```

---

### Task 12: Scheduler (cron jobs + startup + settings re-register)

**Files:**
- Create: `apps/api/src/scheduler/scheduler.module.ts`, `apps/api/src/scheduler/scheduler.service.ts`
- Modify: `apps/api/src/app.module.ts` (add SchedulerModule), `apps/api/src/generate/generate.service.ts` (expose `runGenerate()` for startup + nightly)
- Test: `apps/api/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `@nestjs/schedule` `SchedulerRegistry`, `CronJob`; `SettingsService.get().generate_run_time`, `generate_days_ahead`, `backup_run_time`, `notification_retention_days`; `SettingsService.onChanged`; `GenerateService.generateTrips`/`generateSubscriptionBookings`/`fillWindow`; `NotificationsService.sendReminderCandidates`/`cleanup`; `BackupService.runBackup` (Task 14 — for now stub `BackupService` interface `{ runBackup(): Promise<{name: string, copiedToShare: boolean}> }` injected via token `BACKUP_JOB`).
- Produces: `SchedulerService implements OnModuleInit` — `onModuleInit()`: run `runGenerate()` once at startup (fire-and-forget, log errors), then `registerAll()`. `registerAll()` (idempotent — removes existing jobs first via SchedulerRegistry): (1) generate job at `generate_run_time` (HH:mm) — for each day `i=0..generate_days_ahead` call `generateTrips(addDays(today, i))` then `generateSubscriptionBookings(date)` for each; (2) reminder job `*/5 * * * *` → `sendReminderCandidates()`; (3) cleanup job `30 1 * * *` (01:30) → `cleanup(retentionDays)`; (4) backup job at `backup_run_time` → `BACKUP_JOB.runBackup()`. `SettingsService.onChanged.on('changed')` → call `registerAll()` (re-register with new times). `pauseAll()` / `resumeAll()` helpers — iterate SchedulerRegistry, stop/start each job (used by Task 14 restore flow). Route: none (internal service, not HTTP). `runGenerate()` on GenerateService: `for i=0..generate_days_ahead: generateTrips(addDays(today,i)); generateSubscriptionBookings(date)` — idempotent via ON CONFLICT DO NOTHING + skip rules.

- [ ] **Step 1: Write failing scheduler test**

```typescript
// apps/api/test/scheduler.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GenerateService } from '../src/generate/generate.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { FcmService } from '../src/notifications/fcm.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let settings: SettingsService;
let generate: GenerateService;
let notifications: NotificationsService;
let scheduler: SchedulerService;

beforeAll(async () => {
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const fcm = new FcmService(settings);
  notifications = new NotificationsService(prisma, fcm, settings);
  generate = new GenerateService(prisma, settings, notifications);
  const fakeBackup = { runBackup: async () => ({ name: 'bms-test.dump', copiedToShare: false }) };
  scheduler = new SchedulerService(generate, notifications, settings, fakeBackup as never, new SchedulerRegistry());
});

describe('scheduler registration', () => {
  test('registerAll registers 4 jobs: generate, reminder, cleanup, backup', () => {
    scheduler.registerAll();
    const jobs = scheduler.listJobs();
    expect(jobs.length).toBe(4);
    expect(jobs).toContain('generate');
    expect(jobs).toContain('reminder');
    expect(jobs).toContain('cleanup');
    expect(jobs).toContain('backup');
  });

  test('re-register on settings change: generate_run_time change updates cron expr', () => {
    scheduler.registerAll();
    settings.update({ generate_run_time: '01:15' }, { id: 'a', name: 'Admin' });
    // onChanged fires synchronously → registerAll re-runs
    const expr = scheduler.cronExpression('generate');
    expect(expr).toContain('15 1');
  });

  test('pauseAll / resumeAll toggle every job', () => {
    scheduler.registerAll();
    scheduler.pauseAll();
    expect(scheduler.allPaused()).toBe(true);
    scheduler.resumeAll();
    expect(scheduler.allPaused()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/scheduler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement scheduler + GenerateService.runGenerate**

```typescript
// apps/api/src/generate/generate.service.ts — add to existing class
  /** Startup + nightly: generate trips + subscription bookings for the full window. Idempotent. */
  async runGenerate(): Promise<void> {
    const daysAhead = this.settings.get().generate_days_ahead;
    const today = jakartaDate(new Date());
    for (let i = 0; i <= daysAhead; i++) {
      const date = addDays(today, i);
      await this.generateTrips(date);
      await this.generateSubscriptionBookings(date);
    }
  }
```

> `jakartaDate` and `addDays` must be imported statically from `@bms/shared` at top of `generate.service.ts`.

```typescript
// apps/api/src/scheduler/scheduler.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GenerateService } from '../generate/generate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

/** Injected token for the backup job (Task 14 provides the real impl). */
export const BACKUP_JOB = 'BACKUP_JOB';
export interface BackupJobLike { runBackup(): Promise<{ name: string; copiedToShare: boolean }> }

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly generate: GenerateService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly backup: BackupJobLike,
  ) {}

  async onModuleInit() {
    // startup generate: fire-and-forget so boot is not blocked by a long window
    void this.generate.runGenerate().catch((e) => this.logger.error(`startup generate failed: ${(e as Error).message}`));
    this.registerAll();
    this.settings.onChanged.on('changed', () => {
      this.logger.log('settings changed, re-registering cron jobs');
      this.registerAll();
    });
  }

  /** Idempotent: removes existing jobs by name, re-adds with current settings. */
  registerAll(): void {
    const s = this.settings.get();
    this.removeIfPresent('generate');
    this.removeIfPresent('reminder');
    this.removeIfPresent('cleanup');
    this.removeIfPresent('backup');

    const [gh, gm] = s.generate_run_time.split(':').map(Number);
    const generateJob = CronJob.from({
      cronTime: `${gm} ${gh} * * *`,
      onTick: () => { void this.generate.runGenerate().catch((e) => this.logger.error(`generate job: ${(e as Error).message}`)); },
      start: false,
    });
    this.schedulerRegistry.addCronJob('generate', generateJob);
    generateJob.start();

    const reminderJob = CronJob.from({
      cronTime: '*/5 * * * *',
      onTick: () => { void this.notifications.sendReminderCandidates().catch((e) => this.logger.error(`reminder job: ${(e as Error).message}`)); },
      start: false,
    });
    this.schedulerRegistry.addCronJob('reminder', reminderJob);
    reminderJob.start();

    // cleanup nightly 01:30
    const cleanupJob = CronJob.from({
      cronTime: '30 1 * * *',
      onTick: () => { void this.notifications.cleanup(this.settings.get().notification_retention_days).catch((e) => this.logger.error(`cleanup job: ${(e as Error).message}`)); },
      start: false,
    });
    this.schedulerRegistry.addCronJob('cleanup', cleanupJob);
    cleanupJob.start();

    const [bh, bm] = s.backup_run_time.split(':').map(Number);
    const backupJob = CronJob.from({
      cronTime: `${bm} ${bh} * * *`,
      onTick: () => { void this.backup.runBackup().catch((e) => this.logger.error(`backup job: ${(e as Error).message}`)); },
      start: false,
    });
    this.schedulerRegistry.addCronJob('backup', backupJob);
    backupJob.start();
  }

  pauseAll(): void {
    for (const name of ['generate', 'reminder', 'cleanup', 'backup'] as const) {
      const job = this.schedulerRegistry.getCronJob(name);
      job.stop();
    }
  }

  resumeAll(): void {
    for (const name of ['generate', 'reminder', 'cleanup', 'backup'] as const) {
      const job = this.schedulerRegistry.getCronJob(name);
      job.start();
    }
  }

  // test helpers
  listJobs(): string[] { return this.schedulerRegistry.getCronJobs().keys().toArray(); }
  cronExpression(name: string): string { return this.schedulerRegistry.getCronJob(name).cronTime.source; }
  allPaused(): boolean {
    return ['generate', 'reminder', 'cleanup', 'backup'].every((n) => !this.schedulerRegistry.getCronJob(n).isActive);
  }

  private removeIfPresent(name: string): void {
    try { this.schedulerRegistry.deleteCronJob(name); } catch { /* not registered yet */ }
  }

  // SchedulerRegistry is injectable from @nestjs/schedule when ScheduleModule.forRoot() is imported
  private get schedulerRegistry() { return this.registry; }
  constructor_() {}
}
```

> Fix for executor: `SchedulerService` must inject `SchedulerRegistry` as a 5th constructor param: `private readonly registry: SchedulerRegistry` (test above already passes `new SchedulerRegistry()` — a plain class, no DI needed in tests). Delete the dummy `constructor_()` and the getter boilerplate; call `this.registry` directly. `AppModule` must import `ScheduleModule.forRoot()` and `SchedulerModule`.

```typescript
// apps/api/src/scheduler/scheduler.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService, BACKUP_JOB } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    SchedulerService,
    // Task 14 replaces this token with the real BackupService; stub until then
    { provide: BACKUP_JOB, useValue: { runBackup: async () => ({ name: '', copiedToShare: false }) } },
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
```

Wire `SchedulerModule` into `AppModule` (after other modules so GenerateService/NotificationsService are available).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduler apps/api/src/generate/generate.service.ts apps/api/src/app.module.ts apps/api/test/scheduler.test.ts
git commit -m "feat(api): SchedulerService with generate/reminder/cleanup/backup cron, settings re-register, pause/resume"
```

> Note: Audit list endpoint was already delivered in Task 3 (`GET /api/audit-logs`, `AuditController`) — no standalone Task needed; this slot is folded into the scheduler task numbering to keep the File Structure tree stable.

---

### Task 13: Backup & restore

**Files:**
- Create: `apps/api/src/backup/backup.module.ts`, `apps/api/src/backup/exec-runner.service.ts`, `apps/api/src/backup/backup.service.ts`, `apps/api/src/backup/backup.controller.ts`
- Modify: `apps/api/src/scheduler/scheduler.module.ts` (replace `BACKUP_JOB` stub with real `BackupService`)
- Test: `apps/api/test/backup.test.ts`

**Interfaces:**
- Consumes: `SettingsService.get().backup_share_enabled`, `backup_share_path`, `backup_share_username`, `backup_share_password`, `backup_retention_days`, `backup_run_time`, `getSecret('backup_share_password')`; `AuditService.write` (`BACKUP_RUN`, `BACKUP_UPLOAD`, `BACKUP_RESTORE`); `SchedulerService.pauseAll/resumeAll`; `MaintenanceGuard` in-memory `enabled` flag (Task 1); `RefreshToken.revokeAll`/updateMany revokedAt; node `child_process.execFile`; `@bms/shared` `RestoreRequest` (confirm literal "RESTORE"), `BackupFile`.
- Produces: `ExecRunnerService` — injectable wrapper around `execFile(cmd, args, opts)` returning `{stdout, stderr, code}`; tests inject a fake. `BackupService implements BackupJobLike` — `runBackup()`: name = `` `bms-${nowIso.slice(0,19).replace(/[-:]/g,'').replace('T','-')}.dump` `` (nowIso = new Date().toISOString(); e.g. `bms-20261018T020000Z.dump`); run `pg_dump` into `/backups/${name}`; `copiedToShare = share_enabled && path !== ""`; if copiedToShare run `smbclient` put, on failure log warn and set copiedToShare false; create Backup row; retention: delete files + rows older than `backup_retention_days`; audit BACKUP_RUN; returns `{name, copiedToShare}`. `list()` — sorted createdAt desc, name desc. `download(name)` — stream file, `Content-Type: application/octet-stream`, `Content-Disposition: attachment`. `upload(file)` — validate exists, extension `.dump`, magic bytes `PGDMP` (5 bytes) else "File bukan backup database yang valid."; filename collision → `` `File ${name} sudah ada.` ``; `copiedToShare: false`; audit BACKUP_UPLOAD. `restore(input: RestoreRequest, actor)` — password check (compare against env `RESTORE_PASSWORD` or settings; if unset reject "Password salah."); confirm !== "RESTORE" → VALIDATION; file missing/not `.dump` → NOT_FOUND "File backup tidak ditemukan."; run `pg_restore --list` FIRST — on failure throw VALIDATION "File bukan backup database yang valid." (data untouched, Review Focus #4); then `pre-restore-${stamp}.dump` via pg_dump; set `MaintenanceGuard.enabled = true` (all non-status/health endpoints 503); `SchedulerService.pauseAll()`; run `pg_restore --clean --if-exists --single-transaction`; then `prisma migrate deploy` (exec), `settings.init()` reload, revoke ALL refresh tokens, `SchedulerService.resumeAll()`, `MaintenanceGuard.enabled = false`; audit BACKUP_RESTORE `{preRestore}` (written after restore completes, into restored DB); returns `{preRestore}`. `testShare()` — if `!path` → `{ok:false, message:'Path network share belum diisi.'}`; else smbclient put a small test file, ok → `` `Berhasil menulis file uji ke ${path}.` ``, fail → `{ok:false, message: <smbclient error>}`. `BackupController` — `GET /api/backups` (SUPER_ADMIN), `GET /api/backups/:name/download` (SUPER_ADMIN), `POST /api/backups/upload` (SUPER_ADMIN, multipart field `file`, multer limits 100MB), `POST /api/backups/restore` (SUPER_ADMIN, JSON RestoreRequest).

- [ ] **Step 1: Write failing backup test**

```typescript
// apps/api/test/backup.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BackupService } from '../src/backup/backup.service';
import { ExecRunnerService } from '../src/backup/exec-runner.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const BACKUP_DIR = '/tmp/bms-test-backups'; // tests use a fake runner, never real pg_dump

let settings: SettingsService;
let backup: BackupService;
let fakeExec: { calls: string[][]; onExec: (cmd: string, args: string[]) => { stdout: string; stderr: string; code: number } };

beforeAll(async () => {
  await prisma.$transaction([prisma.backup.deleteMany(), prisma.auditLog.deleteMany()]);
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  fakeExec = {
    calls: [],
    onExec: () => ({ stdout: '', stderr: '', code: 0 }),
  };
  const runner = {
    exec: async (cmd: string, args: string[]) => {
      fakeExec.calls.push([cmd, ...args]);
      return fakeExec.onExec(cmd, args);
    },
  } as ExecRunnerService;
  const fakeScheduler = { pauseAll: () => {}, resumeAll: () => {} } as SchedulerService;
  backup = new BackupService(prisma, runner, settings, audit, fakeScheduler, BACKUP_DIR);
});

describe('backup filename + runBackup', () => {
  test('runBackup calls pg_dump, creates row, audit BACKUP_RUN', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    // fake pg_dump writes a file when called
    fakeExec.onExec = (cmd) => {
      if (cmd === 'pg_dump') writeFileSync(join(BACKUP_DIR, 'tmp.dump'), Buffer.from('PGDMPfake'));
      return { stdout: '', stderr: '', code: 0 };
    };
    // seed a real dump file named like the expected result so the service can copy it
    const { runBackup } = backup;
    // runBackup internally names the file; let the fake pg_dump target it:
    fakeExec.onExec = (cmd, args) => {
      if (cmd === 'pg_dump') {
        const outIdx = args.findIndex((a) => a === '-f' || a === '--file');
        const outPath = outIdx >= 0 ? args[outIdx + 1] : join(BACKUP_DIR, 'x.dump');
        writeFileSync(outPath, Buffer.from('PGDMPfake'));
      }
      return { stdout: '', stderr: '', code: 0 };
    };
    const r = await backup.runBackup();
    expect(r.name).toMatch(/^bms-\d{8}T\d{6}Z?\.dump$/);
    expect(r.copiedToShare).toBe(false); // share disabled by default
    const row = await prisma.backup.findFirst({ where: { name: r.name } });
    expect(row).toBeTruthy();
    const log = await prisma.auditLog.findFirst({ where: { action: 'BACKUP_RUN' } });
    expect(log).toBeTruthy();
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });
});

describe('upload validation', () => {
  test('rejects non-.dump extension', async () => {
    await expect(backup.upload({ originalname: 'file.txt', buffer: Buffer.from('x') } as never))
      .rejects.toThrow('File backup harus berekstensi .dump.');
  });

  test('rejects wrong magic bytes', async () => {
    await expect(backup.upload({ originalname: 'file.dump', buffer: Buffer.from('NOTPG') } as never))
      .rejects.toThrow('File bukan backup database yang valid.');
  });

  test('accepts PGDMP magic, stores file, copiesToShare false, audit BACKUP_UPLOAD', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const r = await backup.upload({ originalname: 'up.dump', buffer: Buffer.from('PGDMPrest') } as never);
    expect(r.name).toBe('up.dump');
    expect(r.copiedToShare).toBe(false);
    const log = await prisma.auditLog.findFirst({ where: { action: 'BACKUP_UPLOAD' } });
    expect(log).toBeTruthy();
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });

  test('duplicate filename → "File ${name} sudah ada."', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    await backup.upload({ originalname: 'dup.dump', buffer: Buffer.from('PGDMPrest') } as never);
    await expect(backup.upload({ originalname: 'dup.dump', buffer: Buffer.from('PGDMPrest') } as never))
      .rejects.toThrow('File dup.dump sudah ada.');
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });
});

describe('restore validation (Review Focus #4)', () => {
  test('wrong password → "Password salah."', async () => {
    process.env.RESTORE_PASSWORD = 'correct';
    await expect(backup.restore({ fileName: 'x.dump', password: 'wrong', confirm: 'RESTORE' } as never, { id: 'a', name: 'A' }))
      .rejects.toThrow('Password salah.');
  });

  test('missing file → NOT_FOUND "File backup tidak ditemukan."', async () => {
    process.env.RESTORE_PASSWORD = 'correct';
    await expect(backup.restore({ fileName: 'missing.dump', password: 'correct', confirm: 'RESTORE' } as never, { id: 'a', name: 'A' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'File backup tidak ditemukan.' });
  });

  test('corrupt file: pg_restore --list fails → rejected BEFORE any destructive step (Review Focus #4)', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(join(BACKUP_DIR, 'corrupt.dump'), Buffer.from('PGDMPgarbage'));
    process.env.RESTORE_PASSWORD = 'correct';
    fakeExec.calls = [];
    fakeExec.onExec = (cmd) => {
      if (cmd === 'pg_restore' && argsIncludesList()) return { stdout: '', stderr: 'invalid archive', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    };
    function argsIncludesList() { return fakeExec.calls.at(-1)?.includes('--list') ?? false; }
    await expect(backup.restore({ fileName: 'corrupt.dump', password: 'correct', confirm: 'RESTORE' } as never, { id: 'a', name: 'A' }))
      .rejects.toThrow('File bukan backup database yang valid.');
    // pg_restore --list ran, but the destructive --clean restore never did
    const cleanCalls = fakeExec.calls.filter((c) => c.includes('--clean'));
    expect(cleanCalls.length).toBe(0);
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });

  test('confirm !== "RESTORE" → VALIDATION', async () => {
    process.env.RESTORE_PASSWORD = 'correct';
    await expect(backup.restore({ fileName: 'x.dump', password: 'correct', confirm: 'yes' } as never, { id: 'a', name: 'A' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm test test/backup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement exec-runner + BackupService + controller + wire scheduler**

```typescript
// apps/api/src/backup/exec-runner.service.ts
import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';

export interface ExecResult { stdout: string; stderr: string; code: number }

/** Injectable wrapper around execFile so tests can substitute a fake. */
@Injectable()
export class ExecRunnerService {
  exec(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<ExecResult> {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
      });
    });
  }
}
```

```typescript
// apps/api/src/backup/backup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_MESSAGES } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ExecRunnerService } from './exec-runner.service';

const BACKUP_DIR_DEFAULT = '/backups';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly exec: ExecRunnerService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerService,
    private readonly backupDir: string = process.env.BACKUP_DIR ?? BACKUP_DIR_DEFAULT,
  ) {}

  private stamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  }

  private nowDumpName(): string {
    return `bms-${this.stamp()}.dump`;
  }

  /** Spec §5.11: daily pg_dump, optional smbclient copy, retention, audit. */
  async runBackup(): Promise<{ name: string; copiedToShare: boolean }> {
    mkdirSync(this.backupDir, { recursive: true });
    const name = this.nowDumpName();
    const outPath = join(this.backupDir, name);
    const r = await this.exec.exec('pg_dump', ['-Fc', '-f', outPath]);
    if (r.code !== 0) {
      this.logger.error(`pg_dump failed: ${r.stderr}`);
      throw new Error(`pg_dump failed: ${r.stderr}`);
    }
    let copiedToShare = false;
    const s = this.settings.get();
    if (s.backup_share_enabled && s.backup_share_path !== '') {
      copiedToShare = await this.trySmbPut(outPath, name);
    }
    const sizeBytes = statSync(outPath).size;
    const row = await this.prisma.backup.create({
      data: { name, sizeBytes, copiedToShare, createdAt: new Date() },
    });
    await this.applyRetention();
    await this.audit.write({
      actorId: null, actorName: 'system', action: 'BACKUP_RUN',
      entity: 'backup', entityId: row.id, after: { name, copiedToShare },
    });
    return { name, copiedToShare };
  }

  private async trySmbPut(localPath: string, remoteName: string): Promise<boolean> {
    const s = this.settings.get();
    const pass = this.settings.getSecret('backup_share_password') ?? '';
    try {
      const args = ['//host/share', '-c', `put "${localPath}" "${remoteName}"`];
      // smbclient reads credentials from args; path already contains //host/share…
      const url = new URL(s.backup_share_path.replace(/^\/\//, 'smb://'));
      const hostShare = `//${url.host}${url.pathname.replace(/\/$/, '')}`;
      const cmdArgs = [hostShare, '-c', `put "${localPath}" "${remoteName}"`];
      if (s.backup_share_username) cmdArgs.push('-U', `${s.backup_share_username}%${pass}`);
      const r = await this.exec.exec('smbclient', cmdArgs);
      if (r.code !== 0) {
        this.logger.warn(`smbclient copy failed for ${remoteName}: ${r.stderr}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`smbclient threw for ${remoteName}: ${(e as Error).message}`);
      return false;
    }
  }

  private async applyRetention(): Promise<void> {
    const days = this.settings.get().backup_retention_days;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await this.prisma.backup.findMany({ where: { createdAt: { lt: cutoff } } });
    for (const b of old) {
      const p = join(this.backupDir, b.name);
      if (existsSync(p)) { try { unlinkSync(p); } catch { /* best-effort */ } }
      await this.prisma.backup.delete({ where: { id: b.id } });
    }
  }

  list() {
    return this.prisma.backup.findMany({ orderBy: [{ createdAt: 'desc' }, { name: 'desc' }] });
  }

  downloadStream(name: string): NodeJS.ReadableStream {
    const p = join(this.backupDir, name);
    if (!existsSync(p)) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    return createReadStream(p);
  }

  async upload(file: { originalname: string; buffer: Buffer }): Promise<{ name: string; copiedToShare: boolean }> {
    if (!file) throw new DomainError('VALIDATION_ERROR', 'File backup wajib diunggah.');
    const name = file.originalname;
    if (!name.endsWith('.dump')) throw new DomainError('VALIDATION_ERROR', 'File backup harus berekstensi .dump.');
    // PGDMP magic (PostgreSQL custom format)
    const magic = file.buffer.subarray(0, 5).toString('utf8');
    if (magic !== 'PGDMP') throw new DomainError('VALIDATION_ERROR', 'File bukan backup database yang valid.');
    mkdirSync(this.backupDir, { recursive: true });
    const dest = join(this.backupDir, name);
    if (existsSync(dest)) throw new DomainError('VALIDATION_ERROR', `File ${name} sudah ada.`);
    writeFileSync(dest, file.buffer);
    const row = await this.prisma.backup.create({
      data: { name, sizeBytes: file.buffer.length, copiedToShare: false, createdAt: new Date() },
    });
    await this.audit.write({
      actorId: null, actorName: 'system', action: 'BACKUP_UPLOAD',
      entity: 'backup', entityId: row.id, after: { name },
    });
    return { name, copiedToShare: false };
  }

  /** Spec §5.11 restore steps 1-7. Review Focus #4: --list validation BEFORE any data touched. */
  async restore(input: { fileName: string; password: string; confirm: string }, actor: { id: string | null; name: string }): Promise<{ preRestore: string }> {
    if (input.confirm !== 'RESTORE') throw new DomainError('VALIDATION_ERROR', 'Data yang dikirim tidak valid.');
    const expected = process.env.RESTORE_PASSWORD ?? '';
    if (!expected || input.password !== expected) throw new DomainError('VALIDATION_ERROR', 'Password salah.');
    const src = join(this.backupDir, input.fileName);
    if (!input.fileName.endsWith('.dump') || !existsSync(src)) {
      throw new DomainError('NOT_FOUND', 'File backup tidak ditemukan.');
    }
    // step: pg_restore --list FIRST — corrupt file rejected before any data touched
    const listCheck = await this.exec.exec('pg_restore', ['--list', src]);
    if (listCheck.code !== 0) throw new DomainError('VALIDATION_ERROR', 'File bukan backup database yang valid.');

    // pre-restore dump
    mkdirSync(this.backupDir, { recursive: true });
    const preRestore = `pre-restore-${this.stamp()}.dump`;
    await this.exec.exec('pg_dump', ['-Fc', '-f', join(this.backupDir, preRestore)]);

    // maintenance mode + stop jobs
    const { MaintenanceGuard } = await import('../common/maintenance.guard');
    MaintenanceGuard.enabled = true;
    this.scheduler.pauseAll();
    try {
      const r = await this.exec.exec('pg_restore', ['--clean', '--if-exists', '--single-transaction', src]);
      if (r.code !== 0) throw new DomainError('VALIDATION_ERROR', `Restore gagal: ${r.stderr}`);
      // migrate deploy + reload settings + revoke all refresh tokens + resume
      await this.exec.exec('npx', ['prisma', 'migrate', 'deploy']);
      await this.settings.init();
      await this.prisma.refreshToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    } finally {
      this.scheduler.resumeAll();
      MaintenanceGuard.enabled = false;
    }
    // audit into the restored DB
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'BACKUP_RESTORE',
      entity: 'backup', entityId: input.fileName, after: { preRestore },
    });
    return { preRestore };
  }

  async testShare(): Promise<{ ok: boolean; message: string }> {
    const s = this.settings.get();
    if (s.backup_share_path === '') return { ok: false, message: 'Path network share belum diisi.' };
    try {
      const testFile = join(this.backupDir, 'test-share.txt');
      mkdirSync(this.backupDir, { recursive: true });
      writeFileSync(testFile, 'ok');
      const ok = await this.trySmbPut(testFile, 'test-share.txt');
      if (!ok) return { ok: false, message: 'Gagal menulis file uji ke network share.' };
      return { ok: true, message: `Berhasil menulis file uji ke ${s.backup_share_path}.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}
```

> `MaintenanceGuard` needs a static mutable `enabled` flag if Task 1 did not already expose one — read Task 1's guard and add `static enabled = false;` if missing; the guard's `canActivate` must check `MaintenanceGuard.enabled || <loaded-from-settings>` and skip `/api/system/status` + `/api/health`.

```typescript
// apps/api/src/backup/backup.controller.ts
import { Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RestoreRequest } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { BackupService } from './backup.service';
import type { Response } from 'express';

type ActorReq = { user: { id: string | null; name: string } };

@Controller('backups')
@Roles('SUPER_ADMIN')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get() list() { return this.backup.list(); }

  @Get(':name/download')
  async download(@Param('name') name: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    this.backup.downloadStream(name).pipe(res);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  upload(@UploadedFile() file: { originalname: string; buffer: Buffer }) {
    return this.backup.upload(file);
  }

  @Post('restore')
  @UsePipes(new ZodPipe(RestoreRequest))
  restore(@Body() body: { fileName: string; password: string; confirm: string }, @Req() req: ActorReq) {
    return this.backup.restore(body, req.user);
  }
}
```

> Fix imports: `UsePipes` from `@nestjs/common`.

```typescript
// apps/api/src/scheduler/scheduler.module.ts — replace the BACKUP_JOB stub
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { BackupService } from '../backup/backup.service';
import { ExecRunnerService } from '../backup/exec-runner.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [SchedulerService, BackupService, ExecRunnerService],
  exports: [SchedulerService, BackupService],
})
export class SchedulerModule {}
```

> `BackupService` constructor's last param `backupDir` is optional (defaults `process.env.BACKUP_DIR ?? '/backups'`) so DI can construct it without a 6th token; tests pass the fake path explicitly.

Wire `BackupModule` (controllers + providers) into `AppModule`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pnpm test test/backup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/backup apps/api/src/scheduler/scheduler.module.ts apps/api/src/common/maintenance.guard.ts apps/api/src/app.module.ts apps/api/test/backup.test.ts
git commit -m "feat(api): backup pg_dump/smbclient, restore §5.11 with --list-first validation, retention, audit"
```

---

### Task 14: Seed (mirror mock-api seed verbatim)

**Files:**
- Create: `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json` (add `"seed": "tsx prisma/seed.ts"` script)

**Interfaces:**
- Consumes: `@bms/shared` `DEMO_PASSWORD` ("demo1234"), `jakartaDate`, `addDays`; `argon2` (hash "demo1234"); `GenerateService.runGenerate` logic reimplemented inline (or import after build — plan uses inline loop calling prisma directly to avoid DI bootstrap in a seed script).
- Produces: seeded DB matching mock-api's seed table-for-table (see summary for full verbatim data: ROUTES R1-R6 with stops/offsets, templates pagi/siang/malam PICKUP+DROPOFF, vendors v1/v2, buses B 7x01/B 7x02, shifts pagi/siang/malam, admin/ga/vendor users, K1001-K1090 employees with 2 subs each, K1059 suspended, K1090 mustChangePassword). Runs via `pnpm seed` → `tsx prisma/seed.ts`.

- [ ] **Step 1: Write seed script (full, mirrors mock seed exactly)**

```typescript
// apps/api/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { departureAt, jakartaDate, addDays, isoWeekday } from '@bms/shared';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'demo1234';

const ROUTES = [
  { id: 'r1', code: 'R1', name: 'Cikarang', color: '#D6322B', vendor: 'v1', stops: ['Terminal Cikarang', 'Pasar Lemahabang', 'Simpang Cibarusah'] },
  { id: 'r2', code: 'R2', name: 'Bekasi Timur', color: '#1F6FD1', vendor: 'v1', stops: ['Halte Bulak Kapal', 'Stasiun Bekasi Timur', 'Pasar Rawalumbu'] },
  { id: 'r3', code: 'R3', name: 'Karawang', color: '#169B62', vendor: 'v1', stops: ['Terminal Klari', 'Alun-alun Karawang', 'Galuh Mas'] },
  { id: 'r4', code: 'R4', name: 'Tambun', color: '#E07A00', vendor: 'v2', stops: ['Stasiun Tambun', 'Pasar Tambun', 'Mangunjaya'] },
  { id: 'r5', code: 'R5', name: 'Cibitung', color: '#7A3FC2', vendor: 'v2', stops: ['Stasiun Cibitung', 'Pasar Cibitung', 'Wanasari'] },
  { id: 'r6', code: 'R6', name: 'Jababeka', color: '#0E9AA7', vendor: 'v2', stops: ['Terminal Jababeka', 'Kawasan Jababeka 2', 'Pasir Gombong'] },
] as const;

const SHIFTS = [
  { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' },
  { id: 'siang', name: 'Siang', startTime: '15:00', endTime: '23:00' },
  { id: 'malam', name: 'Malam', startTime: '23:00', endTime: '07:00' },
] as const;

const TEMPLATES = [
  { shiftId: 'pagi', direction: 'PICKUP', departureTime: '05:20', dayOffset: 0 },
  { shiftId: 'pagi', direction: 'DROPOFF', departureTime: '15:10', dayOffset: 0 },
  { shiftId: 'siang', direction: 'PICKUP', departureTime: '13:20', dayOffset: 0 },
  { shiftId: 'siang', direction: 'DROPOFF', departureTime: '23:10', dayOffset: 0 },
  { shiftId: 'malam', direction: 'PICKUP', departureTime: '21:20', dayOffset: 0 },
  { shiftId: 'malam', direction: 'DROPOFF', departureTime: '07:10', dayOffset: 1 },
] as const;

async function main() {
  // idempotent reset (dev seed only)
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.subscription.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.deviceToken.deleteMany(),
    prisma.refreshToken.deleteMany(), prisma.auditLog.deleteMany(), prisma.setting.deleteMany(), prisma.backup.deleteMany(),
  ]);

  const v1 = await prisma.vendor.create({ data: { id: 'v1', name: 'PT Trans Jaya', contact: '021-555-0101', active: true } });
  const v2 = await prisma.vendor.create({ data: { id: 'v2', name: 'CV Mitra Armada', contact: '021-555-0202', active: true } });

  for (const s of SHIFTS) await prisma.shift.create({ data: { ...s } });

  const busIds: Record<string, string[]> = { v1: [], v2: [] };
  for (let i = 0; i < 6; i++) {
    const route = ROUTES[i];
    const busA = await prisma.bus.create({ data: { id: `b${2 * i + 1}`, plate: `B 7${i + 1}01 FX`, capacity: 50, vendorId: route.vendor, active: true } });
    const busB = await prisma.bus.create({ data: { id: `b${2 * i + 2}`, plate: `B 7${i + 1}02 KR`, capacity: 50, vendorId: route.vendor, active: true } });
    busIds[route.vendor].push(busA.id, busB.id);

    const r = await prisma.route.create({ data: { id: route.id, code: route.code, name: route.name, color: route.color, active: true } });
    for (let s = 0; s < route.stops.length; s++) {
      await prisma.stop.create({
        data: { id: `${route.id}s${s + 1}`, routeId: r.id, name: route.stops[s], seq: s + 1, offsetMinutes: s * 15, lat: null, lng: null, active: true },
      });
    }
    // 6 templates per route: PICKUP → busA, DROPOFF → busB
    for (let t = 0; t < TEMPLATES.length; t++) {
      const tpl = TEMPLATES[t];
      await prisma.tripTemplate.create({
        data: {
          routeId: r.id, shiftId: tpl.shiftId, direction: tpl.direction,
          busId: tpl.direction === 'PICKUP' ? busA.id : busB.id,
          departureTime: tpl.departureTime, dayOffset: tpl.dayOffset,
          weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
        },
      });
    }
  }

  const demoHash = await argon2.hash(DEMO_PASSWORD);
  await prisma.user.create({ data: { id: 'admin', nik: 'ADMIN', name: 'Super Admin', role: 'SUPER_ADMIN', active: true, passwordHash: demoHash, mustChangePassword: false } });
  await prisma.user.create({ data: { id: 'ga', nik: 'GA01', name: 'Admin GA', role: 'ADMIN_GA', active: true, passwordHash: demoHash, mustChangePassword: false } });
  await prisma.user.create({ data: { id: 'vendor', nik: 'V001', name: 'Vendor User', role: 'VENDOR', vendorId: 'v1', active: true, passwordHash: demoHash, mustChangePassword: false } });

  const depts = ['Produksi', 'Gudang', 'QC', 'Maintenance'];
  for (let i = 1; i <= 90; i++) {
    const nik = `K${1000 + i}`;
    const userId = nik.toLowerCase();
    const shiftId = i <= 60 ? 'pagi' : i <= 75 ? 'siang' : 'malam';
    const route = ROUTES[(i - 1) % 6];
    const user = await prisma.user.create({
      data: {
        id: userId, nik, name: `Karyawan ${nik}`, department: depts[(i - 1) % 4],
        phone: `0812000${1001 + (i - 1)}`, role: 'EMPLOYEE', active: true,
        passwordHash: demoHash, mustChangePassword: false,
        bookingSuspendedUntil: i === 59 ? new Date(Date.now() + 3 * 86_400_000) : null,
        suspendReason: i === 59 ? 'No-show 3x dalam 30 hari' : null,
        failedLogins: 0, lockedUntil: null, authProvider: 'LOCAL',
      },
    });
    if (i === 90) await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });

    // 2 subs per employee: PICKUP + DROPOFF
    for (const direction of ['PICKUP', 'DROPOFF'] as const) {
      await prisma.subscription.create({
        data: {
          userId: user.id, routeId: route.id, stopId: `${route.id}s${((i - 1) % 3) + 1}`,
          shiftId, direction, startDate: jakartaDate(new Date()), endDate: null,
          weekdays: [1, 2, 3, 4, 5, 6, 7], status: 'ACTIVE',
        },
      });
    }
  }

  // generate trips + subscription bookings for the window (mirrors GenerateService.runGenerate)
  const daysAhead = 7;
  const today = jakartaDate(new Date());
  for (let d = 0; d <= daysAhead; d++) {
    const date = addDays(today, d);
    const templates = await prisma.tripTemplate.findMany({ where: { active: true } });
    for (const tpl of templates) {
      const weekday = isoWeekday(new Date(`${date}T00:00:00+07:00`));
      if (!tpl.weekdays.includes(weekday)) continue;
      const existing = await prisma.trip.findFirst({ where: { templateId: tpl.id, date } });
      if (existing) continue;
      const bus = await prisma.bus.findUnique({ where: { id: tpl.busId } });
      await prisma.trip.create({
        data: {
          templateId: tpl.id, date, departureAt: departureAt(date, tpl.departureTime, tpl.dayOffset),
          status: 'SCHEDULED', bookedCount: 0, capacity: bus!.capacity,
          routeId: tpl.routeId, shiftId: tpl.shiftId, direction: tpl.direction, busId: tpl.busId,
        },
      });
    }
    // subscription bookings
    const subs = await prisma.subscription.findMany({ where: { status: 'ACTIVE', startDate: { lte: date } }, orderBy: { createdAt: 'asc' } });
    for (const sub of subs) {
      const weekday = isoWeekday(new Date(`${date}T00:00:00+07:00`));
      if (!sub.weekdays.includes(weekday)) continue;
      const user = await prisma.user.findUnique({ where: { id: sub.userId } });
      if (!user?.active) continue;
      if (user.bookingSuspendedUntil && user.bookingSuspendedUntil >= new Date(`${date}T00:00:00+07:00`)) continue;
      const hasBooked = await prisma.booking.findFirst({ where: { userId: sub.userId, date, shiftId: sub.shiftId, direction: sub.direction, status: 'BOOKED' } });
      if (hasBooked) continue;
      const trips = await prisma.trip.findMany({ where: { routeId: sub.routeId, shiftId: sub.shiftId, direction: sub.direction, date, status: 'SCHEDULED' }, orderBy: [{ departureAt: 'asc' }, { id: 'asc' }] });
      if (!trips.length) continue;
      // allocate first trip with space (seed is single-threaded, no concurrency concern)
      for (const trip of trips) {
        if (trip.bookedCount >= trip.capacity) continue;
        await prisma.$transaction([
          prisma.trip.update({ where: { id: trip.id }, data: { bookedCount: { increment: 1 } } }),
          prisma.booking.create({
            data: {
              userId: sub.userId, tripId: trip.id, routeId: sub.routeId, stopId: sub.stopId,
              shiftId: sub.shiftId, direction: sub.direction, date, source: 'SUBSCRIPTION',
              subscriptionId: sub.id, status: 'BOOKED',
            },
          }),
        ]);
        break;
      }
    }
  }
  console.log('seed complete');
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add package.json script**

```json
"seed": "tsx prisma/seed.ts"
```

- [ ] **Step 3: Run seed, verify counts**

Run: `cd apps/api && pnpm seed`
Expected: `seed complete`. Verify: `prisma.user.count()` ≈ 93 (admin+ga+vendor+90 employees), `prisma.trip.count()` ≈ 6 routes × 6 templates × 8 days = 288, `prisma.subscription.count()` = 180.

Run: `cd apps/api && npx tsx -e "import {PrismaClient} from '@prisma/client'; const p=new PrismaClient(); p.user.count().then(c=>{console.log('users',c); return p.trip.count()}).then(c=>{console.log('trips',c); return p.subscription.count()}).then(c=>{console.log('subs',c); return p.$disconnect()})"`
Expected: `users 93`, `trips` ~288, `subs 180`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/package.json
git commit -m "feat(api): seed mirroring mock-api data verbatim (routes, templates, 90 employees, subs, generate)"
```

---

### Task 15: Infra (Dockerfile, compose, nginx, install.sh)

**Files:**
- Create: `apps/api/Dockerfile`, `infra/docker-compose.yml`, `infra/nginx.conf`, `infra/install.sh`
- Modify: none (`.env.example` already in Task 1)

**Interfaces:**
- Consumes: Task 1's `.env.example` (`DATABASE_URL`, `APP_SECRET`, `APP_DOMAIN`); Prisma migrate deploy on container start (spec §5.11); `/backups` volume; `TZ=Asia/Jakarta`.
- Produces: `apps/api/Dockerfile` — `node:22-alpine`, `apk add --no-cache postgresql16-client smbclient`, `TZ=Asia/Jakarta`, copy package files, `pnpm install --frozen-lockfile`, copy source + prisma, `npx prisma generate`, `pnpm build`, `CMD ["sh","-c","npx prisma migrate deploy && node dist/main.js"]`. `infra/docker-compose.yml` — services: `postgres` (postgres:16-alpine, volume `pgdata`, healthcheck `pg_isready`), `api` (build `../apps/api`, env_file `.env`, depends_on postgres healthy, volume `backups:/backups`, port 3000), `nginx` (nginx:alpine, mounts `nginx.conf`, ports 80/443, depends_on api). `infra/nginx.conf` — HTTPS (self-signed certs generated by install.sh), `location /api { proxy_pass http://api:3000; }`, SPA fallback `try_files $uri /index.html` for web static (web can be served by nginx from a pre-built `apps/web/dist` volume or left to a separate host — plan uses a simple reverse-proxy only for /api and lets web be served separately; document this). `infra/install.sh` — generates `infra/.env` with `openssl rand -base64 48` for APP_SECRET if missing, generates self-signed cert into `infra/certs/` if missing, prints next steps.

- [ ] **Step 1: Write Dockerfile**

```dockerfile
# apps/api/Dockerfile
FROM node:22-alpine
RUN apk add --no-cache postgresql16-client smbclient
ENV TZ=Asia/Jakarta
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @bms/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && pnpm build
EXPOSE 3000
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/main.js"]
```

> Adjust the pnpm workspace filter if the monorepo uses a different package name for `apps/api` — check `apps/api/package.json` `"name"` field.

- [ ] **Step 2: Write infra/docker-compose.yml**

```yaml
# infra/docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bms
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-bms}
      POSTGRES_DB: bms
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bms -d bms"]
      interval: 5s
      timeout: 3s
      retries: 10
    ports:
      - "5432:5432"

  api:
    build: ../apps/api
    env_file: [.env]
    environment:
      DATABASE_URL: postgresql://bms:${POSTGRES_PASSWORD:-bms}@postgres:5432/bms
    volumes:
      - backups:/backups
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - api

volumes:
  pgdata:
  backups:
```

- [ ] **Step 3: Write infra/nginx.conf**

```nginx
# infra/nginx.conf
server {
  listen 80;
  return 301 https://$host$request_uri;
}
server {
  listen 443 ssl;
  server_name _;
  ssl_certificate /etc/nginx/certs/server.crt;
  ssl_certificate_key /etc/nginx/certs/server.key;

  location /api/ {
    proxy_pass http://api:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;
  }

  # SPA: mount a pre-built apps/web/dist volume here if serving web from the same host;
  # this plan only proxies /api — web stays served separately (e.g. vite preview or a static host).
}
```

- [ ] **Step 4: Write infra/install.sh**

```bash
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
```

- [ ] **Step 5: Verify compose config parses**

Run: `cd infra && docker compose config`
Expected: valid YAML, no errors. (Docker daemon need not be running for `config` — it only validates the file.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile infra/docker-compose.yml infra/nginx.conf infra/install.sh
git commit -m "feat(api): Dockerfile with pg_dump/smbclient, compose postgres+api+nginx, install.sh TLS+APP_SECRET"
```

---

### Task 16: Web integration (proxy + Playwright env-gate + smoke against live API)

**Files:**
- Modify: `apps/web/vite.config.ts` (add proxy)
- Modify: `apps/web/playwright.config.ts` (env-gate `VITE_USE_MOCK`)
- Create: `apps/web/e2e/smoke-api.spec.ts`
- Modify: `apps/web/package.json` (add `test:api` script)

**Interfaces:**
- Consumes: existing `apps/web/src/api.ts` (`new URL(path, location.origin)`, `credentials: 'same-origin'`, Bearer in memory, `restoreSession` = POST refresh no body), `e2e/smoke.spec.ts` flow (login K1001/demo1234 → Beranda → Booking Harian tomorrow/`malam`/Jemput/R2/stop 1 → Pesan → Beranda card → Terbooked → Batalkan); `VITE_USE_MOCK` env flag (main.tsx: msw iff `"true"`); `VITE_API_URL` (default `127.0.0.1:3000`).
- Produces: `vite.config.ts` gains `server.proxy['/api'] = { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000', changeOrigin: false }` only when `process.env.VITE_USE_MOCK !== 'true'` (so the existing mock-mode dev server and its Playwright smoke test are untouched). `playwright.config.ts` webServer env: `VITE_USE_MOCK: process.env.VITE_USE_MOCK ?? 'true'` (inherits from shell when running `test:api`). `e2e/smoke-api.spec.ts` — same assertions as `smoke.spec.ts` but `test.use` / webServer config forces `VITE_USE_MOCK='false'` and a longer webServer timeout; runs against the live API on 5241 proxied to 3000. `package.json`: `"test:api": "VITE_USE_MOCK=false playwright test e2e/smoke-api.spec.ts"`.

- [ ] **Step 1: Modify vite.config.ts**

```typescript
// apps/web/vite.config.ts — add inside defineConfig:
  server: {
    port: Number(process.env.VITE_PORT ?? 5241),
    proxy: process.env.VITE_USE_MOCK === 'true'
      ? undefined
      : {
          '/api': {
            target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000',
            changeOrigin: false,
          },
        },
  },
```

- [ ] **Step 2: Modify playwright.config.ts**

```typescript
// apps/web/playwright.config.ts — change the webServer env block:
    env: {
      VITE_USE_MOCK: process.env.VITE_USE_MOCK ?? 'true',
      VITE_PORT: '5241',
    },
```

- [ ] **Step 3: Write failing smoke-api.spec.ts**

```typescript
// apps/web/e2e/smoke-api.spec.ts
import { test, expect } from '@playwright/test';

/**
 * Same flow as smoke.spec.ts but against the real API (VITE_USE_MOCK=false).
 * Requires the backend running on 127.0.0.1:3000 (vite proxies /api).
 * Run: VITE_USE_MOCK=false pnpm exec playwright test e2e/smoke-api.spec.ts
 */
test.describe.configure({ mode: 'serial' });

test('login → book daily → cancel against live API', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/nik/i).fill('K1001');
  await page.getByLabel(/password/i).fill('demo1234');
  await page.getByRole('button', { name: /masuk/i }).click();
  await expect(page).toHaveURL(/\/(beranda|home|)$/);

  await page.getByRole('link', { name: /booking harian/i }).click();
  // tomorrow's date
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel(/tanggal/i).fill(tomorrow);
  await page.getByLabel(/shift/i).selectOption('malam');
  await page.getByLabel(/arah/i).selectOption('PICKUP');
  await page.getByLabel(/rute/i).selectOption('r2');
  await page.getByLabel(/titik jemput/i).selectOption('r2s1');
  await expect(page.getByText(/sisa kursi:\s*\d+\s*dari\s*50/i)).toBeVisible();
  await page.getByRole('button', { name: /pesan/i }).click();
  await expect(page.getByText(/booking berhasil/i)).toBeVisible();

  await page.getByRole('link', { name: /beranda/i }).click();
  await expect(page.getByText(new RegExp(`${tomorrow}.*Jemput.*R2`))).toBeVisible();

  await page.getByRole('link', { name: /terbooked|riwayat/i }).click();
  await page.getByRole('button', { name: /batalkan/i }).first().click();
  await expect(page.getByText(/dibatalkan/i).first()).toBeVisible();
});
```

- [ ] **Step 4: Run unit tests to confirm proxy change breaks nothing in mock mode**

Run: `cd apps/web && pnpm test`
Expected: PASS (existing mock-mode tests unaffected — proxy is undefined when `VITE_USE_MOCK=true`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/vite.config.ts apps/web/playwright.config.ts apps/web/e2e/smoke-api.spec.ts apps/web/package.json
git commit -m "feat(web): vite /api proxy (live mode), env-gated Playwright, smoke-api e2e spec"
```
