import {
  ADMIN_ROLES, AssignDriverRequest, BUS_QR_PREFIX, CHECKIN_CLOSE_AFTER_MIN, CHECKIN_OPEN_BEFORE_MIN, DriverCheckinRequest,
  ENDPOINTS, IsoDate, LocationBatch, SELF_SERVICE_ROLES, SelfCheckinRequest, TICKET_QR_PREFIX,
  type Attendance, type BusPosition, type CheckinMethod, type CheckinResult, type DriverManifestRow, type DriverTrip,
  type TripExecution, type TripAttendanceRow,
} from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, audit, nowIso, today, type BookingRow, type Db, type UserRow } from "../db";
import { handle, parseBody, type Ctx } from "../http";
import { find, p, q, toBooking } from "./util";

const admin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
const driver = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ["DRIVER"] });
const rider = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: SELF_SERVICE_ROLES });

/** Mock-only opaque secret: unpredictable enough for demo data, never an id. Real backend stores only a hash. */
const secret = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};
const MIN = 60_000;

function busQr(db: Db, busId: string) {
  let row = db.ops.busQr.get(busId);
  if (!row) { row = { qr: BUS_QR_PREFIX + secret(), rotatedAt: nowIso(db) }; db.ops.busQr.set(busId, row); }
  return row;
}

/** The trip the driver may act on: assigned to them and not cancelled. */
function assignedTrip(ctx: Ctx, u: UserRow) {
  const trip = find(ctx.db.trips, ctx.params.id);
  if (ctx.db.ops.tripDrivers.get(trip.id) !== u.id) throw new DomainError("FORBIDDEN", "Trip ini bukan tugas kamu.");
  return trip;
}

function ownBooking(ctx: Ctx, u: UserRow): BookingRow {
  const b = find(ctx.db.bookings, ctx.params.id);
  if (b.userId !== u.id) throw new DomainError("NOT_FOUND");
  return b;
}

const execution = (db: Db, tripId: string) => db.ops.executions.find((e) => e.tripId === tripId);

/**
 * The one check-in path both scan directions share: validates booking state and the time window,
 * then records attendance exactly once. A repeat returns the original record.
 */
function checkIn(db: Db, b: BookingRow, method: CheckinMethod, actorId: string): CheckinResult {
  const view = toBooking(db, b);
  const passenger = { name: find(db.users, b.userId).name, stopName: view.stopName, pickupAt: view.pickupAt };
  const existing = db.ops.attendance.find((a) => a.bookingId === b.id);
  if (existing) return { attendance: existing, alreadyCheckedIn: true, passenger };
  if (b.status !== "BOOKED") throw new DomainError("VALIDATION_ERROR", "Booking ini tidak aktif (dibatalkan atau tidak hadir).");
  const trip = find(db.trips, b.tripId);
  if (trip.status !== "SCHEDULED") throw new DomainError("VALIDATION_ERROR", "Trip ini dibatalkan.");
  if (execution(db, trip.id)?.status === "COMPLETED") throw new DomainError("VALIDATION_ERROR", "Perjalanan sudah selesai; check-in ditutup.");
  const now = db.now().getTime();
  const at = Date.parse(view.pickupAt);
  if (now < at - CHECKIN_OPEN_BEFORE_MIN * MIN) throw new DomainError("VALIDATION_ERROR", `Check-in dibuka ${CHECKIN_OPEN_BEFORE_MIN} menit sebelum jam jemput.`);
  if (now > at + CHECKIN_CLOSE_AFTER_MIN * MIN) throw new DomainError("VALIDATION_ERROR", "Waktu check-in untuk trip ini sudah lewat.");
  const attendance: Attendance = { bookingId: b.id, tripId: trip.id, busId: trip.busId, checkedInAt: nowIso(db), method };
  db.ops.attendance.push(attendance);
  audit(db, actorId, "CHECKIN", "booking", b.id, null, attendance);
  return { attendance, alreadyCheckedIn: false, passenger };
}

function position(db: Db, tripId: string): BusPosition {
  const t = find(db.trips, tripId);
  const route = find(db.routes, t.routeId);
  const ex = execution(db, t.id);
  const driverId = db.ops.tripDrivers.get(t.id);
  const last = db.ops.locations.filter((l) => l.tripId === t.id).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  return {
    tripId: t.id, busId: t.busId, busPlate: find(db.buses, t.busId).plate, routeId: route.id, routeCode: route.code, routeColor: route.color,
    direction: t.direction, departureAt: t.departureAt, execution: ex?.status ?? "NOT_STARTED",
    driverName: driverId ? find(db.users, driverId).name : null,
    position: last ? { lat: last.lat, lng: last.lng, accuracy: last.accuracy, capturedAt: last.capturedAt } : null,
  };
}

