// Dev seed: mirrors packages/mock-api seed data verbatim (mock wins on DATA).
// Idempotent reset — dev only, never run against prod.
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { addDays, departureAt, isoWeekday, jakartaDate } from '@bms/shared';

// ponytail: @bms/shared does not export DEMO_PASSWORD — local const per brief.
const DEMO_PASSWORD = 'demo1234';

// Mock parity: capacity per route (R1=8, R4=11, rest 50); vendor v1 = R1-R3, v2 = R4-R6.
const ROUTES = [
  { code: 'R1', name: 'Cikarang', color: '#D6322B', stops: ['Terminal Cikarang', 'Pasar Lemahabang', 'Simpang Cibarusah'], capacity: 8 },
  { code: 'R2', name: 'Bekasi Timur', color: '#1F6FD1', stops: ['Halte Bulak Kapal', 'Stasiun Bekasi Timur', 'Pasar Rawalumbu'], capacity: 50 },
  { code: 'R3', name: 'Karawang', color: '#169B62', stops: ['Terminal Klari', 'Alun-alun Karawang', 'Galuh Mas'], capacity: 50 },
  { code: 'R4', name: 'Tambun', color: '#E07A00', stops: ['Stasiun Tambun', 'Pasar Tambun', 'Mangunjaya'], capacity: 11 },
  { code: 'R5', name: 'Cibitung', color: '#7A3FC2', stops: ['Stasiun Cibitung', 'Pasar Cibitung', 'Wanasari'], capacity: 50 },
  { code: 'R6', name: 'Jababeka', color: '#0E9AA7', stops: ['Terminal Jababeka', 'Kawasan Jababeka 2', 'Pasir Gombong'], capacity: 50 },
] as const;

