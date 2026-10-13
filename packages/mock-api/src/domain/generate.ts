import { addDays, isPastCutoff, isoWeekday, type Subscription, type SubscriptionCreateResponse, type SubscriptionInput } from "@bms/shared";
import { DomainError, nextId, notify, nowIso, today, type Db } from "../db";
import { allocateSeat, cancelBooking, generateTrips, isSuspendedOn } from "./allocate";

export function subscriptionCovers(s: Subscription, date: string): boolean {
  return s.status === "ACTIVE" && date >= s.startDate && (s.endDate === null || date <= s.endDate) && s.weekdays.includes(isoWeekday(date));
}

const hasBooked = (db: Db, s: Subscription, date: string) =>
  db.bookings.some((b) => b.userId === s.userId && b.date === date && b.shiftId === s.shiftId && b.direction === s.direction && b.status === "BOOKED");

const cancelledOnPurpose = (db: Db, s: Subscription, date: string) =>
  db.bookings.some((b) => b.subscriptionId === s.id && b.date === date && (b.cancelReason === "USER" || b.cancelReason === "ADMIN_TRIP"));

/** Spec 5.2 step 2. Cron path: no cutoff check. */
export function generateSubscriptionBookings(db: Db, date: string): void {
  const subs = db.subscriptions.filter((s) => subscriptionCovers(s, date)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const s of subs) {
    const user = db.users.find((u) => u.id === s.userId)!;
    if (isSuspendedOn(user, date) || hasBooked(db, s, date) || cancelledOnPurpose(db, s, date)) continue;
    if (db.rejected.some((r) => r.subscriptionId === s.id && r.date === date)) continue;
    try {
      allocateSeat(db, { ...s, userId: s.userId, date, source: "SUBSCRIPTION", subscriptionId: s.id, fromCron: true });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      if (e.code === "TRIP_FULL") notify(db, s.userId, "SUBSCRIPTION_REJECTED", "Langganan tidak kebagian kursi", `Langganan tanggal ${date} tidak kebagian kursi. Coba booking harian.`, { date });
    }
  }
}

export function runGenerate(db: Db): void {
  for (let i = 0; i <= db.settings.generate_days_ahead; i++) {
    const date = addDays(today(db), i);
    generateTrips(db, date);
    generateSubscriptionBookings(db, date);
  }
}

const overlaps = (a: Subscription, b: SubscriptionInput) =>
  a.shiftId === b.shiftId && a.direction === b.direction &&
  (a.endDate === null || a.endDate >= b.startDate) && (b.endDate === null || b.endDate >= a.startDate) &&
  a.weekdays.some((d) => b.weekdays.includes(d));

/** Spec 5.3 create: book already-generated dates with cutoff check; later dates come from cron. */
export function createSubscription(db: Db, userId: string, input: SubscriptionInput): SubscriptionCreateResponse {
  if (db.subscriptions.some((s) => s.userId === userId && s.status === "ACTIVE" && overlaps(s, input))) {
    throw new DomainError("SCHEDULE_CONFLICT", "Langganan bentrok dengan langganan lain di shift dan arah yang sama.");
  }
  const subscription: Subscription = { id: nextId(db, "sub"), userId, ...input, status: "ACTIVE", createdAt: nowIso(db) };
  db.subscriptions.push(subscription);

  const res: SubscriptionCreateResponse = { subscription, booked: [], rejected: [], skippedCutoff: [] };
  const dates = [...new Set(db.trips
    .filter((t) => t.routeId === input.routeId && t.shiftId === input.shiftId && t.direction === input.direction)
    .map((t) => t.date))].filter((d) => subscriptionCovers(subscription, d)).sort();
  for (const date of dates) {
    try {
      allocateSeat(db, { ...input, userId, date, source: "SUBSCRIPTION", subscriptionId: subscription.id });
      res.booked.push(date);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      if (e.code === "CUTOFF_PASSED") res.skippedCutoff.push(date);
      else if (e.code === "TRIP_FULL") res.rejected.push(date);
      else if (e.code === "USER_SUSPENDED") break;
      // SCHEDULE_CONFLICT (daily booking exists) and NOT_FOUND: skip silently
    }
  }
  return res;
}

/** Spec 5.3 end. */
export function endSubscription(db: Db, userId: string, subscriptionId: string): Subscription {
  const s = db.subscriptions.find((x) => x.id === subscriptionId && x.userId === userId);
  if (!s) throw new DomainError("NOT_FOUND");
  s.status = "ENDED";
  s.endDate = today(db);
  for (const b of db.bookings.filter((x) => x.subscriptionId === s.id && x.status === "BOOKED")) {
    const trip = db.trips.find((t) => t.id === b.tripId)!;
    if (!isPastCutoff(trip.departureAt, db.settings.booking_cutoff_minutes, db.now())) cancelBooking(db, b, "SUBSCRIPTION_ENDED", { checkCutoff: false });
  }
  return s;
}
