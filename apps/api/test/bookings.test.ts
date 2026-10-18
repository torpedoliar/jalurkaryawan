// apps/api/test/bookings.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { AllocateService } from '../src/bookings/allocate.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { addDays, departureAt, jakartaDate } from '@bms/shared';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let allocate: AllocateService;
let bookings: BookingsService;
let tripId: string;
let routeId: string;
let stopId: string;
let userId: string;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.auditLog.deleteMany(),
  ]);
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  allocate = new AllocateService(prisma, settings);
  bookings = new BookingsService(prisma, allocate, settings);

  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 3, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  const stop = await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const user = await prisma.user.create({ data: { nik: 'K1001', name: 'Emp', role: 'EMPLOYEE', active: true } });
  const date = addDays(jakartaDate(new Date()), 1); // tomorrow, safely past any same-day cutoff
  const tpl = await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  const trip = await prisma.trip.create({
    data: { templateId: tpl.id, date, departureAt: departureAt(date, '05:20', 0), status: 'SCHEDULED', bookedCount: 0, capacity: 3, routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id },
  });
  routeId = route.id; stopId = stop.id; userId = user.id; tripId = trip.id;
});

// cross-suite hygiene: auth.test (runs first next run) must not trip Booking_userId_fkey
afterAll(async () => {
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.user.deleteMany(), prisma.auditLog.deleteMany(),
  ]);
  await prisma.$disconnect();
});

const baseParams = () => ({ userId, routeId, stopId, shiftId: 'pagi', direction: 'PICKUP' as const, date: addDays(jakartaDate(new Date()), 1), source: 'DAILY' as const });

describe('allocateSeat (spec §5.1)', () => {
  test('success increments booked_count and creates BOOKED booking', async () => {
    const r = await allocate.allocateSeat(baseParams());
    expect(r).toBeTruthy();
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.bookedCount).toBe(1);
  });

  test('SCHEDULE_CONFLICT on second booking same user/date/shift/direction', async () => {
    await expect(allocate.allocateSeat(baseParams())).rejects.toMatchObject({
      code: 'SCHEDULE_CONFLICT', message: 'Kamu sudah punya booking di tanggal, shift, dan arah yang sama.',
    });
  });

  test('invalid stop → "Titik jemput tidak valid untuk rute ini."', async () => {
    const otherUser = await prisma.user.create({ data: { nik: 'K1002', name: 'X', role: 'EMPLOYEE', active: true } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: otherUser.id, stopId: 'nonexistent' }))
      .rejects.toThrow('Titik jemput tidak valid untuk rute ini.');
  });

  test('inactive user → FORBIDDEN', async () => {
    const inactive = await prisma.user.create({ data: { nik: 'K1003', name: 'Y', role: 'EMPLOYEE', active: false } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: inactive.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('suspended user → USER_SUSPENDED', async () => {
    const sus = await prisma.user.create({
      data: { nik: 'K1004', name: 'Z', role: 'EMPLOYEE', active: true, bookingSuspendedUntil: new Date(Date.now() + 86_400_000) },
    });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: sus.id }))
      .rejects.toMatchObject({ code: 'USER_SUSPENDED', message: 'Booking kamu sedang dibekukan oleh admin.' });
  });

  test('CUTOFF_PASSED when all trips past cutoff (no rejected row)', async () => {
    // set the only trip's departureAt to the past
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() - 3600_000), bookedCount: 0 } });
    const u = await prisma.user.create({ data: { nik: 'K1005', name: 'W', role: 'EMPLOYEE', active: true } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: u.id }))
      .rejects.toMatchObject({ code: 'CUTOFF_PASSED', message: 'Batas waktu booking atau pembatalan sudah lewat.' });
    // NO rejected row for CUTOFF_PASSED
    expect(await prisma.rejectedRequest.count({ where: { userId: u.id } })).toBe(0);
    // restore future trip (and the seat taken by the first success test)
    const date = baseParams().date;
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: departureAt(date, '05:20', 0), bookedCount: 1 } });
  });

  test('TRIP_FULL when capacity exhausted: rejected row inserted, thrown outside tx (booked_count stays at capacity)', async () => {
    // fill to capacity (1 booked so far, capacity 3 → book 2 more with different users)
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({ data: { nik: `FILL${i}`, name: `F${i}`, role: 'EMPLOYEE', active: true } });
      await allocate.allocateSeat({ ...baseParams(), userId: u.id });
    }
    const u = await prisma.user.create({ data: { nik: 'K1006', name: 'Full', role: 'EMPLOYEE', active: true } });
    await expect(allocate.allocateSeat({ ...baseParams(), userId: u.id }))
      .rejects.toMatchObject({ code: 'TRIP_FULL', message: 'Semua bus untuk rute, shift, dan arah ini sudah penuh.' });
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    expect(trip!.bookedCount).toBe(3); // unchanged by the failed attempt
    const rejected = await prisma.rejectedRequest.findFirst({ where: { userId: u.id } });
    expect(rejected).toBeTruthy();
    expect(rejected!.reason).toBe('TRIP_FULL');
  });
});

describe('cancelBooking', () => {
  test('cancels BOOKED, decrements booked_count, sets USER reason', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'FILL0' } });
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: u.id, status: 'BOOKED' } });
    const before = (await prisma.trip.findUnique({ where: { id: tripId } }))!.bookedCount;
    const r = await bookings.cancelBooking(b.id, u.id);
    expect(r.status).toBe('CANCELLED');
    const after = (await prisma.trip.findUnique({ where: { id: tripId } }))!.bookedCount;
    expect(after).toBe(before - 1);
  });

  test('cancel someone else’s booking → NOT_FOUND', async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { nik: 'FILL1' } });
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: owner.id, status: 'BOOKED' } });
    const other = await prisma.user.findFirstOrThrow({ where: { nik: 'K1001' } });
    await expect(bookings.cancelBooking(b.id, other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('cancel already-CANCELLED → "Booking sudah tidak aktif."', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'FILL0' } });
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: u.id, status: 'CANCELLED' } });
    await expect(bookings.cancelBooking(b.id, u.id)).rejects.toThrow('Booking sudah tidak aktif.');
  });
});
