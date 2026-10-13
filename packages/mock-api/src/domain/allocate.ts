import { departureAt, isPastCutoff, isoWeekday, type BookingSource, type CancelReason, type Direction, type Trip } from "@bms/shared";
import { DomainError, nextId, nowIso, today, type BookingRow, type Db, type UserRow } from "../db";

export function isSuspendedOn(user: UserRow, date: string): boolean {
  return user.bookingSuspendedUntil !== null && date <= user.bookingSuspendedUntil;
}

/** Spec 5.2 step 1. Idempotent per (templateId, date). */
export function generateTrips(db: Db, date: string): Trip[] {
  const created: Trip[] = [];
  for (const t of db.templates) {
    if (!t.active || !t.weekdays.includes(isoWeekday(date))) continue;
    if (db.trips.some((x) => x.templateId === t.id && x.date === date)) continue;
    const bus = db.buses.find((b) => b.id === t.busId)!;
    const trip: Trip = {
      id: nextId(db, "t"), templateId: t.id, routeId: t.routeId, shiftId: t.shiftId, direction: t.direction,
      date, departureAt: departureAt(date, t.departureTime, t.dayOffset), busId: bus.id,
      capacity: bus.capacity, bookedCount: 0, status: "SCHEDULED",
    };
    db.trips.push(trip);
    created.push(trip);
  }
  return created;
}

export interface AllocateInput {
  userId: string; routeId: string; stopId: string; shiftId: string; direction: Direction; date: string;
  source: BookingSource; subscriptionId: string | null; fromCron?: boolean;
}

/** Spec 5.1. Synchronous, so the conditional increment is atomic like the SQL version. */
export function allocateSeat(db: Db, i: AllocateInput): BookingRow {
  const user = db.users.find((u) => u.id === i.userId);
  if (!user || !user.active) throw new DomainError("FORBIDDEN");
  // Spec 5.6: no new daily booking while suspended (any date). Subscription dates are per date, so they resume after `until` (spec 5.2).
  if (!i.fromCron && isSuspendedOn(user, i.source === "DAILY" ? today(db) : i.date)) throw new DomainError("USER_SUSPENDED");
  const stop = db.stops.find((s) => s.id === i.stopId);
  if (!stop || stop.routeId !== i.routeId || !stop.active) throw new DomainError("VALIDATION_ERROR", "Titik jemput tidak valid untuk rute ini.");
  if (db.bookings.some((b) => b.userId === i.userId && b.date === i.date && b.shiftId === i.shiftId && b.direction === i.direction && b.status === "BOOKED")) {
    throw new DomainError("SCHEDULE_CONFLICT");
  }

  const trips = db.trips
    .filter((t) => t.routeId === i.routeId && t.shiftId === i.shiftId && t.direction === i.direction && t.date === i.date && t.status === "SCHEDULED")
    .sort((a, b) => a.departureAt.localeCompare(b.departureAt) || a.id.localeCompare(b.id));
  if (trips.length === 0) throw new DomainError("NOT_FOUND", "Belum ada trip untuk pilihan ini.");
  const open = i.fromCron ? trips : trips.filter((t) => !isPastCutoff(t.departureAt, db.settings.booking_cutoff_minutes, db.now()));
  if (open.length === 0) throw new DomainError("CUTOFF_PASSED");

  const trip = open.find((t) => t.bookedCount < t.capacity);
  if (!trip) {
    db.rejected.push({
      id: nextId(db, "rj"), userId: i.userId, routeId: i.routeId, shiftId: i.shiftId, direction: i.direction,
      date: i.date, source: i.source, subscriptionId: i.subscriptionId, createdAt: nowIso(db),
    });
    throw new DomainError("TRIP_FULL");
  }
  trip.bookedCount++;
  const booking: BookingRow = {
    id: nextId(db, "bk"), userId: i.userId, tripId: trip.id, stopId: i.stopId, subscriptionId: i.subscriptionId,
    date: i.date, shiftId: i.shiftId, direction: i.direction, source: i.source, status: "BOOKED",
    cancelReason: null, cancelledAt: null, createdAt: nowIso(db),
  };
  db.bookings.push(booking);
  return booking;
}

/** Spec 5.5. checkCutoff false is for admin paths that ignore cutoff (deactivate, cancel trip). */
export function cancelBooking(db: Db, booking: BookingRow, reason: CancelReason, opts: { checkCutoff: boolean }): void {
  if (booking.status !== "BOOKED") return;
  const trip = db.trips.find((t) => t.id === booking.tripId)!;
  if (opts.checkCutoff && isPastCutoff(trip.departureAt, db.settings.booking_cutoff_minutes, db.now())) {
    throw new DomainError("CUTOFF_PASSED");
  }
  booking.status = "CANCELLED";
  booking.cancelReason = reason;
  booking.cancelledAt = nowIso(db);
  trip.bookedCount--;
}
