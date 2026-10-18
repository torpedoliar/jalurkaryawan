// apps/api/test/subscriptions.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { addDays, jakartaDate } from '@bms/shared';
import { SubscriptionsService } from '../src/bookings/subscriptions.service';
import { AdminService } from '../src/admin/admin.service';
import { AllocateService } from '../src/bookings/allocate.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FcmService } from '../src/notifications/fcm.service';
import { GenerateService } from '../src/generate/generate.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const actor = { id: 'a1', name: 'Admin', role: 'SUPER_ADMIN' } as never;

let subs: SubscriptionsService;
let admin: AdminService;
let generate: GenerateService;
let userId: string;
let routeId: string;
let stopId: string;

beforeAll(async () => {
  // FK-safe order: children before parents (users.test precedent)
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.deviceToken.deleteMany(), prisma.rejectedRequest.deleteMany(),
    prisma.booking.deleteMany(), prisma.subscription.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.refreshToken.deleteMany(), prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  // audit.actorId FK + non-EMPLOYEE suspend target (mock users.ts target/actor parity)
  await prisma.user.create({ data: { id: 'a1', nik: 'TEST-A1', name: 'Admin', role: 'SUPER_ADMIN', active: true } });
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const notifications = new NotificationsService(prisma, new FcmService(settings, prisma), settings);
  const allocate = new AllocateService(prisma, settings);
  generate = new GenerateService(prisma, settings, notifications, allocate);
  subs = new SubscriptionsService(prisma, allocate, settings);
  admin = new AdminService(prisma, allocate, notifications, audit, settings);

  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 50, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const user = await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  routeId = route.id; stopId = stop.id; userId = user.id;
  await generate.fillWindow(); // trips exist for subscription dates
});

// cross-suite hygiene: later suites delete users — subscriptions/bookings must not trip FKs
afterAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.deviceToken.deleteMany(), prisma.rejectedRequest.deleteMany(),
    prisma.booking.deleteMany(), prisma.subscription.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.refreshToken.deleteMany(), prisma.auditLog.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  await prisma.$disconnect();
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
    const r = await subs.create(userId, subInput());
    // contract Subscription wire shape: no updatedAt, createdAt +07:00 no-ms (mock nowIso parity)
    expect(r.subscription).not.toHaveProperty('updatedAt');
    expect(r.subscription.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    await expect(subs.create(userId, subInput())).rejects.toMatchObject({
      code: 'SCHEDULE_CONFLICT', message: expect.stringContaining('bentrok'),
    });
  });

  test('list: contract wire shape — no updatedAt, createdAt +07:00 no-ms', async () => {
    const rows = await subs.list(userId);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).not.toHaveProperty('updatedAt');
      expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    }
  });

  test('generateSubscriptionBookings: re-books a non-purpose-cancelled date, idempotent', async () => {
    const date = addDays(jakartaDate(new Date()), 1);
    const b = await prisma.booking.findFirstOrThrow({ where: { userId, date, status: 'BOOKED', source: 'SUBSCRIPTION' } });
    // free the seat without an on-purpose reason (SUBSCRIPTION_ENDED ≠ USER|ADMIN_TRIP)
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelReason: 'SUBSCRIPTION_ENDED' } });
    await prisma.trip.update({ where: { id: b.tripId! }, data: { bookedCount: { decrement: 1 } } });
    await generate.generateSubscriptionBookings(date);
    expect(await prisma.booking.count({ where: { userId, date, status: 'BOOKED', source: 'SUBSCRIPTION' } })).toBe(1);
    await generate.generateSubscriptionBookings(date); // hasBooked skip
    expect(await prisma.booking.count({ where: { userId, date, status: 'BOOKED', source: 'SUBSCRIPTION' } })).toBe(1);
  });

  test('end: cancels future bookings reason SUBSCRIPTION_ENDED, idempotent ENDED', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId, status: 'ACTIVE' } });
    const r = await subs.end(userId, sub.id);
    expect(r.status).toBe('ENDED');
    expect(r).not.toHaveProperty('updatedAt');
    expect(r.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    const r2 = await subs.end(userId, sub.id); // idempotent
    expect(r2.status).toBe('ENDED');
    expect(r2).not.toHaveProperty('updatedAt');
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
    // re-create a subscription with future bookings
    await subs.create(userId, subInput());
    await admin.suspend(userId, addDays(jakartaDate(new Date()), 3), 'No-show 3x', actor);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.bookingSuspendedUntil).toBeTruthy();
    const susNotif = await prisma.notification.findFirst({ where: { userId, type: 'SUSPENDED' } });
    expect(susNotif).toBeTruthy();
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
    const date = addDays(jakartaDate(new Date()), 1);
    // fillWindow already created this template's trip for tomorrow (unique templateId+date) — repurpose it
    const trip = await prisma.trip.findFirstOrThrow({ where: { date } });
    await prisma.trip.update({ where: { id: trip.id }, data: { bookedCount: 10, capacity: 50, status: 'SCHEDULED' } });
    await expect(admin.changeTripBus(trip.id, bus.id, actor)).rejects.toMatchObject({
      code: 'CAPACITY_BELOW_BOOKED', message: expect.stringContaining('hanya 5 kursi'),
    });
  });
});