export const operationHandlers = [
  // ---------- QR
  http.get(p(ENDPOINTS.ticketQr(":id")), handle((ctx) => {
    const b = ownBooking(ctx, rider(ctx));
    if (b.status !== "BOOKED" || find(ctx.db.trips, b.tripId).status !== "SCHEDULED") throw new DomainError("VALIDATION_ERROR", "Booking ini tidak aktif.");
    let qr = ctx.db.ops.ticketQr.get(b.id);
    if (!qr) { qr = TICKET_QR_PREFIX + secret(); ctx.db.ops.ticketQr.set(b.id, qr); }
    const expiresAt = new Date(Date.parse(toBooking(ctx.db, b).pickupAt) + CHECKIN_CLOSE_AFTER_MIN * MIN).toISOString();
    return { bookingId: b.id, qr, expiresAt };
  })),
  http.get(p(ENDPOINTS.busQr(":id")), handle((ctx) => {
    admin(ctx);
    const bus = find(ctx.db.buses, ctx.params.id);
    const row = busQr(ctx.db, bus.id);
    return { busId: bus.id, plate: bus.plate, ...row };
  })),
  http.post(p(ENDPOINTS.busQrRotate(":id")), handle((ctx) => {
    const u = admin(ctx);
    const bus = find(ctx.db.buses, ctx.params.id);
    const row = { qr: BUS_QR_PREFIX + secret(), rotatedAt: nowIso(ctx.db) };
    ctx.db.ops.busQr.set(bus.id, row);
    audit(ctx.db, u.id, "BUS_QR_ROTATE", "bus", bus.id, null, { rotatedAt: row.rotatedAt });
    return { busId: bus.id, plate: bus.plate, ...row };
  })),

  // ---------- attendance
  http.post(p(ENDPOINTS.selfCheckin(":id")), handle(async (ctx) => {
    const u = rider(ctx);
    const b = ownBooking(ctx, u);
    const { qr } = await parseBody(ctx.request, SelfCheckinRequest);
    const trip = find(ctx.db.trips, b.tripId);
    // Validate against the trip's CURRENT bus, so an admin bus swap moves self check-in with it.
    if (ctx.db.ops.busQr.get(trip.busId)?.qr !== qr) throw new DomainError("VALIDATION_ERROR", "QR ini bukan untuk bus trip kamu.");
    return checkIn(ctx.db, b, "EMPLOYEE_BUS_QR", u.id);
  })),
  http.post(p(ENDPOINTS.driverCheckin(":id")), handle(async (ctx) => {
    const u = driver(ctx);
    const trip = assignedTrip(ctx, u);
    const { qr, method } = await parseBody(ctx.request, DriverCheckinRequest);
    const bookingId = [...ctx.db.ops.ticketQr].find(([, v]) => v === qr)?.[0];
    if (!bookingId) throw new DomainError("VALIDATION_ERROR", "QR tiket tidak dikenal.");
    const b = find(ctx.db.bookings, bookingId);
    if (b.tripId !== trip.id) throw new DomainError("VALIDATION_ERROR", "Tiket ini bukan untuk trip ini.");
    return checkIn(ctx.db, b, method, u.id);
  })),
  http.get(p(ENDPOINTS.tripAttendance(":id")), handle((ctx) => {
    admin(ctx);
    const trip = find(ctx.db.trips, ctx.params.id);
    return ctx.db.ops.attendance.filter((a) => a.tripId === trip.id)
      .map(({ bookingId, checkedInAt, method }): TripAttendanceRow => ({ bookingId, checkedInAt, method }));
  })),

  // ---------- driver
  http.put(p(ENDPOINTS.tripDriver(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const trip = find(ctx.db.trips, ctx.params.id);
    const { driverId } = await parseBody(ctx.request, AssignDriverRequest);
    const before = ctx.db.ops.tripDrivers.get(trip.id) ?? null;
    if (execution(ctx.db, trip.id)?.status === "IN_PROGRESS") throw new DomainError("VALIDATION_ERROR", "Akhiri perjalanan sebelum mengganti sopir.");
    if (driverId === null) ctx.db.ops.tripDrivers.delete(trip.id);
    else {
      const d = find(ctx.db.users, driverId);
      if (d.role !== "DRIVER" || !d.active) throw new DomainError("VALIDATION_ERROR", "Akun ini bukan sopir aktif.");
      if (d.vendorId !== find(ctx.db.buses, trip.busId).vendorId) throw new DomainError("VALIDATION_ERROR", "Sopir harus dari vendor yang sama dengan bus.");
      ctx.db.ops.tripDrivers.set(trip.id, d.id);
    }
    audit(ctx.db, u.id, "TRIP_ASSIGN_DRIVER", "trip", trip.id, { driverId: before }, { driverId });
    return trip;
  })),
  http.get(p(ENDPOINTS.driverTrips), handle((ctx) => {
    const u = driver(ctx);
    const date = IsoDate.parse(q(ctx.url, "date") ?? today(ctx.db));
    return ctx.db.trips
      .filter((t) => t.date === date && ctx.db.ops.tripDrivers.get(t.id) === u.id)
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt))
      .map((t): DriverTrip => {
        const route = find(ctx.db.routes, t.routeId);
        const ex = execution(ctx.db, t.id);
        return {
          tripId: t.id, date: t.date, departureAt: t.departureAt, direction: t.direction,
          routeCode: route.code, routeName: route.name, routeColor: route.color, shiftName: find(ctx.db.shifts, t.shiftId).name,
          busId: t.busId, busPlate: find(ctx.db.buses, t.busId).plate, cancelled: t.status === "CANCELLED",
          bookedCount: t.bookedCount, checkedInCount: ctx.db.ops.attendance.filter((a) => a.tripId === t.id).length,
          execution: ex?.status ?? "NOT_STARTED", startedAt: ex?.startedAt ?? null, endedAt: ex?.endedAt ?? null,
        };
      });
  })),
  http.get(p(ENDPOINTS.driverManifest(":id")), handle((ctx) => {
    const trip = assignedTrip(ctx, driver(ctx));
    return ctx.db.bookings
      .filter((b) => b.tripId === trip.id && b.status !== "CANCELLED")
      .map((b): DriverManifestRow => {
        const view = toBooking(ctx.db, b);
        const a = ctx.db.ops.attendance.find((x) => x.bookingId === b.id);
        return {
          bookingId: b.id, name: find(ctx.db.users, b.userId).name, stopName: view.stopName, stopSeq: find(ctx.db.stops, b.stopId).seq,
          pickupAt: view.pickupAt, checkedIn: !!a, checkedInAt: a?.checkedInAt ?? null, method: a?.method ?? null,
        };
      })
      .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt) || a.name.localeCompare(b.name));
  })),
  http.post(p(ENDPOINTS.tripStart(":id")), handle((ctx) => {
    const u = driver(ctx);
    const trip = assignedTrip(ctx, u);
    if (trip.status === "CANCELLED") throw new DomainError("VALIDATION_ERROR", "Trip ini dibatalkan.");
    if (ctx.db.ops.executions.some((e) => e.driverId === u.id && e.tripId !== trip.id && e.status === "IN_PROGRESS")) throw new DomainError("VALIDATION_ERROR", "Akhiri perjalanan sebelumnya terlebih dahulu.");
    let ex = execution(ctx.db, trip.id);
    if (ex?.status === "COMPLETED") throw new DomainError("VALIDATION_ERROR", "Perjalanan ini sudah selesai.");
    if (!ex) { ex = { tripId: trip.id, driverId: u.id, status: "IN_PROGRESS", startedAt: nowIso(ctx.db), endedAt: null }; ctx.db.ops.executions.push(ex); }
    return ex satisfies TripExecution;
  })),
  http.post(p(ENDPOINTS.tripEnd(":id")), handle((ctx) => {
    const trip = assignedTrip(ctx, driver(ctx));
    const ex = execution(ctx.db, trip.id);
    if (!ex) throw new DomainError("VALIDATION_ERROR", "Perjalanan belum dimulai.");
    if (ex.status === "IN_PROGRESS") Object.assign(ex, { status: "COMPLETED", endedAt: nowIso(ctx.db) });
    return ex satisfies TripExecution;
  })),
  http.post(p(ENDPOINTS.tripLocations(":id")), handle(async (ctx) => {
    const trip = assignedTrip(ctx, driver(ctx));
    if (execution(ctx.db, trip.id)?.status !== "IN_PROGRESS") throw new DomainError("VALIDATION_ERROR", "Perjalanan tidak sedang berjalan.");
    const { samples } = await parseBody(ctx.request, LocationBatch);
    // Validate the whole batch before inserting any sample.
    for (const s of samples) {
      const age = ctx.db.now().getTime() - Date.parse(s.capturedAt);
      if (age < -60_000 || age > 24 * 60 * 60_000) throw new DomainError("VALIDATION_ERROR", "Waktu sampel lokasi tidak valid.");
    }
    let accepted = 0, duplicates = 0;
    for (const s of samples) {
      if (ctx.db.ops.locations.some((l) => l.tripId === trip.id && l.sampleId === s.sampleId)) { duplicates++; continue; }
      ctx.db.ops.locations.push({ tripId: trip.id, sampleId: s.sampleId, lat: s.lat, lng: s.lng, accuracy: s.accuracy, capturedAt: s.capturedAt });
      accepted++;
    }
    return { accepted, duplicates };
  })),

  // ---------- tracking reads
  http.get(p(ENDPOINTS.tracking), handle((ctx) => {
    admin(ctx);
    const date = IsoDate.parse(q(ctx.url, "date") ?? today(ctx.db));
    return ctx.db.trips.filter((t) => t.date === date && t.status === "SCHEDULED")
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt))
      .map((t) => position(ctx.db, t.id));
  })),
  http.get(p(ENDPOINTS.myBusPosition(":id")), handle((ctx) => {
    const b = ownBooking(ctx, rider(ctx));
    if (b.status !== "BOOKED") throw new DomainError("VALIDATION_ERROR", "Booking ini tidak aktif.");
    return position(ctx.db, b.tripId);
  })),
];
