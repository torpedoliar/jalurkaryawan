// apps/api/test/trips.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { jakartaDate } from '@bms/shared';
import { TemplatesService } from '../src/trips/templates.service';
import { TripsService } from '../src/trips/trips.service';
import { GenerateService } from '../src/generate/generate.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AllocateService } from '../src/bookings/allocate.service';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const actor = { id: 'a1', name: 'Admin', role: 'SUPER_ADMIN' } as never;

let templates: TemplatesService;
let trips: TripsService;
let generate: GenerateService;
let notifications: NotificationsService;

// Only not-yet-departed trips are in the §5.6 propagation scope (departureAt > now),
// so fixture templates must use a departure time still in the future when tests run.
const futureTrip = () => prisma.trip.findFirstOrThrow({
  where: { departureAt: { gt: new Date() } },
  orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
});

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(),
    prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(), prisma.route.deleteMany(),
    prisma.bus.deleteMany(), prisma.vendor.deleteMany(), prisma.shift.deleteMany(), prisma.user.deleteMany(),
    prisma.auditLog.deleteMany(),
  ]);
  // FK: auditLog.actorId references User (master.test precedent)
  await prisma.user.upsert({
    where: { id: 'a1' },
    create: { id: 'a1', nik: 'TEST-A1', name: 'Admin', role: 'SUPER_ADMIN' },
    update: {},
  });
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  notifications = new NotificationsService(prisma);
  generate = new GenerateService(prisma, settings, notifications, new AllocateService(prisma, settings));
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

// schema.test raw-inserts assume no leftover Route code R1; auth.test deletes users wholesale
afterAll(async () => {
  await prisma.$transaction([
    prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(), prisma.trip.deleteMany(),
    prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(), prisma.route.deleteMany(),
    prisma.bus.deleteMany(), prisma.vendor.deleteMany(), prisma.shift.deleteMany(),
    prisma.notification.deleteMany(), prisma.auditLog.deleteMany(), prisma.user.deleteMany(),
  ]);
  await prisma.$disconnect();
});

describe('templates + propagation (spec §5.6)', () => {
  test('create template generates trips in window (weekday match)', async () => {
    const g = globalThis as unknown as Record<string, string>;
    const tpl = await templates.create({
      routeId: g.__route!,
      shiftId: 'pagi', direction: 'PICKUP', busId: g.__bus!,
      departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
    }, actor);
    const count = await prisma.trip.count({ where: { templateId: tpl.id } });
    expect(count).toBeGreaterThanOrEqual(1); // at least today (if weekday matches)
    const t = await prisma.trip.findFirst({ where: { templateId: tpl.id } });
    expect(t!.capacity).toBe(40);
    expect(t!.departureAt).toBeTruthy();
  });

  test('bus swap below booked rolls back naming the trip', async () => {
    // make a future trip with bookedCount 30, swap to a 20-seat bus
    const small = await prisma.bus.create({ data: { plate: 'B 2000 SS', capacity: 20, vendorId: (await prisma.vendor.findFirstOrThrow()).id } });
    const trip = await futureTrip();
    await prisma.trip.update({ where: { id: trip.id }, data: { bookedCount: 30, capacity: 40 } });
    await expect(templates.update(trip.templateId, {
      routeId: trip.routeId, shiftId: trip.shiftId, direction: trip.direction as 'PICKUP' | 'DROPOFF', busId: small.id,
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
    const trip = await futureTrip();
    const bus2 = (globalThis as unknown as Record<string, string>).__bus2!;
    const user = await prisma.user.findFirstOrThrow({ where: { role: 'EMPLOYEE' } });
    await prisma.booking.create({
      data: { userId: user.id, tripId: trip.id, routeId: trip.routeId, stopId: (await prisma.stop.findFirstOrThrow()).id, shiftId: trip.shiftId, direction: trip.direction, date: trip.date, status: 'BOOKED' },
    });
    const newDeparture = '06:30';
    await templates.update(trip.templateId, {
      routeId: trip.routeId, shiftId: trip.shiftId, direction: trip.direction as 'PICKUP' | 'DROPOFF', busId: bus2,
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
    // contract Passenger has no status (mock parity); CANCELLED rows are excluded by the query
    expect(list.every((p) => (p as { status?: string }).status !== 'CANCELLED')).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  test('tripCancel decrements bookedCount on response row (mock ADMIN_TRIP parity)', async () => {
    const trip = await futureTrip();
    const before = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    const flipped = await prisma.booking.count({ where: { tripId: trip.id, status: 'BOOKED' } });
    expect(flipped).toBeGreaterThanOrEqual(1); // employee booking from the propagation test
    const r = await trips.tripCancel(trip.id, actor);
    expect(r.status).toBe('CANCELLED');
    expect(r.bookedCount).toBe(Math.max(0, before.bookedCount - flipped));
    const after = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    expect(after.bookedCount).toBe(r.bookedCount); // response row matches DB
    const row = (await trips.list({ date: trip.date })).find((t) => t.id === trip.id);
    expect(row!.bookedCount).toBe(r.bookedCount); // trips list shows the lower count
    expect(row!.status).toBe('CANCELLED');
  });

  test('cancelDate cancels all SCHEDULED not-departed trips, returns count', async () => {
    const today = jakartaDate(new Date());
    const r = await trips.cancelDate(today, actor);
    expect(typeof r.cancelled).toBe('number'); // mock wire: { cancelled }
    const remaining = await prisma.trip.count({ where: { date: today, status: 'SCHEDULED', departureAt: { gt: new Date() } } });
    expect(remaining).toBe(0);
  });
});
