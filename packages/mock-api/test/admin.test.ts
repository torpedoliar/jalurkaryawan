import { describe, expect, test } from "vitest";
import { allocateSeat, generateTrips } from "../src/domain/allocate";
import { createSubscription } from "../src/domain/generate";
import { cancelDate, cancelTrip, changeTripBus, deactivateUser, setBusCapacity, suspendUser, unsuspendUser } from "../src/domain/admin";
import { DomainError } from "../src/db";
import { pick, world } from "./fixture";

const D = "2026-10-15";
const daily = (userId: string) => ({ ...pick, userId, date: D, source: "DAILY" as const, subscriptionId: null });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("admin actions", () => {
  test("suspend cancels future bookings with SUSPENDED, blocks daily, notifies; unsuspend re-creates subscription seats", () => {
    const db = world();
    generateTrips(db, D);
    createSubscription(db, "u1", { ...pick, startDate: D, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    suspendUser(db, "adm", "u1", "2026-10-20", "No-show 3x");
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "SUSPENDED" });
    expect(code(() => allocateSeat(db, daily("u1")))).toBe("USER_SUSPENDED");
    expect(db.notifications.some((n) => n.userId === "u1" && n.type === "SUSPENDED")).toBe(true);
    expect(db.subscriptions[0]!.status).toBe("ACTIVE");

    unsuspendUser(db, "adm", "u1");
    expect(db.bookings.filter((b) => b.userId === "u1" && b.status === "BOOKED")).toHaveLength(1);
    expect(db.audit.map((a) => a.action)).toEqual(["USER_SUSPEND", "USER_UNSUSPEND"]);
  });

  test("change bus below booked -> CAPACITY_BELOW_BOOKED, otherwise capacity follows bus and passengers notified", () => {
    const db = world();
    db.buses[0]!.capacity = 40; generateTrips(db, D);
    const trip = db.trips[0]!;
    allocateSeat(db, daily("u1")); allocateSeat(db, daily("u2"));
    expect(code(() => changeTripBus(db, "adm", trip.id, "b2"))).toBe("CAPACITY_BELOW_BOOKED"); // b2 cap 1 < 2
    changeTripBus(db, "adm", trip.id, "b3");
    expect(trip).toMatchObject({ busId: "b3", capacity: 40 });
    expect(db.notifications.filter((n) => n.type === "BUS_CHANGED")).toHaveLength(2);
  });

  test("suspend: a past until is rejected; a daily booking after until is still blocked while suspended (spec 5.1/5.6)", () => {
    const db = world();
    generateTrips(db, "2026-10-21");
    expect(code(() => suspendUser(db, "adm", "u1", "2026-10-13", "x"))).toBe("VALIDATION_ERROR");
    suspendUser(db, "adm", "u1", "2026-10-15", "No-show 3x");
    expect(code(() => allocateSeat(db, { ...daily("u1"), date: "2026-10-21" }))).toBe("USER_SUSPENDED");
    const sub = createSubscription(db, "u1", { ...pick, startDate: "2026-10-21", endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    expect(sub.booked).toEqual(["2026-10-21"]); // subscription dates past `until` still book
  });

  test("unsuspend notifies when a re-created subscription seat is full", () => {
    const db = world();
    generateTrips(db, D);
    createSubscription(db, "u1", { ...pick, startDate: D, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    suspendUser(db, "adm", "u1", "2026-10-20", "x");
    allocateSeat(db, daily("u2")); allocateSeat(db, daily("u3")); // both 1-seat trips taken
    unsuspendUser(db, "adm", "u1");
    expect(db.notifications.filter((n) => n.userId === "u1" && n.type === "SUBSCRIPTION_REJECTED")).toHaveLength(1);
  });

  test("change bus: inactive bus is VALIDATION_ERROR; cancelled or departed trip cannot change or cancel", () => {
    const db = world();
    generateTrips(db, D);
    const [t1, t2] = db.trips as [typeof db.trips[0], typeof db.trips[0]];
    db.buses[2]!.active = false;
    expect(code(() => changeTripBus(db, "adm", t1.id, "b3"))).toBe("VALIDATION_ERROR");
    db.buses[2]!.active = true;
    cancelTrip(db, "adm", t1.id);
    expect(code(() => changeTripBus(db, "adm", t1.id, "b3"))).toBe("VALIDATION_ERROR");
    db.now = () => new Date("2026-10-15T06:00:00+07:00"); // both departed
    expect(code(() => changeTripBus(db, "adm", t2.id, "b3"))).toBe("VALIDATION_ERROR");
    expect(code(() => cancelTrip(db, "adm", t2.id))).toBe("VALIDATION_ERROR");
    expect(cancelDate(db, "adm", D)).toBe(0);
    expect(t2.status).toBe("SCHEDULED");
  });

  test("bus capacity change applies to future scheduled trips, rejects when a trip would overflow", () => {
    const db = world();
    db.buses[0]!.capacity = 5; generateTrips(db, D);
    allocateSeat(db, daily("u1")); allocateSeat(db, daily("u2"));
    expect(code(() => setBusCapacity(db, "adm", "b1", 1))).toBe("CAPACITY_BELOW_BOOKED");
    setBusCapacity(db, "adm", "b1", 3);
    expect(db.trips.find((t) => t.busId === "b1")!.capacity).toBe(3);
  });

  test("cancel trip cancels bookings with ADMIN_TRIP ignoring cutoff; cancel date cancels all trips", () => {
    const db = world();
    generateTrips(db, D);
    allocateSeat(db, daily("u1"));
    db.now = () => new Date("2026-10-15T04:59:00+07:00"); // past cutoff
    cancelTrip(db, "adm", db.trips[0]!.id);
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "ADMIN_TRIP" });
    expect(db.notifications.some((n) => n.type === "TRIP_CANCELLED")).toBe(true);
    expect(cancelDate(db, "adm", D)).toBe(1); // only the remaining scheduled trip
    expect(db.trips.every((t) => t.status === "CANCELLED")).toBe(true);
  });

  test("deactivate cancels all future bookings, ends subscriptions, kills sessions", () => {
    const db = world();
    generateTrips(db, D);
    createSubscription(db, "u1", { ...pick, startDate: D, endDate: null, weekdays: [4] });
    db.sessions.set("tok", "u1");
    deactivateUser(db, "adm", "u1");
    expect(db.users[0]!.active).toBe(false);
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "USER_DEACTIVATED" });
    expect(db.subscriptions[0]!.status).toBe("ENDED");
    expect(db.sessions.has("tok")).toBe(false);
  });
});
