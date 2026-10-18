import { beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$executeRawUnsafe('DELETE FROM "Booking"'); // clean slate; tables must exist
  // Minimal FK parents so raw inserts below test constraints, not foreign keys.
  // (Brief assumed FKs relaxed; Prisma enforces them, so seed parents verbatim-compatibly.)
  await prisma.$executeRaw`INSERT INTO "Vendor" (id, name, "createdAt", "updatedAt") VALUES ('v1','Vendor 1',now(),now()) ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "Bus" (id, plate, capacity, "vendorId", "createdAt", "updatedAt") VALUES ('b1','B 1',2,'v1',now(),now()) ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "Shift" (id, name, "startTime", "endTime", "createdAt", "updatedAt") VALUES ('pagi','Pagi','05:00','10:00',now(),now()) ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "Route" (id, code, name, color, "createdAt", "updatedAt") VALUES ('r1','R1','Route 1','#fff',now(),now()) ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "Stop" (id, "routeId", name, seq, "offsetMinutes", "createdAt", "updatedAt") VALUES ('s1','r1','Stop 1',1,0,now(),now()) ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "User" (id, nik, name, role, "createdAt", "updatedAt") VALUES ('u1','nik1','User 1','EMPLOYEE',now(),now()) ON CONFLICT (id) DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "TripTemplate" (id, "routeId", "shiftId", direction, "busId", "departureTime", weekdays, "createdAt", "updatedAt") VALUES ('tpl1','r1','pagi','PICKUP','b1','05:00',ARRAY[1,2,3,4,5],now(),now()) ON CONFLICT (id) DO NOTHING`;
});

describe('schema constraints (spec §4)', () => {
  test('partial unique: second active booking same user/date/shift/direction violates', async () => {
    const data = {
      userId: 'u1', tripId: null as unknown as string, routeId: 'r1', stopId: 's1',
      shiftId: 'pagi', direction: 'PICKUP', date: '2099-01-01', status: 'BOOKED', source: 'DAILY',
    } as never;
    // tripId/foreign keys relaxed: constraint under test is the partial unique index itself
    await prisma.$executeRaw`INSERT INTO "Booking" (id, "userId", "routeId", "stopId", "shiftId", direction, date, status, source, "createdAt", "updatedAt") VALUES ('b1', 'u1', 'r1', 's1', 'pagi', 'PICKUP', '2099-01-01', 'BOOKED', 'DAILY', now(), now())`;
    await expect(
      prisma.$executeRaw`INSERT INTO "Booking" (id, "userId", "routeId", "stopId", "shiftId", direction, date, status, source, "createdAt", "updatedAt") VALUES ('b2', 'u1', 'r1', 's1', 'pagi', 'PICKUP', '2099-01-01', 'BOOKED', 'DAILY', now(), now())`,
    ).rejects.toThrow();
    // a CANCELLED row is allowed (partial WHERE status='BOOKED')
    await prisma.$executeRaw`INSERT INTO "Booking" (id, "userId", "routeId", "stopId", "shiftId", direction, date, status, source, "createdAt", "updatedAt") VALUES ('b3', 'u1', 'r1', 's1', 'pagi', 'PICKUP', '2099-01-01', 'CANCELLED', 'DAILY', now(), now())`;
    await prisma.$executeRaw`DELETE FROM "Booking" WHERE id IN ('b1','b3')`;
  });

  test('CHECK: booked_count cannot exceed capacity', async () => {
    await prisma.$executeRaw`INSERT INTO "Trip" (id, "templateId", date, "departureAt", status, "bookedCount", capacity, "routeId", "shiftId", direction, "busId", "createdAt", "updatedAt") VALUES ('t1','tpl1','2099-01-01', now(), 'SCHEDULED', 0, 2, 'r1','pagi','PICKUP','b1', now(), now())`;
    await expect(
      prisma.$executeRaw`UPDATE "Trip" SET "bookedCount" = 5 WHERE id = 't1'`,
    ).rejects.toThrow();
    await prisma.$executeRaw`DELETE FROM "Trip" WHERE id = 't1'`;
  });

  test('UNIQUE(template_id, date) exists (trip generation idempotent)', async () => {
    // covered implicitly by generate tests; assert the index name is present
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'Trip' AND indexdef LIKE '%UNIQUE%'`;
    expect(rows.some((r) => r.indexname.includes('templateId'))).toBe(true);
  });
});
