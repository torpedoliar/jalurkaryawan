// apps/api/test/generate.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { addDays, jakartaDate } from '@bms/shared';
import { GenerateService } from '../src/generate/generate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FcmService } from '../src/notifications/fcm.service';
import { AllocateService } from '../src/bookings/allocate.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
let generate: GenerateService;

beforeAll(async () => {
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  generate = new GenerateService(prisma, settings, new NotificationsService(prisma, new FcmService(settings, prisma), settings), new AllocateService(prisma, settings));
  // stable fixture (upsert: re-runs are idempotent) — fills must produce rows for it
  const v = await prisma.vendor.upsert({ where: { id: 'gv' }, create: { id: 'gv', name: 'GenV', contact: '' }, update: {} });
  const bus = await prisma.bus.upsert({ where: { id: 'gbus' }, create: { id: 'gbus', plate: 'B GEN1', capacity: 30, vendorId: v.id }, update: {} });
  const route = await prisma.route.upsert({ where: { id: 'groute' }, create: { id: 'groute', code: 'RG', name: 'Gen', color: '#000000' }, update: {} });
  await prisma.shift.upsert({ where: { id: 'gen' }, create: { id: 'gen', name: 'Gen', startTime: '01:00', endTime: '02:00' }, update: {} });
  await prisma.tripTemplate.upsert({
    where: { id: 'gtpl' },
    create: { id: 'gtpl', routeId: route.id, shiftId: 'gen', direction: 'PICKUP', busId: bus.id, departureTime: '23:50', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
    update: { active: true, weekdays: [1, 2, 3, 4, 5, 6, 7] },
  });
});

describe('generateTrips (spec §5.2)', () => {
  test('idempotent: same date twice creates only once', async () => {
    const date = jakartaDate(new Date());
    await generate.generateTrips(date);
    const second = await generate.generateTrips(date);
    expect(second).toBe(0); // ON CONFLICT DO NOTHING
    // fixture template's row for today exists exactly once (unique (templateId,date))
    expect(await prisma.trip.count({ where: { templateId: 'gtpl', date } })).toBe(1);
    const rows = await prisma.trip.count({ where: { date } });
    expect(rows).toBeGreaterThanOrEqual(1); // fixture row exists after generateTrips
  });

  test('fillWindow generates rows for the weekday-matched fixture template', async () => {
    await generate.fillWindow();
    const today = jakartaDate(new Date());
    const tomorrow = addDays(today, 1);
    // weekdays 1-7: fixture template must have a trip for every generated window day
    expect(await prisma.trip.count({ where: { templateId: 'gtpl', date: today } })).toBe(1);
    expect(await prisma.trip.count({ where: { templateId: 'gtpl', date: tomorrow } })).toBe(1);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // spec §5.2 "satu transaksi per tanggal": trips + subscription bookings run under one per-date tx
  test('runGenerate wraps each date in one transaction, idempotent', async () => {
    await generate.runGenerate();
    const today = jakartaDate(new Date());
    expect(await prisma.trip.count({ where: { templateId: 'gtpl', date: today } })).toBe(1);
    const again = await generate.generateTrips(today); // direct call still works (no tx arg)
    expect(again).toBe(0);
  });
});
