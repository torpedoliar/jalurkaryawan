import {
  cutoffAt, departureStatus, stopTime,
  type Booking, type Departure, type Passenger, type UserSummary,
} from "@bms/shared";
import { DomainError, audit, nextId, type BookingRow, type Db, type UserRow } from "../db";

/** Match any origin: Vite dev server, http://localhost in tests, Expo dev URL. */
export const p = (path: string) => `*${path}`;

export function find<T extends { id: string }>(rows: T[], id: string | undefined): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new DomainError("NOT_FOUND");
  return row;
}

export const q = (url: URL, key: string): string | null => url.searchParams.get(key) || null;

export function paginate<T>(rows: T[], url: URL, pageSize = 50) {
  const page = Math.max(1, Number(q(url, "page") ?? 1) || 1);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** Audited insert for master data. */
export function insert<T extends { id: string }>(db: Db, actorId: string, rows: T[], prefix: string, entity: string, input: Omit<T, "id">): T {
  const row = { id: nextId(db, prefix), ...input } as T;
  rows.push(row);
  audit(db, actorId, `${entity.toUpperCase()}_CREATE`, entity, row.id, null, row);
  return row;
}

/** Audited in-place update; `before` is a shallow copy taken first. */
export function update<T extends { id: string }>(db: Db, actorId: string, row: T, entity: string, input: Partial<T>): T {
  const before = { ...row };
  Object.assign(row, input);
  audit(db, actorId, `${entity.toUpperCase()}_UPDATE`, entity, row.id, before, row);
  return row;
}

export const toSummary = ({ password: _p, mustChangePassword: _m, failedLogins: _f, ...u }: UserRow): UserSummary => u;

export const notDeparted = (db: Db, departureAt: string) => Date.parse(departureAt) > db.now().getTime();

/** Ticket card view (contract `Booking`). */
export function toBooking(db: Db, b: BookingRow): Booking {
  const trip = find(db.trips, b.tripId);
  const route = find(db.routes, trip.routeId);
  const stop = find(db.stops, b.stopId);
  const lastOffset = Math.max(...db.stops.filter((s) => s.routeId === route.id).map((s) => s.offsetMinutes));
  return {
    ...b,
    routeCode: route.code, routeName: route.name, routeColor: route.color, stopName: stop.name,
    busPlate: find(db.buses, trip.busId).plate, departureAt: trip.departureAt,
    pickupAt: stopTime(trip.departureAt, trip.direction, stop.offsetMinutes, lastOffset),
    cutoffAt: cutoffAt(trip.departureAt, db.settings.booking_cutoff_minutes),
    seatsLeft: trip.capacity - trip.bookedCount, capacity: trip.capacity,
  };
}

/** Manifest row (contract `Passenger`). */
export function toPassenger(db: Db, b: BookingRow): Passenger {
  const view = toBooking(db, b);
  const u = find(db.users, b.userId);
  const stop = find(db.stops, b.stopId);
  return { bookingId: b.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone, stopName: stop.name, stopSeq: stop.seq, pickupAt: view.pickupAt };
}

/** Departure board row. `mine` = caller holds a BOOKED seat on it. No passenger data. */
export function toDeparture(db: Db, tripId: string, userId: string): Departure {
  const t = find(db.trips, tripId);
  const route = find(db.routes, t.routeId);
  return {
    tripId: t.id, date: t.date, departureAt: t.departureAt, direction: t.direction,
    routeId: route.id, routeCode: route.code, routeName: route.name, routeColor: route.color,
    shiftId: t.shiftId, shiftName: find(db.shifts, t.shiftId).name, busPlate: find(db.buses, t.busId).plate,
    capacity: t.capacity, bookedCount: t.bookedCount, status: departureStatus(t.status, t.capacity, t.bookedCount),
    mine: db.bookings.some((b) => b.tripId === t.id && b.userId === userId && b.status === "BOOKED"),
  };
}