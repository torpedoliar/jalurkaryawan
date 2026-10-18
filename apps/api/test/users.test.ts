import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { scryptSync } from 'node:crypto';
import { UsersService } from '../src/users/users.service';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const actorSuper = { id: 'super1', name: 'Super', role: 'SUPER_ADMIN' } as never;
const actorGa = { id: 'ga1', name: 'GA', role: 'ADMIN_GA' } as never;

let users: UsersService;

beforeAll(async () => {
  // user.deleteMany needs every required userId FK cleared first (leftovers from prior suites/runs)
  await prisma.$transaction([
    prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(), prisma.subscription.deleteMany(),
    prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(), prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(), prisma.user.deleteMany(),
  ]);
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

  test('GA self role change → admin-role guard 403 (mock order: guards before self-role)', async () => {
    await expect(users.update('ga1', { nik: 'GA1', name: 'GA', department: '', phone: '', role: 'SUPER_ADMIN', vendorId: null }, actorGa))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: 'Hanya Super Admin yang boleh mengelola akun admin.' });
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
    // mock ImportPreview parity: created/updated are ImportRow arrays, errors are {row,message} (no nik)
    expect(p.created.map((r) => r.nik)).toEqual(['123']); // numeric 123 coerced to "123"
    expect(p.updated.map((r) => r.nik).sort()).toEqual(['K102', 'K200']); // K102 exists from the create test
    expect(p.errors.some((e) => e.row === 4 && /K201/.test(e.message) && /non-karyawan/.test(e.message))).toBe(true);
    expect(p.errors.some((e) => e.row === 6 && /K102/.test(e.message) && /ganda/.test(e.message))).toBe(true);
  });

  test('commit: one tx, updates+creates, returns passwords array (TempPassword[])', async () => {
    const rows = [
      { nik: '123', name: 'Num', department: 'QC', phone: '' },
      { nik: 'K200', name: 'Updated2', department: 'Gudang', phone: '0812' },
    ];
    const r = await users.importCommit(rows, actorSuper);
    const made = r.passwords.find((x) => x.nik === '123');
    expect(made).toMatchObject({
      userId: expect.any(String),
      nik: '123',
      tempPassword: expect.stringMatching(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/),
    });
    const k200 = await prisma.user.findUnique({ where: { nik: 'K200' } });
    expect(k200!.name).toBe('Updated2');
  });

  // I6: argon2 runs before the interactive tx — 200 new rows must not hit the 5s tx timeout
  test('commit 200 new rows within the default interactive-tx timeout; hash verifies', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ nik: `BULK${i}`, name: `Bulk ${i}`, department: 'QC', phone: '' }));
    const r = await users.importCommit(rows, actorSuper);
    expect(r.passwords).toHaveLength(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { nik: 'BULK7' } });
    const pw = r.passwords.find((x) => x.nik === 'BULK7')!.tempPassword;
    expect(await argon2.verify(u.passwordHash!, pw)).toBe(true);
  }, 120_000);
});
