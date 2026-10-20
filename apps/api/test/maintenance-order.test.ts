// apps/api/test/maintenance-order.test.ts — G1: settle guard order empirically (spec §5.11.4).
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { ERROR_MESSAGES } from '@bms/shared';
import { AppModule } from '../src/app.module';
import { MaintenanceGuard } from '../src/common/guards/maintenance.guard';

const prisma = new PrismaClient();
let app: NestExpressApplication;
let base: string;
let token: string;

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
  await prisma.user.create({ data: { id: 'maint-admin', nik: 'maint-admin', name: 'Maint Admin', role: 'SUPER_ADMIN', passwordHash } });
  await prisma.vendor.create({ data: { id: 'maint-v', name: 'V', contact: '' } });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.useBodyParser('json', { limit: '10mb' });
  app.setGlobalPrefix('api');
  await app.listen(0);
  base = await app.getUrl();
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nik: 'maint-admin', password: 'demo1234' }),
  });
  token = ((await r.json()) as { accessToken: string }).accessToken;
});

afterAll(async () => {
  MaintenanceGuard.enabled = false;
  await app?.close();
  await wipe();
  await prisma.$disconnect();
});

const authed = (method: string, path: string, body?: string) =>
  fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body,
  });

describe('G1 guard order: maintenance vs auth (spec §5.11.4)', () => {
  test('maintenance OFF: unauthenticated GET /api/vendors → 401', async () => {
    MaintenanceGuard.enabled = false;
    const res = await fetch(`${base}/api/vendors`);
    expect(res.status).toBe(401);
  });

  test('maintenance ON: unauthenticated GET /api/vendors → 503 MAINTENANCE', async () => {
    MaintenanceGuard.enabled = true;
    try {
      const res = await fetch(`${base}/api/vendors`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe('MAINTENANCE');
      expect(body.message).toBe(ERROR_MESSAGES.MAINTENANCE);
    } finally {
      MaintenanceGuard.enabled = false;
    }
  });

  test('maintenance ON: authenticated GET /api/vendors → 503', async () => {
    MaintenanceGuard.enabled = true;
    try {
      const res = await authed('GET', '/api/vendors');
      expect(res.status).toBe(503);
    } finally {
      MaintenanceGuard.enabled = false;
    }
  });

  test('maintenance ON: /api/system/status and /api/health → 200 (exempt)', async () => {
    MaintenanceGuard.enabled = true;
    try {
      const status = await fetch(`${base}/api/system/status`);
      expect(status.status).toBe(200);
      const health = await fetch(`${base}/api/health`);
      expect(health.status).toBe(200);
    } finally {
      MaintenanceGuard.enabled = false;
    }
  });

  test('maintenance ON: POST /api/auth/login → 503', async () => {
    MaintenanceGuard.enabled = true;
    try {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nik: 'maint-admin', password: 'demo1234' }),
      });
      expect(res.status).toBe(503);
    } finally {
      MaintenanceGuard.enabled = false;
    }
  });
});
