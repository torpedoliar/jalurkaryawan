// apps/api/test/http-smoke.test.ts — final-fix E1: error pipeline + DI wiring over real HTTP (AppModule).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { AuditLog, BackupFile, LoginResponse, SystemStatus, addDays, jakartaDate } from '@bms/shared';
import { AppModule } from '../src/app.module';
import { BackupService } from '../src/backup/backup.service';
import { BACKUP_JOB, SchedulerService } from '../src/scheduler/scheduler.service';

const prisma = new PrismaClient();
let app: NestExpressApplication;
let base: string;
let token: string;
const suspendedUntil = addDays(jakartaDate(new Date()), 3);

const wipe = () =>
  prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.subscription.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(),
    prisma.auditLog.deleteMany(), prisma.user.deleteMany(), prisma.backup.deleteMany(),
  ]);

beforeAll(async () => {
  await wipe();
  const passwordHash = await argon2.hash('demo1234');
  await prisma.user.create({ data: { id: 'smoke-admin', nik: 'smoke-admin', name: 'Smoke Admin', role: 'SUPER_ADMIN', passwordHash } });
  await prisma.user.create({
    data: {
      nik: 'K1059', name: 'Suspended', role: 'EMPLOYEE', passwordHash,
      bookingSuspendedUntil: new Date(`${suspendedUntil}T00:00:00+07:00`), suspendReason: 'No-show 3x dalam 30 hari',
    },
  });
  await prisma.vendor.create({ data: { id: 'smoke-v', name: 'V', contact: '' } });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.useBodyParser('json', { limit: '10mb' }); // mirrors main.ts
  app.setGlobalPrefix('api');
  await app.listen(0);
  base = await app.getUrl();
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nik: 'smoke-admin', password: 'demo1234' }),
  });
  token = ((await r.json()) as { accessToken: string }).accessToken;
});

afterAll(async () => {
  await app?.close();
  await wipe();
  await prisma.$disconnect();
});

const call = (method: string, path: string, body?: string) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body,
  });

describe('error pipeline', () => {
  test('malformed JSON body → 400 VALIDATION_ERROR "Body harus JSON."', async () => {
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'VALIDATION_ERROR', message: 'Body harus JSON.' });
  });

  test('unknown route → 404 NOT_FOUND shared message', async () => {
    const res = await call('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
  });

  test('C1: PUT /api/vendors/:id with valid body → 200 (ZodPipe skips @Param)', async () => {
    const res = await call('PUT', '/api/vendors/smoke-v', JSON.stringify({ name: 'V2', contact: 'x', active: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'smoke-v', name: 'V2' });
  });

  test('C1: param route still validates its body', async () => {
    const res = await call('PUT', '/api/vendors/smoke-v', JSON.stringify({ name: '' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  test('201 → 200 and undefined → 204 (ResponseInterceptor)', async () => {
    const created = await call('POST', '/api/vendors', JSON.stringify({ name: 'New V' }));
    expect(created.status).toBe(200);
    const none = await call('POST', '/api/device-tokens', JSON.stringify({ token: 't1', platform: 'web' }));
    expect(none.status).toBe(204);
  });
});

describe('wiring + wire shapes', () => {
  test('C2: BackupService + BACKUP_JOB resolve non-null and share the scheduler', () => {
    const backup = app.get(BackupService);
    expect(backup).toBeInstanceOf(BackupService);
    expect(app.get(BACKUP_JOB)).toBe(backup);
    const scheduler = app.get(SchedulerService);
    expect((backup as unknown as { scheduler: SchedulerService }).scheduler).toBe(scheduler);
    expect(typeof scheduler.pauseAll).toBe('function');
  });

  test('C2: GET /api/backups → 200 BackupFile[]', async () => {
    await prisma.backup.create({ data: { name: 'bms-smoke.dump', sizeBytes: 1, copiedToShare: false } });
    const res = await call('GET', '/api/backups');
    expect(res.status).toBe(200);
    const rows = BackupFile.array().parse(await res.json());
    expect(rows[0]!.createdAt).toMatch(/\+07:00$/);
  });

  test('I1: GET /api/system/status → 200 SystemStatus (public)', async () => {
    const res = await fetch(`${base}/api/system/status`);
    expect(res.status).toBe(200);
    expect(SystemStatus.parse(await res.json())).toEqual({ maintenance: false, message: null });
  });

  test('C3: suspended-user login parses with shared LoginResponse, Jakarta calendar date', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nik: 'K1059', password: 'demo1234' }),
    });
    expect(res.status).toBe(200);
    const body = LoginResponse.parse(await res.json());
    expect(body.user.bookingSuspendedUntil).toBe(suspendedUntil);
  });

  test('I2: audit list parses with shared AuditLog (system actor, Jakarta createdAt)', async () => {
    await prisma.auditLog.create({ data: { actorId: null, actorName: 'system', action: 'BACKUP_RUN', entity: 'backup', entityId: 'x' } });
    const res = await call('GET', '/api/audit-logs');
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: unknown[] };
    const rows = AuditLog.array().parse(items);
    expect(rows.find((r) => r.action === 'BACKUP_RUN')!.actorId).toBe('system');
    expect(rows[0]!.createdAt).toMatch(/\+07:00$/);
  });

  test('I1: GET /api/users/:id/bookings → 200 array; unknown id → 404', async () => {
    const ok = await call('GET', '/api/users/smoke-admin/bookings');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual([]);
    const missing = await call('GET', '/api/users/nobody/bookings');
    expect(missing.status).toBe(404);
  });
});
