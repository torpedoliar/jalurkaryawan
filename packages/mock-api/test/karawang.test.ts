import { describe, expect, test } from "vitest";
import { createKarawangDb } from "../src/karawang";

describe("Karawang browser demo", () => {
  test("employees retain leading zeros and all routes lead to Surya Cipta", () => {
    const db = createKarawangDb(() => new Date("2026-10-27T05:00:00+07:00"));
    const employees = db.users.filter((u) => u.role === "EMPLOYEE");
    expect(employees).toHaveLength(90);
    expect(employees[0]!.nik).toBe("00012345");
    expect(employees.every((u) => /^000\d{5}$/.test(u.nik))).toBe(true);
    expect(db.routes.every((r) => r.name.includes("PT. Santos Jaya Abadi (Surya Cipta)"))).toBe(true);
    expect(db.stops.every((s) => s.lat !== null && s.lng !== null)).toBe(true);
    expect(db.trips.length).toBeGreaterThan(0);
    expect(db.bookings.length).toBeGreaterThan(0);
    expect(db.ops.locations).toHaveLength(1);
    expect(db.ops.attendance).toHaveLength(1);
  });
});
