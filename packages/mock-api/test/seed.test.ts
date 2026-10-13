import { describe, expect, test } from "vitest";
import { login } from "../src/auth";
import { DEMO_PASSWORD, createSeededDb } from "../src/seed";

const NOW = () => new Date("2026-10-14T00:00:00+07:00");

describe("seed", () => {
  const db = createSeededDb(NOW);
  const trip = (routeId: string, shiftId: string, direction: string, date = "2026-10-14") =>
    db.trips.find((t) => t.routeId === routeId && t.shiftId === shiftId && t.direction === direction && t.date === date)!;

  test("six colored routes, three shifts, night drop-off next day", () => {
    expect(db.routes.map((r) => [r.code, r.name, r.color])).toEqual([
      ["R1", "Cikarang", "#D6322B"], ["R2", "Bekasi Timur", "#1F6FD1"], ["R3", "Karawang", "#169B62"],
      ["R4", "Tambun", "#E07A00"], ["R5", "Cibitung", "#7A3FC2"], ["R6", "Jababeka", "#0E9AA7"],
    ]);
    expect(db.shifts.map((s) => s.name)).toEqual(["Pagi", "Siang", "Malam"]);
    expect(db.stops.filter((s) => s.routeId === "r1").map((s) => s.offsetMinutes)).toEqual([0, 15, 30]);
    expect(trip("r1", "malam", "DROPOFF").departureAt).toBe("2026-10-15T07:10:00+07:00");
    expect(trip("r2", "pagi", "PICKUP").departureAt).toBe("2026-10-14T05:25:00+07:00");
  });

  test("trips for today..today+generate_days_ahead with subscription bookings", () => {
    expect([...new Set(db.trips.map((t) => t.date))].sort()).toEqual([
      "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21",
    ]);
    expect(db.trips).toHaveLength(8 * 6 * 6);
    expect(trip("r1", "pagi", "PICKUP")).toMatchObject({ capacity: 8, bookedCount: 8 });
    expect(db.rejected.filter((r) => r.routeId === "r1" && r.date === "2026-10-14" && r.direction === "PICKUP")).toHaveLength(2);
    expect(trip("r4", "pagi", "PICKUP")).toMatchObject({ capacity: 11, bookedCount: 10 });
    expect(trip("r2", "siang", "DROPOFF").bookedCount).toBeGreaterThan(0);
  });

  test("suspended employee has no bookings during suspension", () => {
    const u = db.users.find((x) => x.nik === "K1059")!;
    expect(u.bookingSuspendedUntil).toBe("2026-10-17");
    expect(db.bookings.some((b) => b.userId === u.id && b.date <= "2026-10-17")).toBe(false);
    expect(db.bookings.some((b) => b.userId === u.id && b.date === "2026-10-18")).toBe(true);
  });

  test("demo accounts log in with DEMO_PASSWORD", () => {
    const d = createSeededDb(NOW);
    expect(["admin", "ga", "vendor", "K1001"].map((nik) => login(d, { nik, password: DEMO_PASSWORD }).user.role))
      .toEqual(["SUPER_ADMIN", "ADMIN_GA", "VENDOR", "EMPLOYEE"]);
    expect(login(d, { nik: "vendor", password: DEMO_PASSWORD }).user.vendorId).toBe("v1");
    expect(login(d, { nik: "K1090", password: DEMO_PASSWORD }).user.mustChangePassword).toBe(true);
  });

  test("deterministic", () => {
    expect(JSON.stringify(createSeededDb(NOW))).toBe(JSON.stringify(createSeededDb(NOW)));
  });
});
