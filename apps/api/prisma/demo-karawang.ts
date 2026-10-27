// Additive local-only fixture. Never invoke seed.ts (that seed is destructive).
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { addDays, departureAt, jakartaDate } from '@bms/shared';

const PREFIX = 'demo-karawang-';
const id = (suffix: string) => `${PREFIX}${suffix}`;
const PASSWORD = 'KarawangDemo2026!'; // Public, synthetic accounts only.
const FACTORY = 'PT. Santos Jaya Abadi — Surya Cipta';
// Fictional names/plates for presentation, not verified identities or vehicle registrations.
const vendors = ['PT. Lintas Wahana Karawang', 'PT. Mitra Jelajah Mandiri'];
const drivers = ['Agus Setiawan', 'Dedi Kurniawan', 'Bambang Prasetyo', 'Wahyu Firmansyah'];
const plates = ['T 7142 KA', 'T 7286 KB', 'T 7351 KC', 'T 7468 KD'];
const routeCode = (r: number) => `KRW-${String(r + 1).padStart(2, '0')}`;
const routeName = (label: string) => `${label} → ${FACTORY}`;
const notificationLabels = {
  title: 'Jadwal antar jemput Karawang',
  body: 'Selamat datang di layanan antar jemput. Silakan periksa jadwal, rute, dan titik penjemputan Anda.',
};
// Refresh allowlist: vendor.name/contact, bus.plate, user.name/department,
// shift.name, route.code/name, stop.name, notification.title/body ONLY.
// Exception: the four explicit synthetic DRIVER IDs may also refresh nik after collision/role checks.
// Never spread create payloads into an update; employee login identifiers remain unchanged.
const weekdays = [1, 2, 3, 4, 5, 6, 7];
const shifts = [
  { key: 'pagi', name: 'Pagi', startTime: '07:00', endTime: '15:00', pickup: '05:50', dropoff: '15:10', dayOffset: 0 },
  { key: 'siang', name: 'Siang', startTime: '15:00', endTime: '23:00', pickup: '13:50', dropoff: '23:10', dayOffset: 0 },
  { key: 'malam', name: 'Malam', startTime: '23:00', endTime: '07:00', pickup: '21:50', dropoff: '07:10', dayOffset: 1 },
];
// All points are illustrative Karawang-area points, not surveyed stops/factory gates.
const routes = [
  { key: 'telukjambe', label: 'Telukjambe', color: '#169B62', points: [
    { name: 'Karawang Barat', lat: -6.306, lng: 107.278 },
    { name: 'Telukjambe', lat: -6.338, lng: 107.298 },
    { name: FACTORY, lat: -6.397, lng: 107.332 },
  ] },
  { key: 'klari', label: 'Klari–Kosambi', color: '#1F6FD1', points: [
    { name: 'Karawang Timur', lat: -6.322, lng: 107.326 },
    { name: 'Klari', lat: -6.350, lng: 107.368 },
    { name: 'Kosambi', lat: -6.366, lng: 107.389 },
    { name: FACTORY, lat: -6.397, lng: 107.332 },
  ] },
];
const names = [
  'Ayu Lestari', 'Bima Saputra', 'Citra Maharani', 'Danu Wicaksono',
  'Eka Puspitasari', 'Fajar Ramadhan', 'Gita Permatasari', 'Hendra Gunawan',
  'Indah Kartikasari', 'Joko Susanto', 'Kartika Wulandari', 'Lukman Hakim',
  'Maya Anggraini', 'Nurul Fitriani', 'Oki Darmawan', 'Putri Handayani',
  'Rizky Maulana', 'Sari Apriliani', 'Taufik Hidayat', 'Utami Kusumawati',
  'Vina Rahmawati', 'Wawan Hermawan', 'Yuni Astuti', 'Zainal Arifin',
];
const departments = ['Produksi', 'Gudang', 'Quality Control'];
const today = jakartaDate(new Date());
const days = Array.from({ length: 9 }, (_, i) => addDays(today, i));

