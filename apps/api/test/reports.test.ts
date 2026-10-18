// apps/api/test/reports.test.ts — Task 10: availability + dashboard/occupancy/rejected/no-show + notifications list/read
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { jakartaDate, addDays, departureAt } from '@bms/shared';
import { AppModule } from '../src/app.module';
import { TripsService } from '../src/trips/trips.service';
import { ReportsService } from '../src/reports/reports.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';

const prisma = new PrismaClient();
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let tripsSvc: TripsService;
let reports: ReportsService;
let notifications: NotificationsService;
let routeId: string;
let tripId: string;
const date = addDays(jakartaDate(new Date()), 1);

const wipe = () =>
  prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.subscription.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(), prisma.stop.deleteMany(),
    prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(),
    prisma.user.deleteMany(), prisma.auditLog.deleteMany(),
  ]);

beforeAll(async () => {
  await wipe();
  const audit = new AuditService(prisma);
  const settings = new SettingsService(prisma, audit, key);
  await settings.init();
  notifications = new NotificationsService(prisma);
  tripsSvc = new TripsService(prisma, settings, notifications, audit);
  reports = new ReportsService(prisma, settings);

  const v = await prisma.vendor.create({ data: { name: 'V', contact: '' } });
  const bus = await prisma.bus.create({ data: { plate: 'B 1001 AA', capacity: 50, vendorId: v.id } });
  const route = await prisma.route.create({ data: { code: 'R1', name: 'Cikarang', color: '#D6322B' } });
  await prisma.shift.create({ data: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' } });
  await prisma.stop.create({ data: { routeId: route.id, name: 'Terminal', seq: 1, offsetMinutes: 0 } });
  const tpl = await prisma.tripTemplate.create({
    data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:20', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
  });
  const trip = await prisma.trip.create({
    data: { templateId: tpl.id, date, departureAt: departureAt(date, '05:20', 0), status: 'SCHEDULED', bookedCount: 20, capacity: 50, routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id },
  });
  routeId = route.id; tripId = trip.id;
});

// schema.test raw-inserts assume no leftover Route code R1 (trips.test precedent)
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('availability', () => {
  test('sums capacity/bookedCount, computes firstDepartureAt, cutoffAt, bookable', async () => {
    const a = await tripsSvc.availability(routeId, 'pagi', 'PICKUP', date);
    expect(a.capacity).toBe(50);
    expect(a.bookedCount).toBe(20);
    expect(a.firstDepartureAt).toBeTruthy();
    expect(a.cutoffAt).toBeTruthy();
    expect(a.bookable).toBe(true);
  });

  test('past-departure trip → bookable false', async () => {
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: new Date(Date.now() - 3600_000) } });
    const a = await tripsSvc.availability(routeId, 'pagi', 'PICKUP', date);
    expect(a.bookable).toBe(false);
    // restore
    await prisma.trip.update({ where: { id: tripId }, data: { departureAt: departureAt(date, '05:20', 0) } });
  });
});

describe('dashboard', () => {
  test('SCHEDULED aggregates + backupWarning null for non-super viewer', async () => {
    const v = await prisma.user.create({ data: { nik: 'GA1', name: 'GA', role: 'ADMIN_GA', active: true } });
    const d = await reports.dashboard(v, date);
    expect(d.date).toBe(date);
    expect(d.trips).toBe(1);
    expect(d.capacity).toBe(50);
    expect(d.booked).toBe(20);
    expect(d.fullTrips).toBe(0);
    expect(d.rejectedToday).toBe(0);
    expect(d.rejectedLast7).toHaveLength(7);
    expect(d.backupWarning).toBeNull();
  });

  test('backupWarning "Belum ada backup." for SUPER_ADMIN when no bms- files', async () => {
    const v = await prisma.user.create({ data: { nik: 'SUPER', name: 'S', role: 'SUPER_ADMIN', active: true } });
    const d = await reports.dashboard(v, date);
    expect(d.backupWarning).toBe('Belum ada backup.');
  });
});

describe('occupancy', () => {
  test('groups by date|routeId|shiftId|direction with route/shift names', async () => {
    const rows = await reports.occupancy(date, date);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      date, routeCode: 'R1', routeName: 'Cikarang', routeColor: '#D6322B',
      shiftId: 'pagi', shiftName: 'Pagi', direction: 'PICKUP',
      trips: 1, booked: 20, capacity: 50, rejected: 0,
    });
  });
});

