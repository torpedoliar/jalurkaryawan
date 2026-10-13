import { describe, expect, test } from "vitest";
import { allocateSeat, cancelBooking, generateTrips } from "../src/domain/allocate";
import { DomainError } from "../src/db";
import { pick, world } from "./fixture";

const D = "2026-10-14";
const req = (userId: string, extra = {}) => ({ ...pick, userId, date: D, source: "DAILY" as const, subscriptionId: null, ...extra });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("generateTrips", () => {
  test("idempotent, capacity from bus, departure from template", () => {
    const db = world();
    expect(generateTrips(db, D)).toHaveLength(2);
    expect(generateTrips(db, D)).toHaveLength(0);
    expect(db.trips[0]).toMatchObject({ date: D, capacity: 1, bookedCount: 0, status: "SCHEDULED", departureAt: "2026-10-14T05:00:00+07:00" });
  });

  test("skips inactive templates and weekdays not listed", () => {
    const db = world();
    db.templates[0]!.active = false;
    db.templates[1]!.weekdays = [1]; // Monday only; D is Wednesday
    expect(generateTrips(db, D)).toHaveLength(0);
  });
});

describe("allocateSeat", () => {
  test("fills earliest trip first, then next bus", () => {
    const db = world(); generateTrips(db, D);
    const a = allocateSeat(db, req("u1"));
    const b = allocateSeat(db, req("u2"));
    expect(db.trips.find((t) => t.id === a.tripId)!.departureAt).toContain("05:00");
    expect(db.trips.find((t) => t.id === b.tripId)!.departureAt).toContain("05:10");
  });

  test("all buses full -> TRIP_FULL and one rejected row", () => {
    const db = world(); generateTrips(db, D);
    allocateSeat(db, req("u1")); allocateSeat(db, req("u2"));
    expect(code(() => allocateSeat(db, req("u3")))).toBe("TRIP_FULL");
    expect(db.rejected).toHaveLength(1);
    expect(db.rejected[0]).toMatchObject({ userId: "u3", source: "DAILY", date: D });
    expect(db.trips.every((t) => t.bookedCount <= t.capacity)).toBe(true);
  });

  test("seats free but every trip past cutoff -> CUTOFF_PASSED, no rejected row", () => {
    const db = world("2026-10-14T03:30:00+07:00"); generateTrips(db, D); // cutoff 03:00 / 03:10
    expect(code(() => allocateSeat(db, req("u1")))).toBe("CUTOFF_PASSED");
    expect(db.rejected).toHaveLength(0);
  });

  test("only the later trip still open -> books it", () => {
    const db = world("2026-10-14T03:05:00+07:00"); generateTrips(db, D);
    const b = allocateSeat(db, req("u1"));
    expect(db.trips.find((t) => t.id === b.tripId)!.departureAt).toContain("05:10");
  });

  test("fromCron ignores cutoff", () => {
    const db = world("2026-10-14T04:00:00+07:00"); generateTrips(db, D);
    expect(allocateSeat(db, req("u1", { fromCron: true, source: "SUBSCRIPTION" })).status).toBe("BOOKED");
  });

  test("same user, date, shift, direction twice -> SCHEDULE_CONFLICT, no rejected row", () => {
    const db = world(); generateTrips(db, D);
    allocateSeat(db, req("u1"));
    expect(code(() => allocateSeat(db, req("u1", { stopId: "s2" })))).toBe("SCHEDULE_CONFLICT");
    expect(db.rejected).toHaveLength(0);
  });

  test("suspended user -> USER_SUSPENDED", () => {
    const db = world(); generateTrips(db, D);
    db.users[0]!.bookingSuspendedUntil = "2026-10-20";
    expect(code(() => allocateSeat(db, req("u1")))).toBe("USER_SUSPENDED");
  });

  test("suspension ended yesterday -> allowed", () => {
    const db = world(); generateTrips(db, D);
    db.users[0]!.bookingSuspendedUntil = "2026-10-13";
    expect(allocateSeat(db, req("u1")).status).toBe("BOOKED");
  });

  test("inactive stop or stop of another route -> VALIDATION_ERROR", () => {
    const db = world(); generateTrips(db, D);
    expect(code(() => allocateSeat(db, req("u1", { stopId: "s9" })))).toBe("VALIDATION_ERROR");
    expect(code(() => allocateSeat(db, req("u1", { stopId: "nope" })))).toBe("VALIDATION_ERROR");
  });

  test("no generated trip -> NOT_FOUND", () => {
    const db = world();
    expect(code(() => allocateSeat(db, req("u1")))).toBe("NOT_FOUND");
  });

  test("cancelled trip is never booked", () => {
    const db = world(); generateTrips(db, D);
    db.trips.forEach((t) => (t.status = "CANCELLED"));
    expect(code(() => allocateSeat(db, req("u1")))).toBe("NOT_FOUND");
  });
});

describe("cancelBooking", () => {
  test("frees the seat immediately", () => {
    const db = world(); generateTrips(db, D);
    const a = allocateSeat(db, req("u1")); allocateSeat(db, req("u2"));
    cancelBooking(db, a, "USER", { checkCutoff: true });
    expect(a).toMatchObject({ status: "CANCELLED", cancelReason: "USER" });
    expect(allocateSeat(db, req("u3")).tripId).toBe(a.tripId);
  });

  test("after cutoff -> CUTOFF_PASSED unless checkCutoff false", () => {
    const db = world(); generateTrips(db, D);
    const a = allocateSeat(db, req("u1"));
    db.now = () => new Date("2026-10-14T03:00:00+07:00");
    expect(code(() => cancelBooking(db, a, "USER", { checkCutoff: true }))).toBe("CUTOFF_PASSED");
    cancelBooking(db, a, "USER_DEACTIVATED", { checkCutoff: false });
    expect(a.status).toBe("CANCELLED");
  });
});