function validateTarget() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL required for --apply; use the local dev startup environment.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid DATABASE_URL (value suppressed).'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/bms_dev' || url.search || url.hash) {
    throw new Error('Refused: require PostgreSQL on localhost, database bms_dev, no URL query/fragment.');
  }
  // No credentials are printed, including when Prisma returns a connection error.
  console.log(`Validated local target: ${url.hostname}:${url.port || '5432'}/bms_dev`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--apply', '--refresh-labels'].includes(a))) {
    throw new Error('Supported options: --apply, --refresh-labels. Default is offline dry run.');
  }
  const refreshLabels = args.includes('--refresh-labels');
  // Explicit IDs only: this helper cannot authorize updates to application-owned rows.
  const labels = <T extends object>(recordId: string, fields: T): T | Record<string, never> => {
    if (!recordId.startsWith(PREFIX)) throw new Error('REFRESH_ID_OUTSIDE_FIXTURE');
    return refreshLabels ? fields : {};
  };
  console.log(`Label refresh: ${refreshLabels ? 'requested (presentation allowlist only)' : 'disabled'}`);
  console.log(`Karawang DEMO plan ${today} through ${days[8]} (Asia/Jakarta)`);
  console.log(JSON.stringify({ vendors: 2, buses: 4, drivers: 4, employees: 24, shifts: 3, routes: 2, stops: 7,
    templates: 12, trips: 108, subscriptions: 24, bookings: 432, notifications: 24,
    operations: 108, gpsSamples: 6, attendanceMax: 24 }));
  if (!args.includes('--apply')) {
    console.log('DRY RUN: no database connection or writes. Counts are planned maxima; no rows changed. Apply preserves existing rows unless label refresh is explicitly requested.');
    return;
  }
  validateTarget();
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(PASSWORD);
    await prisma.$transaction(async (tx) => {
      // Serialize concurrent invocations of this fixture. No application records are deleted.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(2702026)::text`;
      const tripIds = new Map<string, string>();
      for (let v = 0; v < 2; v++) {
        const vendorId = id(`vendor-${v}`);
        await tx.vendor.upsert({ where: { id: vendorId },
          update: labels(vendorId, { name: vendors[v]!, contact: '' }), create: {
          id: vendorId, name: vendors[v]!, contact: '',
        } });
        for (let b = 0; b < 2; b++) {
          const busId = id(`bus-${v}-${b}`);
          await tx.bus.upsert({ where: { id: busId }, update: labels(busId, { plate: plates[v * 2 + b]! }), create: {
            id: busId, plate: plates[v * 2 + b]!, capacity: 30, vendorId,
          } });
          const driverId = id(`driver-${v}-${b}`);
          const driverNik = String(22345 + v * 2 + b).padStart(8, '0');
          const existingDriver = await tx.user.findUnique({ where: { id: driverId }, select: { role: true } });
          if (existingDriver && existingDriver.role !== 'DRIVER') throw new Error('DEMO_DRIVER_ROLE_MISMATCH');
          // Only these four explicit fixture IDs can receive a new login NIK.
          // Check before any update/create; the unique constraint also guards concurrent collisions.
          if (refreshLabels || !existingDriver) {
            const conflict = await tx.user.findUnique({ where: { nik: driverNik }, select: { id: true } });
            if (conflict && conflict.id !== driverId) throw new Error('DEMO_DRIVER_NIK_COLLISION');
          }
          await tx.user.upsert({ where: { id: driverId },
            update: labels(driverId, { name: drivers[v * 2 + b]!, nik: driverNik }), create: {
            id: driverId, nik: driverNik, name: drivers[v * 2 + b]!,
            role: 'DRIVER', vendorId, passwordHash, mustChangePassword: false,
          } });
        }
      }
      for (const s of shifts) await tx.shift.upsert({ where: { id: id(`shift-${s.key}`) },
        update: labels(id(`shift-${s.key}`), { name: s.name }), create: {
        id: id(`shift-${s.key}`), name: s.name, startTime: s.startTime, endTime: s.endTime,
      } });
      for (const [r, route] of routes.entries()) {
        const routeId = id(`route-${route.key}`);
        await tx.route.upsert({ where: { id: routeId },
          update: labels(routeId, { code: routeCode(r), name: routeName(route.label) }), create: {
          id: routeId, code: routeCode(r), name: routeName(route.label), color: route.color,
        } });
        for (const [p, point] of route.points.entries()) await tx.stop.upsert({
          where: { id: id(`stop-${r}-${p}`) },
          update: labels(id(`stop-${r}-${p}`), { name: point.name }), create: {
            id: id(`stop-${r}-${p}`), routeId, ...point, seq: p + 1,
            offsetMinutes: Math.round(p * 50 / (route.points.length - 1)),
          },
        });
        for (const s of shifts) for (const direction of ['PICKUP', 'DROPOFF']) {
          const b = direction === 'PICKUP' ? 0 : 1;
          const busId = id(`bus-${r}-${b}`), driverId = id(`driver-${r}-${b}`);
          const templateId = id(`template-${r}-${s.key}-${direction}`), shiftId = id(`shift-${s.key}`);
          const time = direction === 'PICKUP' ? s.pickup : s.dropoff;
          const offset = direction === 'PICKUP' ? 0 : s.dayOffset;
          await tx.tripTemplate.upsert({ where: { id: templateId }, update: {}, create: {
            id: templateId, routeId, shiftId, direction, busId, departureTime: time, dayOffset: offset, weekdays,
          } });
          for (const date of days) {
            const plannedTripId = id(`trip-${r}-${s.key}-${direction}-${date}`);
            // The scheduler uses generated IDs. Reuse only the unique row for this exact
            // explicit demo template/date; never adopt trips from another template.
            const trip = await tx.trip.upsert({ where: { templateId_date: { templateId, date } }, update: {}, create: {
              id: plannedTripId, templateId, date, departureAt: departureAt(date, time, offset as 0 | 1),
              capacity: 30, routeId, shiftId, direction, busId,
            } });
            if (trip.routeId !== routeId || trip.shiftId !== shiftId || trip.direction !== direction || trip.busId !== busId) {
              throw new Error('DEMO_TRIP_RELATION_MISMATCH');
            }
            const tripId = trip.id;
            tripIds.set(plannedTripId, tripId);
            await tx.tripOperation.upsert({ where: { tripId }, update: {}, create: { tripId, driverId } });
            // Static synthetic sample for today's morning pickup. Reruns do not overwrite GPS history.
            if (date === today && s.key === 'pagi' && direction === 'PICKUP') {
              for (let sample = 0; sample < 3; sample++) await tx.tripLocation.upsert({
                where: { tripId_sampleId: { tripId, sampleId: id(`gps-${sample}`) } }, update: {}, create: {
                  tripId, sampleId: id(`gps-${sample}`), lat: route.points[1]!.lat + sample * 0.001,
                  lng: route.points[1]!.lng + sample * 0.001, accuracy: 25,
                  capturedAt: new Date(Date.now() - (2 - sample) * 60_000),
                },
              });
            }
          }
        }
      }
      for (let e = 0; e < 24; e++) {
        const userId = id(`employee-${e}`), nik = String(12345 + e).padStart(8, '0');
        const conflict = await tx.user.findUnique({ where: { nik }, select: { id: true } });
        if (conflict && conflict.id !== userId) throw new Error('DEMO_NIK_COLLISION');
        await tx.user.upsert({ where: { id: userId },
          update: labels(userId, { name: names[e]!, department: departments[e % 3]! }), create: {
          id: userId, nik, name: names[e]!,
          department: departments[e % 3], role: 'EMPLOYEE', passwordHash, mustChangePassword: false,
        } });
        const r = e % 2, s = shifts[Math.floor(e / 2) % 3]!;
        const routeId = id(`route-${routes[r]!.key}`), shiftId = id(`shift-${s.key}`);
        const stopId = id(`stop-${r}-${Math.floor(e / 6) % (routes[r]!.points.length - 1)}`);
        for (const direction of ['PICKUP', 'DROPOFF']) {
          const subscriptionId = e < 12 ? id(`sub-${e}-${direction}`) : null;
          if (subscriptionId) await tx.subscription.upsert({ where: { id: subscriptionId }, update: {}, create: {
            id: subscriptionId, userId, routeId, shiftId, stopId, direction, startDate: today,
            endDate: days[8], weekdays,
          } });
          for (const date of days) {
            const bookingId = id(`booking-${e}-${direction}-${date}`);
            if (await tx.booking.findUnique({ where: { id: bookingId } })) continue;
            // Scheduler/manual bookings are not overwritten or duplicated.
            if (await tx.booking.findFirst({ where: { userId, date, shiftId, direction, status: 'BOOKED' } })) continue;
            const tripId = tripIds.get(id(`trip-${r}-${s.key}-${direction}-${date}`));
            if (!tripId) throw new Error('DEMO_TRIP_MAP_MISSING');
            await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${tripId} FOR UPDATE`;
            const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
            if (trip.status !== 'SCHEDULED' || trip.bookedCount >= trip.capacity) continue;
            await tx.booking.create({ data: { id: bookingId, userId, tripId, routeId, shiftId, stopId,
              direction, date, source: subscriptionId ? 'SUBSCRIPTION' : 'DAILY', subscriptionId } });
            await tx.trip.update({ where: { id: tripId }, data: { bookedCount: { increment: 1 } } });
          }
        }
        // Historical synthetic check-ins only after today's pickup stop time has passed.
        // Explicit demo booking IDs only; no attendance attached to a foreign booking.
        const booking = await tx.booking.findUnique({ where: { id: id(`booking-${e}-PICKUP-${today}`) },
          include: { trip: true, stop: true } });
        if (booking?.status === 'BOOKED' && booking.trip?.status === 'SCHEDULED') {
          const checkedInAt = new Date(booking.trip.departureAt.getTime() + booking.stop.offsetMinutes * 60_000);
          if (checkedInAt.getTime() <= Date.now()) await tx.attendance.upsert({
            where: { bookingId: booking.id }, update: {}, create: {
              bookingId: booking.id, tripId: booking.trip.id, busId: booking.trip.busId,
              actorId: id(`driver-${r}-0`), method: 'DRIVER_SCANNER', checkedInAt,
            },
          });
        }
        await tx.notification.upsert({ where: { id: id(`notification-${e}`) },
          update: labels(id(`notification-${e}`), notificationLabels), create: {
          id: id(`notification-${e}`), userId, type: 'REMINDER', ...notificationLabels,
          data: { demo: true, dataset: PREFIX, date: today },
        } });
      }
    }, { timeout: 120_000 });
    console.log('DEMO applied atomically. Existing operational rows/passwords retained; requested presentation labels refreshed only. No admin or settings modified.');
  } finally { await prisma.$disconnect(); }
}

main().catch(() => {
  // Prisma errors can contain connection strings or user data: deliberately do not log the error object.
  console.error('DEMO refused/failed; transaction rolled back if started. Check local target, migrations and unique NIK/plate/code/template-date conflicts. No credentials logged.');
  process.exitCode = 1;
});
