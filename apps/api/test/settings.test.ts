// apps/api/test/settings.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SECRET_SETTING_KEYS } from '@bms/shared';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
import { scryptSync } from 'node:crypto';
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let svc: SettingsService;
let audit: AuditService;

beforeAll(async () => {
  await prisma.setting.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.upsert({
    where: { id: 'a' },
    create: { id: 'a', nik: 'TEST-A', name: 'Admin', role: 'SUPER_ADMIN' },
    update: {},
  });
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

  test('out-of-range update rejected with shared schema message', async () => {
    await expect(svc.update({ booking_cutoff_minutes: 9999 } as never, { id: 'a', name: 'A' })).rejects.toThrow(/1440/);
    expect(svc.get().booking_cutoff_minutes).toBe(120);
  });

  test('valid update applies live, emits onChanged, writes audit', async () => {
    let fired = 0;
    svc.onChanged.on('changed', () => fired++);
    const view = await svc.update({ booking_cutoff_minutes: 90 }, { id: 'a', name: 'Admin' });
    expect(svc.get().booking_cutoff_minutes).toBe(90);
    expect(fired).toBe(1);
    expect(view.booking_cutoff_minutes).toBe(90);
    const log = await prisma.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(log).toBeTruthy();
    // F3 / spec §4.1: updatedBy persisted per key; internal only (SettingsView has no such field)
    const row = await prisma.setting.findUnique({ where: { key: 'booking_cutoff_minutes' } });
    expect(row!.updatedBy).toBe('a');
    expect(JSON.stringify(view)).not.toContain('updatedBy');
  });

  test('secret stored ciphertext, read decrypted, view isSet only, audit masked', async () => {
    await svc.update({ fcm_service_account: '{"type":"service_account","project_id":"p","private_key":"k","client_email":"a@b.c"}' }, { id: 'a', name: 'Admin' });
    const row = await prisma.setting.findUnique({ where: { key: 'fcm_service_account' } });
    expect(String(row!.value)).not.toContain('service_account'); // ciphertext in DB
    expect(svc.get().fcm_service_account).toContain('service_account'); // decrypted in cache
    const view = svc.toView();
    expect(view.fcm_service_account.isSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('a@b.c'); // secret value never leaks
    const log = await prisma.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const after = log!.after as Record<string, unknown>;
    expect(after.fcm_service_account).toBe('***'); // literal mask — not isSet, not ciphertext
    expect(JSON.stringify(log!.after)).not.toContain('isSet');
    expect(JSON.stringify(log!.after)).not.toContain('a@b.c');
    // second update: previous value was set → before masks as '***' too, new plaintext never stored
    await svc.update({ fcm_service_account: '{"type":"service_account","project_id":"p2","private_key":"k2","client_email":"new@b.c"}' }, { id: 'a', name: 'Admin' });
    const log2 = await prisma.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATE' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const b2 = log2!.before as Record<string, unknown>;
    const a2 = log2!.after as Record<string, unknown>;
    expect(b2.fcm_service_account).toBe('***');
    expect(a2.fcm_service_account).toBe('***');
    expect(JSON.stringify(log2)).not.toContain('new@b.c');
  });

  test('SECRET_SETTING_KEYS matches shared export', () => {
    expect(SECRET_SETTING_KEYS).toEqual(['fcm_service_account', 'backup_share_password']);
  });
});