describe('rejected report', () => {
  test('range filter, strips db-only fields, createdAt Jakarta ISO', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'GA1' } });
    await prisma.rejectedRequest.create({
      data: { userId: u.id, tripId, routeId, shiftId: 'pagi', direction: 'PICKUP', date, reason: 'TRIP_FULL', source: 'DAILY' },
    });
    const rows = await reports.rejected(date, date);
    expect(rows.length).toBe(1);
    expect(rows[0]).not.toHaveProperty('tripId');
    expect(rows[0]).not.toHaveProperty('stopId');
    expect(rows[0]).not.toHaveProperty('reason');
    expect(rows[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });
});

describe('no-show candidates', () => {
  test('returns passengers with NO_SHOW in last 30 days, noShows30d desc', async () => {
    const u = await prisma.user.create({ data: { nik: 'NS1', name: 'NS', role: 'EMPLOYEE', active: true } });
    await prisma.booking.create({
      data: { userId: u.id, tripId, routeId, stopId: (await prisma.stop.findFirstOrThrow()).id, shiftId: 'pagi', direction: 'PICKUP', date, status: 'NO_SHOW', cancelReason: null, source: 'DAILY' },
    });
    const rows = await reports.noShowCandidates();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].nik).toBe('NS1');
    expect(rows[0].noShows30d).toBe(1);
  });
});

describe('notifications list/read', () => {
  test('list strips userId + ISO createdAt; read marks own, NOT_FOUND for foreign', async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { nik: 'NS1' } });
    await notifications.insert(u.id, 'REMINDER', 'Pengingat', 'Pengingat booking besok.');
    const rows = await reports.notificationsList(u.id);
    expect(rows.length).toBe(1);
    expect(rows[0]).not.toHaveProperty('userId');
    expect(rows[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    await reports.notificationRead(u.id, rows[0].id);
    const updated = await prisma.notification.findUnique({ where: { id: rows[0].id } });
    expect(updated!.readAt).toBeTruthy();
    await expect(reports.notificationRead('other', rows[0].id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// Fix round 1: mock parses date/from/to via IsoDate — garbage must be 400, not 500/empty-200.
describe('report date query validation', () => {
  let app: INestApplication;
  let base: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api'); // mirrors main.ts
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
    const ga = await prisma.user.findFirstOrThrow({ where: { nik: 'GA1' } });
    token = await new JwtService({ secret: process.env.APP_SECRET! }).signAsync({ sub: ga.id }, { expiresIn: '10m' });
  });

  afterAll(async () => { await app.close(); });

  const get = (path: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const expect400 = async (path: string, message: string) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: 'VALIDATION_ERROR', message });
  };

  test('GET /api/reports/dashboard?date=abc → 400 body: Format tanggal YYYY-MM-DD', async () => {
    await expect400('/api/reports/dashboard?date=abc', 'body: Format tanggal YYYY-MM-DD');
  });

  test('GET /api/reports/occupancy?from=abc → 400 body: Format tanggal YYYY-MM-DD', async () => {
    await expect400('/api/reports/occupancy?from=abc', 'body: Format tanggal YYYY-MM-DD');
  });

  test('GET /api/reports/occupancy?to=abc → 400 body: Format tanggal YYYY-MM-DD', async () => {
    await expect400('/api/reports/occupancy?to=abc', 'body: Format tanggal YYYY-MM-DD');
  });

  test('GET /api/reports/rejected?from=abc → 400 body: Format tanggal YYYY-MM-DD', async () => {
    await expect400('/api/reports/rejected?from=abc', 'body: Format tanggal YYYY-MM-DD');
  });

  test('GET /api/reports/rejected?to=abc → 400 body: Format tanggal YYYY-MM-DD', async () => {
    await expect400('/api/reports/rejected?to=abc', 'body: Format tanggal YYYY-MM-DD');
  });

  test('GET /api/reports/dashboard?date= (empty) → treated as absent, 200 default date', async () => {
    const res = await get('/api/reports/dashboard?date=');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string };
    expect(body.date).toBe(jakartaDate(new Date()));
  });
});
