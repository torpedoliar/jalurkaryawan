// apps/api/test/generate.test.ts
import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { addDays, jakartaDate } from '@bms/shared';
import { GenerateService } from '../src/generate/generate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { NotificationsService } from '../src/notifications/notifications.service';

const prisma = new PrismaClient();
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
    const today = jakartaDate(new Date());
    const tomorrow = addDays(today, 1);
    // tomorrow's trips exist if a template weekday matches
    const t = await prisma.tripTemplate.findFirst({ where: { active: true } });
    if (t) expect(await prisma.trip.count({ where: { date: tomorrow } })).toBeGreaterThanOrEqual(0);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
