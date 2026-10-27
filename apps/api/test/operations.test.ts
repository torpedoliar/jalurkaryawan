import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { jakartaDate } from '@bms/shared';
import { OperationsService } from '../src/operations/operations.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { TripsService } from '../src/trips/trips.service';

const db = new PrismaClient();
const ops = new OperationsService(db);
const prefix = 'ops-test-';
const admin = { id: `${prefix}admin`, name: 'Admin', role: 'SUPER_ADMIN' };
const driver = { id: `${prefix}driver`, name: 'Sopir', role: 'DRIVER' };
const employee = { id: `${prefix}employee`, name: 'Karyawan', role: 'EMPLOYEE' };
const tripId = `${prefix}trip`, bookingId = `${prefix}booking`, busId = `${prefix}bus`;

async function cleanup() {
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.booking.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.trip.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.tripTemplate.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.stop.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.route.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.bus.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.vendor.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.shift.deleteMany({ where: { id: { startsWith: prefix } } });
}
beforeAll(async () => {
  await cleanup();
  await db.vendor.create({ data: { id: `${prefix}vendor`, name: 'Vendor' } });
  await db.user.createMany({ data: [
    { ...admin, nik: admin.id },
    { ...driver, nik: driver.id, vendorId: `${prefix}vendor` },
    { ...employee, nik: employee.id },
  ].map(({ id, name, role, nik, ...rest }) => ({ id, name, role, nik, ...rest })) });
  await db.bus.create({ data: { id: busId, vendorId: `${prefix}vendor`, plate: 'OPS TEST BUS', capacity: 10 } });
  await db.route.create({ data: { id: `${prefix}route`, code: 'OPS-TEST', name: 'Test', color: '#123456' } });
  await db.stop.create({ data: { id: `${prefix}stop`, routeId: `${prefix}route`, name: 'Halte', seq: 1, offsetMinutes: 0 } });
  await db.shift.create({ data: { id: `${prefix}shift`, name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  await db.tripTemplate.create({ data: { id: `${prefix}template`, routeId: `${prefix}route`, shiftId: `${prefix}shift`, busId, direction: 'PICKUP', departureTime: '07:00', weekdays: [1,2,3,4,5,6,7], dayOffset: 0 } });
  await db.trip.create({ data: { id: tripId, templateId: `${prefix}template`, routeId: `${prefix}route`, shiftId: `${prefix}shift`, busId, direction: 'PICKUP', date: jakartaDate(new Date()), departureAt: new Date(), capacity: 10, bookedCount: 1 } });
  await db.booking.create({ data: { id: bookingId, userId: employee.id, tripId, routeId: `${prefix}route`, stopId: `${prefix}stop`, shiftId: `${prefix}shift`, direction: 'PICKUP', date: jakartaDate(new Date()), source: 'DAILY' } });
});
afterAll(async () => { await cleanup(); await db.$disconnect(); });

describe('operations with PostgreSQL', () => {
  test('opaque QR is stable, encrypted at rest, owner scoped and rotatable', async () => {
    const first = await ops.ticket(bookingId, employee);
    expect(first.qr).toMatch(/^BMS-T1:/);
    expect(first.qr).not.toContain(bookingId);
    expect((await ops.ticket(bookingId, employee)).qr).toBe(first.qr);
    const stored = await db.ticketCredential.findUniqueOrThrow({ where: { bookingId } });
    expect(stored.ciphertext).not.toContain(first.qr);
    expect(stored.secretHash).not.toContain(first.qr);
    await expect(ops.ticket(bookingId, driver)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const old = await ops.busQr(busId, admin);
    expect((await ops.busQr(busId, admin)).qr).toBe(old.qr);
    expect((await ops.busQr(busId, admin, true)).qr).not.toBe(old.qr);
    await expect(ops.checkin(bookingId, old.qr, employee, 'EMPLOYEE_BUS_QR')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  test('wrong-vendor assignment and out-of-window check-in are rejected', async () => {
    await expect(ops.assign(tripId, { driverId: employee.id }, admin)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await db.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() + 3 * 60 * 60_000) } });
    const bus = await ops.busQr(busId, admin);
    await expect(ops.checkin(bookingId, bus.qr, employee, 'EMPLOYEE_BUS_QR')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await db.attendance.count({ where: { bookingId } })).toBe(0);
    await db.trip.update({ where: { id: tripId }, data: { departureAt: new Date() } });
  });
  test('concurrent driver and employee scans produce exactly one attendance', async () => {
    await ops.assign(tripId, { driverId: driver.id }, admin);
    const ticket = await ops.ticket(bookingId, employee), bus = await ops.busQr(busId, admin);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => i % 2
      ? ops.checkin(tripId, ticket.qr, driver, 'DRIVER_SCANNER', true)
      : ops.checkin(bookingId, bus.qr, employee, 'EMPLOYEE_BUS_QR')));
    expect(results.filter((r) => !r.alreadyCheckedIn)).toHaveLength(1);
    expect(new Set(results.map((r) => r.attendance.checkedInAt)).size).toBe(1);
    expect(await db.attendance.count({ where: { bookingId } })).toBe(1);
    expect((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).bookedCount).toBe(1);
    expect((await ops.manifest(tripId, driver))[0]!.checkedIn).toBe(true);
    const bookings = new BookingsService(db, {} as never, { get: () => ({ booking_cutoff_minutes: -10 }) } as never);
    await expect(bookings.cancelBooking(bookingId, employee.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('BOOKED');
  });
  test('driver authorization, GPS lifecycle, deduplication and owned reads', async () => {
    await expect(ops.manifest(tripId, employee)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const sample = { sampleId: 'device-sample1', lat: -6.3, lng: 107.1, accuracy: 8, speed: null, heading: null, capturedAt: new Date().toISOString() };
    await expect(ops.locations(tripId, { samples: [sample] }, driver)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await Promise.all([ops.lifecycle(tripId, driver, false), ops.checkin(tripId, (await ops.ticket(bookingId, employee)).qr, driver, 'DRIVER_SCANNER', true)]);
    expect(await ops.locations(tripId, { samples: [sample, sample] }, driver)).toEqual({ accepted: 1, duplicates: 1 });
    expect((await ops.myPosition(bookingId, employee))!.position?.lat).toBe(-6.3);
    expect((await ops.tracking(undefined, tripId))[0]!.execution).toBe('IN_PROGRESS');
    // With no attendance, a started trip still must not be cancellable or strand the driver slot.
    await db.attendance.deleteMany({ where: { tripId } });
    await db.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() + 30 * 60_000) } });
    const trips = new TripsService(db, {} as never, {} as never);
    await expect(trips.tripCancel(tripId, admin)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await db.tripOperation.findUniqueOrThrow({ where: { tripId } })).status).toBe('IN_PROGRESS');
    await expect(ops.assign(tripId, { driverId: null }, admin)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await ops.lifecycle(tripId, driver, true);
    await expect(ops.locations(tripId, { samples: [sample] }, driver)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
