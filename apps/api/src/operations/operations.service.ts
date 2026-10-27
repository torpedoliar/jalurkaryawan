import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  BUS_QR_PREFIX, TICKET_QR_PREFIX, CHECKIN_OPEN_BEFORE_MIN, CHECKIN_CLOSE_AFTER_MIN,
  jakartaDate, stopTime, toJakartaIso,
  type AssignDriverRequest, type Attendance, type BusPosition, type CheckinMethod, type Direction,
  type DriverTrip, type ExecutionStatus, type LocationBatch,
} from '@bms/shared';
import { DomainError } from '../common/domain-error';

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string; role: string };
type Op = { tripId: string; driverId: string | null; status: ExecutionStatus; startedAt: Date | null; endedAt: Date | null };
type Att = { bookingId: string; tripId: string; busId: string; checkedInAt: Date; method: CheckinMethod };
const fail = (message: string): never => { throw new DomainError('VALIDATION_ERROR', message); };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const iso = (d: Date | null) => d ? toJakartaIso(d.getTime()) : null;

@Injectable()
export class OperationsService {
  private readonly key = scryptSync(process.env.APP_SECRET ?? '', 'bms-qr-credentials-v1', 32);
  constructor(private readonly prisma: PrismaClient) {}

  private encrypt(s: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const bytes = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
  }
  private decrypt(s: string) {
    const b = Buffer.from(s, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
  }
  private async lockTrip(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id" = ${id} FOR UPDATE`;
    const trip = await tx.trip.findUnique({ where: { id }, include: { bus: true, route: { include: { stops: true } }, shift: true } });
    if (!trip) throw new DomainError('NOT_FOUND', 'Trip tidak ditemukan.');
    return trip;
  }
  private async op(tx: Tx, id: string) { return (await tx.$queryRaw<Op[]>`SELECT * FROM "TripOperation" WHERE "tripId" = ${id}`)[0]; }
  private async assigned(tx: Tx, id: string, actor: Actor) {
    const trip = await this.lockTrip(tx, id);
    const op = await this.op(tx, id);
    if (op?.driverId !== actor.id) throw new DomainError('FORBIDDEN', 'Trip ini bukan tugas kamu.');
    if (trip.bus.vendorId !== (await tx.user.findUnique({ where: { id: actor.id } }))?.vendorId) throw new DomainError('FORBIDDEN', 'Vendor sopir tidak sesuai dengan bus.');
    return { trip, op };
  }
  private async own(tx: Tx, id: string, actor: Actor) {
    const b = await tx.booking.findUnique({ where: { id }, include: { stop: true, user: true } });
    if (!b || b.userId !== actor.id) throw new DomainError('NOT_FOUND', 'Booking tidak ditemukan.');
    if (!b.tripId) return fail('Booking belum memiliki trip.');
    return b;
  }
  private async audit(tx: Tx, actor: Actor, action: string, entity: string, entityId: string, after: object) {
    await tx.auditLog.create({ data: { actorId: actor.id, actorName: actor.name, action, entity, entityId, after: after as Prisma.InputJsonValue } });
  }
  private wire(a: Att): Attendance { return { ...a, checkedInAt: toJakartaIso(a.checkedInAt.getTime()) }; }

  async ticket(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const b = await this.own(tx, id, actor);
      const trip = await this.lockTrip(tx, b.tripId!);
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`;
      const fresh = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'BOOKED' || trip.status !== 'SCHEDULED') return fail('Booking ini tidak aktif.');
      const last = Math.max(0, ...trip.route.stops.map((s) => s.offsetMinutes));
      const at = stopTime(toJakartaIso(trip.departureAt.getTime()), trip.direction as Direction, b.stop.offsetMinutes, last);
      const expiresAt = new Date(Date.parse(at) + CHECKIN_CLOSE_AFTER_MIN * 60_000);
      if (expiresAt.getTime() < Date.now()) return fail('Waktu tiket sudah lewat.');
      let row = (await tx.$queryRaw<{ ciphertext: string }[]>`SELECT "ciphertext" FROM "TicketCredential" WHERE "bookingId" = ${id}`)[0];
      if (!row) {
        const qr = TICKET_QR_PREFIX + randomBytes(32).toString('base64url');
        row = { ciphertext: this.encrypt(qr) };
        await tx.$executeRaw`INSERT INTO "TicketCredential" ("bookingId", "secretHash", "ciphertext") VALUES (${id}, ${hash(qr)}, ${row.ciphertext})`;
      }
      return { bookingId: id, qr: this.decrypt(row.ciphertext), expiresAt: toJakartaIso(expiresAt.getTime()) };
    });
  }
  async busQr(id: string, actor: Actor, rotate = false) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Bus" WHERE "id" = ${id} FOR UPDATE`;
      const bus = await tx.bus.findUnique({ where: { id } });
      if (!bus) throw new DomainError('NOT_FOUND', 'Bus tidak ditemukan.');
      let row = (await tx.$queryRaw<{ ciphertext: string; rotatedAt: Date }[]>`SELECT * FROM "BusQrCredential" WHERE "busId" = ${id}`)[0];
      if (!row || rotate) {
        const qr = BUS_QR_PREFIX + randomBytes(32).toString('base64url');
        row = { ciphertext: this.encrypt(qr), rotatedAt: new Date() };
        await tx.$executeRaw`INSERT INTO "BusQrCredential" ("busId","secretHash","ciphertext","rotatedAt") VALUES (${id},${hash(qr)},${row.ciphertext},${row.rotatedAt}) ON CONFLICT ("busId") DO UPDATE SET "secretHash"=EXCLUDED."secretHash", "ciphertext"=EXCLUDED."ciphertext", "rotatedAt"=EXCLUDED."rotatedAt"`;
        if (rotate) await this.audit(tx, actor, 'BUS_QR_ROTATE', 'bus', id, { rotatedAt: row.rotatedAt.toISOString() });
      }
      return { busId: id, plate: bus.plate, qr: this.decrypt(row.ciphertext), rotatedAt: toJakartaIso(row.rotatedAt.getTime()) };
    });
  }
  async assign(id: string, input: AssignDriverRequest, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.lockTrip(tx, id);
      if ((await this.op(tx, id))?.status === 'IN_PROGRESS') return fail('Akhiri perjalanan sebelum mengganti sopir.');
      if (input.driverId) {
        const d = await tx.user.findUnique({ where: { id: input.driverId } });
        if (!d?.active || d.role !== 'DRIVER' || d.vendorId !== t.bus.vendorId) return fail('Pilih sopir aktif dari vendor bus yang sama.');
      }
      await tx.$executeRaw`INSERT INTO "TripOperation" ("tripId","driverId") VALUES (${id},${input.driverId}) ON CONFLICT ("tripId") DO UPDATE SET "driverId"=EXCLUDED."driverId"`;
      await this.audit(tx, actor, 'TRIP_ASSIGN_DRIVER', 'trip', id, { driverId: input.driverId });
      return { id: t.id, templateId: t.templateId, routeId: t.routeId, shiftId: t.shiftId, direction: t.direction, date: t.date, departureAt: toJakartaIso(t.departureAt.getTime()), busId: t.busId, capacity: t.capacity, bookedCount: t.bookedCount, status: t.status };
    });
  }

  /** Both scan directions acquire Trip then Booking locks in the same order. */
  async checkin(id: string, qr: string, actor: Actor, method: CheckinMethod, driverTrip = false) {
    return this.prisma.$transaction(async (tx) => {
      let bookingId = id;
      if (driverTrip) {
        const row = (await tx.$queryRaw<{ bookingId: string }[]>`SELECT "bookingId" FROM "TicketCredential" WHERE "secretHash" = ${hash(qr)}`)[0];
        if (!row) return fail('QR tiket tidak dikenal.');
        bookingId = row.bookingId;
      }
      const initial = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!initial?.tripId) return fail('Booking belum memiliki trip.');
      if (driverTrip && initial.tripId !== id) return fail('Tiket ini bukan untuk trip ini.');
      if (!driverTrip && initial.userId !== actor.id) throw new DomainError('NOT_FOUND', 'Booking tidak ditemukan.');
      const trip = driverTrip ? (await this.assigned(tx, id, actor)).trip : await this.lockTrip(tx, initial.tripId);
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
      const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { user: true, stop: true } });
      if (!driverTrip) {
        // Lock credential while validating so rotation and check-in have a single ordering.
        const bus = (await tx.$queryRaw<{ secretHash: string }[]>`SELECT "secretHash" FROM "BusQrCredential" WHERE "busId" = ${trip.busId} FOR SHARE`)[0];
        if (bus?.secretHash !== hash(qr)) return fail('QR ini bukan untuk bus trip kamu.');
      }
      const last = Math.max(0, ...trip.route.stops.map((s) => s.offsetMinutes));
      const pickupAt = stopTime(toJakartaIso(trip.departureAt.getTime()), trip.direction as Direction, b.stop.offsetMinutes, last);
      const passenger = { name: b.user.name, stopName: b.stop.name, pickupAt };
      const existing = (await tx.$queryRaw<Att[]>`SELECT "bookingId","tripId","busId","checkedInAt","method" FROM "Attendance" WHERE "bookingId" = ${bookingId}`)[0];
      if (existing) return { attendance: this.wire(existing), alreadyCheckedIn: true, passenger };
      if (b.status !== 'BOOKED' || trip.status !== 'SCHEDULED' || !b.user.active) return fail('Booking atau trip ini tidak aktif.');
      if ((await this.op(tx, trip.id))?.status === 'COMPLETED') return fail('Perjalanan sudah selesai; check-in ditutup.');
      const delta = Date.now() - Date.parse(pickupAt);
      if (delta < -CHECKIN_OPEN_BEFORE_MIN * 60_000) return fail(`Check-in dibuka ${CHECKIN_OPEN_BEFORE_MIN} menit sebelum jam jemput.`);
      if (delta > CHECKIN_CLOSE_AFTER_MIN * 60_000) return fail('Waktu check-in untuk trip ini sudah lewat.');
      const checkedInAt = new Date();
      await tx.$executeRaw`INSERT INTO "Attendance" ("bookingId","tripId","busId","actorId","checkedInAt","method") VALUES (${bookingId},${trip.id},${trip.busId},${actor.id},${checkedInAt},${method})`;
      await this.audit(tx, actor, 'CHECKIN', 'booking', bookingId, { tripId: trip.id, method, checkedInAt: checkedInAt.toISOString() });
      return { attendance: this.wire({ bookingId, tripId: trip.id, busId: trip.busId, checkedInAt, method }), alreadyCheckedIn: false, passenger };
    });
  }
  async attendance(id: string) {
    if (!await this.prisma.trip.findUnique({ where: { id }, select: { id: true } })) throw new DomainError('NOT_FOUND', 'Trip tidak ditemukan.');
    const rows = await this.prisma.$queryRaw<Att[]>`SELECT "bookingId","tripId","busId","checkedInAt","method" FROM "Attendance" WHERE "tripId" = ${id}`;
    return rows.map((a) => ({ bookingId: a.bookingId, checkedInAt: toJakartaIso(a.checkedInAt.getTime()), method: a.method }));
  }
  async driverTrips(actor: Actor, date?: string) {
    const day = date || jakartaDate(new Date());
    const ops = await this.prisma.$queryRaw<Op[]>`SELECT * FROM "TripOperation" WHERE "driverId" = ${actor.id}`;
    const trips = await this.prisma.trip.findMany({ where: { id: { in: ops.map((o) => o.tripId) }, date: day }, include: { route: true, bus: true, shift: true }, orderBy: { departureAt: 'asc' } });
    const result: DriverTrip[] = [];
    for (const t of trips) {
      const op = ops.find((o) => o.tripId === t.id)!;
      const rows = await this.attendance(t.id);
      result.push({ tripId: t.id, date: t.date, departureAt: toJakartaIso(t.departureAt.getTime()), direction: t.direction as Direction, routeCode: t.route.code, routeName: t.route.name, routeColor: t.route.color, shiftName: t.shift.name, busId: t.busId, busPlate: t.bus.plate, cancelled: t.status === 'CANCELLED', bookedCount: t.bookedCount, checkedInCount: rows.length, execution: op.status, startedAt: iso(op.startedAt), endedAt: iso(op.endedAt) });
    }
    return result;
  }
  async manifest(id: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const { trip } = await this.assigned(tx, id, actor);
      const rows = await tx.booking.findMany({ where: { tripId: id, status: { not: 'CANCELLED' } }, include: { user: true, stop: true } });
      const att = await tx.$queryRaw<Att[]>`SELECT * FROM "Attendance" WHERE "tripId" = ${id}`;
      const last = Math.max(0, ...trip.route.stops.map((s) => s.offsetMinutes));
      return rows.map((b) => {
        const a = att.find((x) => x.bookingId === b.id);
        return { bookingId: b.id, name: b.user.name, stopName: b.stop.name, stopSeq: b.stop.seq, pickupAt: stopTime(toJakartaIso(trip.departureAt.getTime()), trip.direction as Direction, b.stop.offsetMinutes, last), checkedIn: !!a, checkedInAt: a ? iso(a.checkedInAt) : null, method: a?.method ?? null };
      }).sort((a, b) => a.pickupAt.localeCompare(b.pickupAt) || a.name.localeCompare(b.name));
    });
  }
  async lifecycle(id: string, actor: Actor, end: boolean) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize starts across different trips for this driver before locking the trip.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR NO KEY UPDATE`;
      const { trip, op } = await this.assigned(tx, id, actor);
      if (end) {
        if (op.status === 'NOT_STARTED') return fail('Perjalanan belum dimulai.');
        if (op.status !== 'COMPLETED') await tx.$executeRaw`UPDATE "TripOperation" SET "status"='COMPLETED', "endedAt"=NOW() WHERE "tripId"=${id}`;
      } else {
        if (trip.status !== 'SCHEDULED' || op.status === 'COMPLETED') return fail('Perjalanan tidak dapat dimulai.');
        const others = await tx.$queryRaw<Op[]>`SELECT * FROM "TripOperation" WHERE "driverId"=${actor.id} AND "status"='IN_PROGRESS' AND "tripId"<>${id}`;
        if (others.length) return fail('Akhiri perjalanan sebelumnya terlebih dahulu.');
        if (op.status !== 'IN_PROGRESS') await tx.$executeRaw`UPDATE "TripOperation" SET "status"='IN_PROGRESS', "startedAt"=NOW() WHERE "tripId"=${id}`;
      }
      const fresh = (await this.op(tx, id))!;
      return { tripId: id, driverId: actor.id, status: fresh.status, startedAt: iso(fresh.startedAt), endedAt: iso(fresh.endedAt) };
    });
  }
  async locations(id: string, body: LocationBatch, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const { trip, op } = await this.assigned(tx, id, actor);
      if (trip.status !== 'SCHEDULED' || op.status !== 'IN_PROGRESS') return fail('Perjalanan tidak sedang berjalan.');
      const now = Date.now();
      for (const s of body.samples) {
        const age = now - Date.parse(s.capturedAt);
        if (age < -60_000 || age > 86_400_000 || Date.parse(s.capturedAt) < op.startedAt!.getTime() - 60_000) return fail('Waktu sampel lokasi tidak valid.');
      }
      let accepted = 0;
      for (const s of body.samples) {
        accepted += await tx.$executeRaw`INSERT INTO "TripLocation" ("tripId","sampleId","lat","lng","accuracy","capturedAt") VALUES (${id},${s.sampleId},${s.lat},${s.lng},${s.accuracy},${new Date(s.capturedAt)}) ON CONFLICT DO NOTHING`;
      }
      // Operational GPS history is intentionally short-lived; the latest position remains for 24h.
      await tx.$executeRaw`DELETE FROM "TripLocation" WHERE "capturedAt" < NOW() - INTERVAL '24 hours'`;
      return { accepted, duplicates: body.samples.length - accepted };
    });
  }
  async tracking(date?: string, onlyTrip?: string) {
    const trips = await this.prisma.trip.findMany({ where: { ...(onlyTrip ? { id: onlyTrip } : { date: date || jakartaDate(new Date()), status: 'SCHEDULED' }) }, include: { bus: true, route: true }, orderBy: { departureAt: 'asc' } });
    const out: BusPosition[] = [];
    for (const t of trips) {
      const op = await this.op(this.prisma, t.id);
      const driver = op?.driverId ? await this.prisma.user.findUnique({ where: { id: op.driverId }, select: { name: true } }) : null;
      const rows = await this.prisma.$queryRaw<{ lat: number; lng: number; accuracy: number | null; capturedAt: Date }[]>`SELECT "lat","lng","accuracy","capturedAt" FROM "TripLocation" WHERE "tripId"=${t.id} AND "capturedAt">NOW()-INTERVAL '24 hours' ORDER BY "capturedAt" DESC LIMIT 1`;
      out.push({ tripId: t.id, busId: t.busId, busPlate: t.bus.plate, routeId: t.routeId, routeCode: t.route.code, routeColor: t.route.color, direction: t.direction as Direction, departureAt: toJakartaIso(t.departureAt.getTime()), execution: op?.status ?? 'NOT_STARTED', driverName: driver?.name ?? null, position: rows[0] ? { ...rows[0], capturedAt: toJakartaIso(rows[0].capturedAt.getTime()) } : null });
    }
    return out;
  }
  async myPosition(id: string, actor: Actor) {
    const b = await this.own(this.prisma, id, actor);
    if (b.status !== 'BOOKED') return fail('Booking ini tidak aktif.');
    return (await this.tracking(undefined, b.tripId!))[0];
  }
}
