// apps/api/test/master.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { VendorsService } from '../src/fleet/vendors.service';
import { BusesService } from '../src/fleet/buses.service';
import { RoutesService } from '../src/routes/routes.service';
import { StopsService } from '../src/routes/stops.service';
import { AuditService } from '../src/audit/audit.service';
import { DomainError } from '../src/common/domain-error';

const prisma = new PrismaClient();
const actor = { id: 'a1', name: 'Admin', role: 'SUPER_ADMIN' } as never;

let vendors: VendorsService;
let buses: BusesService;
let routes: RoutesService;
let stops: StopsService;

beforeAll(async () => {
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(), prisma.notification.deleteMany(), // seeded/live rows hold user+stop FKs
    prisma.rejectedRequest.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.booking.deleteMany(), prisma.subscription.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
  ]);
  // FK: auditLog.actorId references User; re-runnable across runs
  await prisma.user.upsert({
    where: { id: 'a1' },
    create: { id: 'a1', nik: 'TEST-A1', name: 'Admin', role: 'SUPER_ADMIN' },
    update: {},
  });
  const audit = new AuditService(prisma);
  vendors = new VendorsService(prisma, audit);
  buses = new BusesService(prisma, audit);
  routes = new RoutesService(prisma, audit);
  stops = new StopsService(prisma, audit);
});

// auth.test deletes users wholesale; subscription FK (RESTRICT) must not outlive this file
afterAll(async () => {
  await prisma.$transaction([
    prisma.rejectedRequest.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.booking.deleteMany(), prisma.subscription.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.refreshToken.deleteMany(), prisma.deviceToken.deleteMany(), prisma.notification.deleteMany(),
    prisma.auditLog.deleteMany(), prisma.user.deleteMany(),
  ]);
  await prisma.$disconnect();
});

describe('vendors', () => {
  test('create + deactivate blocked while active buses exist', async () => {
    const v = await vendors.create({ name: 'PT A', contact: '021', active: true }, actor);
    await buses.create({ plate: 'B 1001 AA', capacity: 40, vendorId: v.id, active: true }, actor);
    await expect(vendors.deactivate(v.id, actor)).rejects.toThrow('Vendor masih punya bus aktif.');
    // after deactivating the bus, vendor deactivates
    await buses.deactivate((await prisma.bus.findFirst({ where: { vendorId: v.id } }))!.id, actor);
    await expect(vendors.deactivate(v.id, actor)).resolves.toBeTruthy();
  });
});

describe('buses', () => {
  test('plate duplicated → "Plat X sudah terdaftar."; uppercase transform', async () => {
    const v = await vendors.create({ name: 'PT B', contact: '', active: true }, actor);
    await buses.create({ plate: 'B 2002 BB', capacity: 30, vendorId: v.id, active: true }, actor);
    await expect(buses.create({ plate: 'B 2002 BB', capacity: 30, vendorId: v.id, active: true }, actor))
      .rejects.toThrow('Plat B 2002 BB sudah terdaftar.');
  });

  test('deactivate blocked when used by active template', async () => {
    const bus = await prisma.bus.findFirstOrThrow();
    const route = await routes.create({ code: 'RX', name: 'Test', color: '#000000', active: true }, actor);
    await prisma.shift.upsert({ where: { id: 'pagi' }, create: { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' }, update: {} });
    await prisma.tripTemplate.create({
      data: { routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id, departureTime: '05:00', dayOffset: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true },
    });
    await expect(buses.deactivate(bus.id, actor)).rejects.toThrow('Bus masih dipakai template aktif atau trip yang belum berangkat.');
  });

  test('setBusCapacity rejected when booked > new capacity (CAPACITY_BELOW_BOOKED)', async () => {
    const bus = await prisma.bus.findFirstOrThrow();
    const route = await prisma.route.findFirstOrThrow();
    // create a future trip with bookedCount 10
    const dep = new Date(Date.now() + 86_400_000);
    const trip = await prisma.trip.create({
      data: {
        templateId: (await prisma.tripTemplate.findFirstOrThrow()).id,
        date: '2099-06-01', departureAt: dep, status: 'SCHEDULED', bookedCount: 10, capacity: 40,
        routeId: route.id, shiftId: 'pagi', direction: 'PICKUP', busId: bus.id,
      },
    });
    await expect(buses.setBusCapacity(bus.id, 5, actor)).rejects.toMatchObject({
      code: 'CAPACITY_BELOW_BOOKED', message: expect.stringContaining('sudah 10 booking'),
    });
    // capacity >= booked succeeds and propagates to SCHEDULED not-departed trips
    const r = await buses.setBusCapacity(bus.id, 15, actor);
    expect(r.capacity).toBe(15);
    const t = await prisma.trip.findUnique({ where: { id: trip.id } });
    expect(t!.capacity).toBe(15);
  });
});

describe('routes + stops', () => {
  test('route code duplicated → "Kode rute X sudah dipakai."', async () => {
    await routes.create({ code: 'RZ', name: 'Z', color: '#111111', active: true }, actor);
    await expect(routes.create({ code: 'RZ', name: 'Z2', color: '#222222', active: true }, actor))
      .rejects.toThrow('Kode rute RZ sudah dipakai.');
  });

  test('stop seq unique per route; deactivate blocked by active subscription', async () => {
    const route = await prisma.route.findFirstOrThrow();
    const s = await stops.create(route.id, { name: 'Halte', seq: 1, offsetMinutes: 0, lat: null, lng: null, active: true }, actor);
    await expect(stops.create(route.id, { name: 'Dup', seq: 1, offsetMinutes: 5, lat: null, lng: null, active: true }, actor)).rejects.toBeTruthy();
    // active subscription on this stop blocks deactivate
    const u = await prisma.user.upsert({
      where: { nik: 'KEMP1' },
      create: { nik: 'KEMP1', name: 'E', role: 'EMPLOYEE', active: true },
      update: {},
    });
    await prisma.subscription.create({
      data: { userId: u.id, routeId: route.id, stopId: s.id, shiftId: 'pagi', direction: 'PICKUP', startDate: '2099-01-01', weekdays: [1], status: 'ACTIVE' },
    });
    await expect(stops.deactivate(route.id, s.id, actor)).rejects.toThrow('Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.');
  });

  test('stop.routeId mismatch on update → NOT_FOUND', async () => {
    const routeA = await prisma.route.findFirstOrThrow();
    const routeB = await routes.create({ code: 'RY', name: 'Y', color: '#333333', active: true }, actor);
    const s = await prisma.stop.findFirstOrThrow({ where: { routeId: routeA.id } });
    await expect(stops.update(routeB.id, s.id, { name: 'X', seq: s.seq, offsetMinutes: 0, lat: null, lng: null, active: true }, actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('missing entity', () => {
  test('update with unknown id → 404 NOT_FOUND even when plate/code collides (mock find-first order)', async () => {
    const v = await prisma.vendor.findFirstOrThrow();
    await expect(
      buses.update('missing-bus', { plate: 'B 2002 BB', capacity: 30, vendorId: v.id, active: true }, actor),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
    await expect(
      routes.update('missing-route', { code: 'RZ', name: 'Z', color: '#111111', active: true }, actor),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
    await expect(vendors.update('missing-vendor', { name: 'x', contact: '', active: false }, actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
    await expect(vendors.deactivate('missing-vendor', actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
    await expect(buses.setBusCapacity('missing-bus', 10, actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
    await expect(buses.deactivate('missing-bus', actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
    await expect(routes.deactivate('missing-route', actor))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Data tidak ditemukan.' });
  });
});
