import { isPastCutoff } from "@bms/shared";
import { DomainError, audit, notify, today, type Db } from "../db";
import { allocateSeat, cancelBooking } from "./allocate";
import { subscriptionCovers } from "./generate";

const notDeparted = (db: Db, departureAt: string) => Date.parse(departureAt) > db.now().getTime();
const user = (db: Db, id: string) => {
  const u = db.users.find((x) => x.id === id);
  if (!u) throw new DomainError("NOT_FOUND");
  return u;
};
const futureBooked = (db: Db, userId: string) => db.bookings.filter((b) => {
  const t = db.trips.find((x) => x.id === b.tripId)!;
  return b.userId === userId && b.status === "BOOKED" && notDeparted(db, t.departureAt);
});
const passengersOf = (db: Db, tripId: string) => db.bookings.filter((b) => b.tripId === tripId && b.status === "BOOKED");

export function suspendUser(db: Db, actorId: string, userId: string, until: string, reason: string): void {
  const u = user(db, userId);
  const before = { bookingSuspendedUntil: u.bookingSuspendedUntil, suspendReason: u.suspendReason };
  u.bookingSuspendedUntil = until;
  u.suspendReason = reason;
  // Spec 5.6: every booking not past cutoff is cancelled; nightly runGenerate re-creates subscription seats after `until`.
  for (const b of futureBooked(db, userId)) {
    const t = db.trips.find((x) => x.id === b.tripId)!;
    if (!isPastCutoff(t.departureAt, db.settings.booking_cutoff_minutes, db.now())) cancelBooking(db, b, "SUSPENDED", { checkCutoff: false });
  }
  notify(db, userId, "SUSPENDED", "Booking dibekukan", `Booking kamu dibekukan sampai ${until}. Alasan: ${reason}`, { until });
  audit(db, actorId, "USER_SUSPEND", "user", userId, before, { bookingSuspendedUntil: until, suspendReason: reason });
}

/** Re-create subscription seats on already-generated dates, with cutoff check (spec 5.6). */
export function unsuspendUser(db: Db, actorId: string, userId: string): void {
  const u = user(db, userId);
  const before = { bookingSuspendedUntil: u.bookingSuspendedUntil, suspendReason: u.suspendReason };
  u.bookingSuspendedUntil = null;
  u.suspendReason = null;
  const dates = [...new Set(db.trips.map((t) => t.date))].filter((d) => d >= today(db)).sort();
  for (const s of db.subscriptions.filter((x) => x.userId === userId)) {
    for (const date of dates.filter((d) => subscriptionCovers(s, d))) {
      const purposely = db.bookings.some((b) => b.subscriptionId === s.id && b.date === date && (b.cancelReason === "USER" || b.cancelReason === "ADMIN_TRIP"));
      if (purposely) continue;
      try {
        allocateSeat(db, { ...s, userId, date, source: "SUBSCRIPTION", subscriptionId: s.id });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
      }
    }
  }
  notify(db, userId, "UNSUSPENDED", "Pembekuan dicabut", "Booking kamu aktif kembali.");
  audit(db, actorId, "USER_UNSUSPEND", "user", userId, before, { bookingSuspendedUntil: null, suspendReason: null });
}

export function deactivateUser(db: Db, actorId: string, userId: string): void {
  const u = user(db, userId);
  u.active = false;
  for (const b of futureBooked(db, userId)) cancelBooking(db, b, "USER_DEACTIVATED", { checkCutoff: false });
  for (const s of db.subscriptions.filter((x) => x.userId === userId && x.status === "ACTIVE")) {
    s.status = "ENDED";
    s.endDate = today(db);
  }
  for (const [tok, uid] of db.sessions) if (uid === userId) db.sessions.delete(tok);
  audit(db, actorId, "USER_DEACTIVATE", "user", userId, { active: true }, { active: false });
}

export function changeTripBus(db: Db, actorId: string, tripId: string, busId: string): void {
  const trip = db.trips.find((t) => t.id === tripId);
  const bus = db.buses.find((b) => b.id === busId && b.active);
  if (!trip || !bus) throw new DomainError("NOT_FOUND");
  if (bus.capacity < trip.bookedCount) throw new DomainError("CAPACITY_BELOW_BOOKED", `Bus ${bus.plate} hanya ${bus.capacity} kursi, sudah ${trip.bookedCount} booking.`);
  const before = { busId: trip.busId, capacity: trip.capacity };
  trip.busId = bus.id;
  trip.capacity = bus.capacity;
  for (const b of passengersOf(db, tripId)) notify(db, b.userId, "BUS_CHANGED", "Bus diganti", `Trip ${trip.date} sekarang memakai bus ${bus.plate}.`, { tripId });
  audit(db, actorId, "TRIP_CHANGE_BUS", "trip", tripId, before, { busId: bus.id, capacity: bus.capacity });
}

export function setBusCapacity(db: Db, actorId: string, busId: string, capacity: number): void {
  const bus = db.buses.find((b) => b.id === busId);
  if (!bus) throw new DomainError("NOT_FOUND");
  const affected = db.trips.filter((t) => t.busId === busId && t.status === "SCHEDULED" && notDeparted(db, t.departureAt));
  const bad = affected.find((t) => t.bookedCount > capacity);
  if (bad) throw new DomainError("CAPACITY_BELOW_BOOKED", `Trip ${bad.date} ${bad.departureAt.slice(11, 16)} sudah ${bad.bookedCount} booking.`);
  const before = { capacity: bus.capacity };
  bus.capacity = capacity;
  for (const t of affected) t.capacity = capacity;
  audit(db, actorId, "BUS_CAPACITY", "bus", busId, before, { capacity });
}

export function cancelTrip(db: Db, actorId: string, tripId: string): void {
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) throw new DomainError("NOT_FOUND");
  if (trip.status === "CANCELLED") return;
  for (const b of passengersOf(db, tripId)) {
    cancelBooking(db, b, "ADMIN_TRIP", { checkCutoff: false });
    notify(db, b.userId, "TRIP_CANCELLED", "Trip dibatalkan", `Trip ${trip.date} jam ${trip.departureAt.slice(11, 16)} dibatalkan admin.`, { tripId });
  }
  trip.status = "CANCELLED";
  audit(db, actorId, "TRIP_CANCEL", "trip", tripId, { status: "SCHEDULED" }, { status: "CANCELLED" });
}

export function cancelDate(db: Db, actorId: string, date: string): number {
  const trips = db.trips.filter((t) => t.date === date && t.status === "SCHEDULED");
  for (const t of trips) cancelTrip(db, actorId, t.id);
  return trips.length;
}

// ponytail: template edits are not propagated to generated trips in the mock; backend (Plan 4) implements spec 5.6.
