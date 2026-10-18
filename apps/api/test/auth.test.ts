// apps/api/test/auth.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { scryptSync } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let auth: AuthService;
let settings: SettingsService;

beforeAll(async () => {
  // children before parents (brief order violated RefreshToken_userId_fkey on re-runs)
  await prisma.$transaction([
    prisma.booking.deleteMany(),
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), // seeded/live rows hold user+stop FKs
    prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(), prisma.auditLog.deleteMany(),
    prisma.subscription.deleteMany(), prisma.user.deleteMany(),
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
  test('valid refresh rotates; reuse of old token revokes family — successor also fails', async () => {
    await makeUser('K5');
    const first = await auth.login('K5', 'demo1234', '127.0.0.1');
    const second = await auth.refresh(first.refreshToken!);
    expect(second.accessToken).toBeTruthy();
    // reuse detected → revokeAll: successor token dies too, re-login required
    await expect(auth.refresh(first.refreshToken!)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(auth.refresh(second.refreshToken!)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('garbage refresh → UNAUTHORIZED', async () => {
    await expect(auth.refresh('not-a-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

/** SUPER_ADMIN wipe: setup() issues refresh tokens + writes audit with actor FK, so delete children first. */
async function wipeSuperAdmin() {
  const ids = (await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } })).map((u) => u.id);
  if (!ids.length) return;
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

describe('setup + changePassword', () => {
  test('setup once only; second → FORBIDDEN "Setup awal sudah dilakukan."', async () => {
    await wipeSuperAdmin();
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
    await wipeSuperAdmin();
    await expect(auth.setup({ nik: 'X', name: 'Y', password: 'short' })).rejects.toThrow(/Password minimal \d+ karakter\./);
    await wipeSuperAdmin(); // cleanup for next
  });

  test('changePassword: wrong current / same new / success', async () => {
    const u = await makeUser('K6', { pw: 'oldpass1' });
    await expect(auth.changePassword(u.id, 'salah', 'newpass1')).rejects.toThrow('Password lama salah.');
    await expect(auth.changePassword(u.id, 'oldpass1', 'oldpass1')).rejects.toThrow('Password baru harus berbeda.');
    // ruling 2: capture raw refresh token BEFORE changePassword revokes the family
    const raw = (await auth.login('K6', 'oldpass1', '127.0.0.1')).refreshToken;
    await auth.changePassword(u.id, 'oldpass1', 'newpass1');
    const r = await auth.login('K6', 'newpass1', '127.0.0.1');
    expect(r.accessToken).toBeTruthy();
    // tokenHash-based assertion: stored hash still resolves, but revokedAt set → refresh rejects
    const row = await prisma.refreshToken.findFirst({ where: { userId: u.id, revokedAt: { not: null } } });
    expect(row).toBeTruthy();
    await expect(auth.refresh(raw)).rejects.toBeTruthy();
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
