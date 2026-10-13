import { describe, expect, test } from "vitest";
import { allocateSeat, cancelBooking, generateTrips } from "../src/domain/allocate";
import { createSubscription, endSubscription, generateSubscriptionBookings, runGenerate } from "../src/domain/generate";
import { DomainError } from "../src/db";
import { pick, world } from "./fixture";

const D = "2026-10-14"; // Wednesday
const sub = (extra = {}) => ({ ...pick, startDate: D, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7], ...extra });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("generation", () => {
  test("runGenerate builds today..today+N, idempotent", () => {
    const db = world();
    db.settings.generate_days_ahead = 2;
    runGenerate(db); runGenerate(db);
    expect(db.trips).toHaveLength(6); // 2 templates x 3 days
  });

  test("subscriptions get seats before daily, ordered by created_at, full -> rejected + notification once", () => {
    const db = world();
    for (const u of ["u1", "u2", "u3"]) createSubscription(db, u, sub({ startDate: "2026-10-15" }));
    generateTrips(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings.filter((b) => b.status === "BOOKED").map((b) => b.userId)).toEqual(["u1", "u2"]);
    expect(db.rejected).toHaveLength(1);
    expect(db.notifications.filter((n) => n.userId === "u3")).toHaveLength(1);
  });

  test("user-cancelled day is not re-created; suspended-cancelled day is", () => {
    const db = world();
    const { subscription } = createSubscription(db, "u1", sub({ startDate: "2026-10-15" }));
    generateTrips(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    const b = db.bookings[0]!;
    cancelBooking(db, b, "USER", { checkCutoff: true });
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings.filter((x) => x.status === "BOOKED")).toHaveLength(0);
    b.cancelReason = "SUSPENDED";
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings.filter((x) => x.status === "BOOKED" && x.subscriptionId === subscription.id)).toHaveLength(1);
  });

  test("weekday filter and suspended user skipped", () => {
    const db = world();
    createSubscription(db, "u1", sub({ startDate: "2026-10-15", weekdays: [1] })); // 15th is Thursday
    createSubscription(db, "u2", sub({ startDate: "2026-10-15" }));
    db.users[1]!.bookingSuspendedUntil = "2026-10-15";
    generateTrips(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings).toHaveLength(0);
  });
});

describe("createSubscription", () => {
  test("books already-generated dates, skips past-cutoff dates", () => {
    const db = world("2026-10-14T03:30:00+07:00");
    generateTrips(db, D); generateTrips(db, "2026-10-15");
    const r = createSubscription(db, "u1", sub());
    expect(r.skippedCutoff).toEqual([D]);
    expect(r.booked).toEqual(["2026-10-15"]);
  });

  test("overlapping subscription -> SCHEDULE_CONFLICT; other direction OK", () => {
    const db = world();
    createSubscription(db, "u1", sub({ weekdays: [1, 2] }));
    expect(code(() => createSubscription(db, "u1", sub({ weekdays: [2, 3] })))).toBe("SCHEDULE_CONFLICT");
    expect(code(() => createSubscription(db, "u1", sub({ weekdays: [3] })))).toBe("OK");
    expect(code(() => createSubscription(db, "u1", sub({ direction: "DROPOFF", weekdays: [1] })))).toBe("OK");
  });

  test("end cancels future bookings before cutoff and sets ENDED", () => {
    const db = world();
    generateTrips(db, "2026-10-15");
    const { subscription } = createSubscription(db, "u1", sub({ startDate: "2026-10-15" }));
    const s = endSubscription(db, "u1", subscription.id);
    expect(s).toMatchObject({ status: "ENDED", endDate: D });
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "SUBSCRIPTION_ENDED" });
  });

  test("a daily booking blocks the subscription date silently", () => {
    const db = world();
    generateTrips(db, "2026-10-15");
    allocateSeat(db, { ...pick, userId: "u1", date: "2026-10-15", source: "DAILY", subscriptionId: null });
    const r = createSubscription(db, "u1", sub({ startDate: "2026-10-15" }));
    expect(r.booked).toEqual([]);
    expect(db.bookings).toHaveLength(1);
  });
});
