// apps/api/test/concurrency.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { AllocateService } from '../src/bookings/allocate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { addDays, departureAt, jakartaDate } from '@bms/shared';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let allocate: AllocateService;

beforeAll(async () => {
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  allocate = new AllocateService(prisma, settings);
});

// cross-suite hygiene: don't leave 100 users + bookings for the next file
afterAll(async () => {
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(), // seeded/live rows hold user+stop FKs
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.subscription.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.auditLog.deleteMany(),
  ]);
  await prisma.$disconnect();
});

describe('concurrent allocation (spec §8: 100 concurrent → 50 OK / 50 TRIP_FULL)', () => {
  test('exactly capacity succeed, rest TRIP_FULL with rejected rows, booked_count == capacity', async () => {
    // clean fixture
    await prisma.$transaction([
    prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(), prisma.notification.deleteMany(), // seeded/live rows hold user+stop FKs
      prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(),
      prisma.tripTemplate.deleteMany(), prisma.subscription.deleteMany(), prisma.stop.deleteMany(), prisma.route.deleteMany(),
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
        allocate.allocateSeat({ userId: u.id, routeId: route.id, stopId: stop.id, shiftId: 'pagi', direction: 'PICKUP', date, source: 'DAILY' })),
    );

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const full = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'TRIP_FULL').length;
    const other = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code !== 'TRIP_FULL').length;

    expect(ok).toBe(50);
    expect(full).toBe(50);
    expect(other).toBe(0);

    const t = await prisma.trip.findUnique({ where: { id: trip.id } });
    expect(t!.bookedCount).toBe(50);
    expect(t!.bookedCount).toBeLessThanOrEqual(t!.capacity);
    expect(t!.bookedCount).toBeGreaterThanOrEqual(0);

    const rejected = await prisma.rejectedRequest.count({ where: { date, reason: 'TRIP_FULL' } });
    expect(rejected).toBe(50);
  }, 60_000);
});