const SHIFTS = [
  { id: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00' },
  { id: 'siang', name: 'Siang', startTime: '15:00', endTime: '23:00' },
  { id: 'malam', name: 'Malam', startTime: '23:00', endTime: '07:00' },
] as const;

// Mock parity: [shiftId, direction, hour, minute, dayOffset]; minute + 5 per route index.
const TEMPLATES = [
  { shiftId: 'pagi', direction: 'PICKUP', h: 5, m: 20, dayOffset: 0 },
  { shiftId: 'pagi', direction: 'DROPOFF', h: 15, m: 10, dayOffset: 0 },
  { shiftId: 'siang', direction: 'PICKUP', h: 13, m: 20, dayOffset: 0 },
  { shiftId: 'siang', direction: 'DROPOFF', h: 23, m: 10, dayOffset: 0 },
  { shiftId: 'malam', direction: 'PICKUP', h: 21, m: 20, dayOffset: 0 },
  { shiftId: 'malam', direction: 'DROPOFF', h: 7, m: 10, dayOffset: 1 },
] as const;

const NAMES = ['Rina Wulandari', 'Budi Santoso', 'Siti Aminah', 'Agus Prasetyo', 'Dewi Lestari', 'Eko Saputra'];
const DEPARTMENTS = ['Produksi', 'Gudang', 'QC', 'Maintenance'];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

const prisma = new PrismaClient();

async function main() {
  // Children before parents (no ON DELETE CASCADE in schema).
  await prisma.$transaction([
    prisma.notification.deleteMany(), prisma.rejectedRequest.deleteMany(), prisma.booking.deleteMany(),
    prisma.subscription.deleteMany(), prisma.deviceToken.deleteMany(), prisma.refreshToken.deleteMany(),
    prisma.auditLog.deleteMany(), prisma.trip.deleteMany(), prisma.tripTemplate.deleteMany(),
    prisma.stop.deleteMany(), prisma.route.deleteMany(), prisma.bus.deleteMany(), prisma.vendor.deleteMany(),
    prisma.shift.deleteMany(), prisma.setting.deleteMany(), prisma.backup.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  await prisma.vendor.create({ data: { id: 'v1', name: 'PT Trans Jaya', contact: '021-555-0101', active: true } });
  await prisma.vendor.create({ data: { id: 'v2', name: 'CV Mitra Armada', contact: '021-555-0202', active: true } });

  for (const s of SHIFTS) await prisma.shift.create({ data: { ...s } });

  for (let i = 0; i < 6; i++) {
    const route = ROUTES[i]!;
    const vendorId = i < 3 ? 'v1' : 'v2';
    const busA = await prisma.bus.create({ data: { id: `b${i * 2 + 1}`, plate: `B 7${i + 1}01 FX`, capacity: route.capacity, vendorId, active: true } });
    const busB = await prisma.bus.create({ data: { id: `b${i * 2 + 2}`, plate: `B 7${i + 1}02 KR`, capacity: route.capacity, vendorId, active: true } });

    const r = await prisma.route.create({ data: { id: `r${i + 1}`, code: route.code, name: route.name, color: route.color, active: true } });
    for (let s = 0; s < route.stops.length; s++) {
      await prisma.stop.create({
        data: { id: `r${i + 1}s${s + 1}`, routeId: r.id, name: route.stops[s], seq: s + 1, offsetMinutes: s * 15, lat: null, lng: null, active: true },
      });
    }
    for (const tpl of TEMPLATES) {
      await prisma.tripTemplate.create({
        data: {
          routeId: r.id, shiftId: tpl.shiftId, direction: tpl.direction,
          busId: tpl.direction === 'PICKUP' ? busA.id : busB.id,
          departureTime: hhmm(tpl.h, tpl.m + i * 5), dayOffset: tpl.dayOffset,
          weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
        },
      });
    }
  }

  const demoHash = await argon2.hash(DEMO_PASSWORD);
  // Mock parity: niks admin/ga/vendor (brief said ADMIN/GA01/V001 — mock wins).
  await prisma.user.create({ data: { id: 'admin', nik: 'admin', name: 'Super Admin', role: 'SUPER_ADMIN', active: true, passwordHash: demoHash, mustChangePassword: false, authProvider: 'LOCAL' } });
  await prisma.user.create({ data: { id: 'ga', nik: 'ga', name: 'Admin GA', role: 'ADMIN_GA', active: true, passwordHash: demoHash, mustChangePassword: false, authProvider: 'LOCAL' } });
  await prisma.user.create({ data: { id: 'vendor', nik: 'vendor', name: 'Operator PT Trans Jaya', role: 'VENDOR', vendorId: 'v1', active: true, passwordHash: demoHash, mustChangePassword: false, authProvider: 'LOCAL' } });

  const today = jakartaDate(new Date());
  for (let i = 0; i < 90; i++) {
    const nik = `K${1001 + i}`;
    const userId = nik.toLowerCase();
    // Mock parity: index 58 = K1059 suspended until day0+3 (date compare, not Date.now()+3d).
    const suspended = nik === 'K1059';
    const user = await prisma.user.create({
      data: {
        id: userId, nik, name: NAMES[i] ?? `Karyawan ${nik}`, department: DEPARTMENTS[i % DEPARTMENTS.length]!,
        phone: `0812000${1001 + i}`, role: 'EMPLOYEE', active: true,
        passwordHash: demoHash, mustChangePassword: nik === 'K1090',
        bookingSuspendedUntil: suspended ? new Date(`${addDays(today, 3)}T00:00:00+07:00`) : null,
        suspendReason: suspended ? 'No-show 3x dalam 30 hari' : null,
        failedLogins: 0, lockedUntil: null, authProvider: 'LOCAL',
      },
    });

    const routeId = `r${(i % 6) + 1}`;
    const shiftId = i < 60 ? 'pagi' : i < 75 ? 'siang' : 'malam';
    for (const direction of ['PICKUP', 'DROPOFF'] as const) {
      await prisma.subscription.create({
        data: {
          userId: user.id, routeId, stopId: `${routeId}s${(i % 3) + 1}`,
          shiftId, direction, startDate: today, endDate: null,
          weekdays: [1, 2, 3, 4, 5, 6, 7], status: 'ACTIVE',
        },
      });
    }
  }

  // Mirrors GenerateService.runGenerate + cron allocate path (mock domain/generate.ts + allocate.ts).
  const daysAhead = 7; // = generate_days_ahead default
  for (let d = 0; d <= daysAhead; d++) {
    const date = addDays(today, d);
    const weekday = isoWeekday(date);
    const templates = await prisma.tripTemplate.findMany({ where: { active: true }, include: { bus: true } });
    for (const tpl of templates) {
      if (!tpl.weekdays.includes(weekday)) continue;
      await prisma.trip.upsert({
        where: { templateId_date: { templateId: tpl.id, date } },
        update: {},
        create: {
          templateId: tpl.id, date, departureAt: departureAt(date, tpl.departureTime, tpl.dayOffset as 0 | 1),
          status: 'SCHEDULED', bookedCount: 0, capacity: tpl.bus.capacity,
          routeId: tpl.routeId, shiftId: tpl.shiftId, direction: tpl.direction, busId: tpl.busId,
        },
      });
    }
    const subs = await prisma.subscription.findMany({
      where: { status: 'ACTIVE', startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] },
      orderBy: { createdAt: 'asc' },
    });
    for (const sub of subs) {
      if (!sub.weekdays.includes(weekday)) continue;
      const user = await prisma.user.findUnique({ where: { id: sub.userId } });
      if (!user?.active) continue;
      if (user.bookingSuspendedUntil && user.bookingSuspendedUntil >= new Date(`${date}T00:00:00+07:00`)) continue;
      const hasBooked = await prisma.booking.findFirst({ where: { userId: sub.userId, date, shiftId: sub.shiftId, direction: sub.direction, status: 'BOOKED' } });
      if (hasBooked) continue;
      const cancelledOnPurpose = await prisma.booking.findFirst({ where: { subscriptionId: sub.id, date, cancelReason: { in: ['USER', 'ADMIN_TRIP'] } } });
      if (cancelledOnPurpose) continue;
      const alreadyRejected = await prisma.rejectedRequest.findFirst({ where: { subscriptionId: sub.id, date } });
      if (alreadyRejected) continue;
      const trips = await prisma.trip.findMany({ where: { routeId: sub.routeId, shiftId: sub.shiftId, direction: sub.direction, date, status: 'SCHEDULED' }, orderBy: [{ departureAt: 'asc' }, { id: 'asc' }] });
      if (!trips.length) continue;
      const trip = trips.find((t) => t.bookedCount < t.capacity);
      if (!trip) {
        await prisma.rejectedRequest.create({
          data: { userId: sub.userId, routeId: sub.routeId, stopId: sub.stopId, shiftId: sub.shiftId, direction: sub.direction, date, reason: 'TRIP_FULL', source: 'SUBSCRIPTION', subscriptionId: sub.id },
        });
        await prisma.notification.create({
          data: { userId: sub.userId, type: 'SUBSCRIPTION_REJECTED', title: 'Langganan tidak kebagian kursi', body: `Langganan tanggal ${date} tidak kebagian kursi. Coba booking harian.`, data: { date } },
        });
        continue;
      }
      await prisma.$transaction([
        prisma.trip.update({ where: { id: trip.id }, data: { bookedCount: { increment: 1 } } }),
        prisma.booking.create({
          data: {
            userId: sub.userId, tripId: trip.id, routeId: sub.routeId, stopId: sub.stopId,
            shiftId: sub.shiftId, direction: sub.direction, date, source: 'SUBSCRIPTION',
            subscriptionId: sub.id, status: 'BOOKED',
          },
        }),
      ]);
      // keep in-memory count in sync for the next sub in this single-threaded loop
      trip.bookedCount += 1;
    }
  }
  console.log('seed complete');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
