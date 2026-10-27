import { addDays, type Direction, type Role } from "@bms/shared";
import { createDb, nextId, nowIso, today, type Db, type UserRow } from "./db";
import { runGenerate } from "./domain/generate";

export const DEMO_PASSWORD = "demo1234";

const ROUTES = [
  ["R1", "Cikarang", "#D6322B", ["Terminal Cikarang", "Pasar Lemahabang", "Simpang Cibarusah"], 8],
  ["R2", "Bekasi Timur", "#1F6FD1", ["Halte Bulak Kapal", "Stasiun Bekasi Timur", "Pasar Rawalumbu"], 50],
  ["R3", "Karawang", "#169B62", ["Terminal Klari", "Alun-alun Karawang", "Galuh Mas"], 50],
  ["R4", "Tambun", "#E07A00", ["Stasiun Tambun", "Pasar Tambun", "Mangunjaya"], 11],
  ["R5", "Cibitung", "#7A3FC2", ["Stasiun Cibitung", "Pasar Cibitung", "Wanasari"], 50],
  ["R6", "Jababeka", "#0E9AA7", ["Terminal Jababeka", "Kawasan Jababeka 2", "Pasir Gombong"], 50],
] as const;

/** Approximate demo stop coordinates per route (index 0 unused: R1 starts unmapped). */
const COORDS: [number, number][][] = [
  [],
  [[-6.2486, 107.0177], [-6.2491, 107.0060], [-6.2735, 106.9990]],
  [[-6.3197, 107.2915], [-6.3062, 107.3054], [-6.3220, 107.3185]],
  [[-6.2357, 107.0560], [-6.2410, 107.0635], [-6.2520, 107.0790]],
  [[-6.2610, 107.0890], [-6.2655, 107.0975], [-6.2790, 107.1060]],
  [[-6.2950, 107.1490], [-6.3105, 107.1630], [-6.3260, 107.1735]],
];

/** [shiftId, direction, hour, minute, dayOffset]; minute + 5 per route index. */
const TEMPLATES: [string, Direction, number, number, 0 | 1][] = [
  ["pagi", "PICKUP", 5, 20, 0], ["pagi", "DROPOFF", 15, 10, 0],
  ["siang", "PICKUP", 13, 20, 0], ["siang", "DROPOFF", 23, 10, 0],
  ["malam", "PICKUP", 21, 20, 0], ["malam", "DROPOFF", 7, 10, 1],
];

const NAMES = ["Rina Wulandari", "Budi Santoso", "Siti Aminah", "Agus Prasetyo", "Dewi Lestari", "Eko Saputra"];
const DEPARTMENTS = ["Produksi", "Gudang", "QC", "Maintenance"];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

function account(id: string, nik: string, name: string, role: Role, extra: Partial<UserRow> = {}): UserRow {
  return {
    id, nik, name, department: "", phone: "", role, authProvider: "LOCAL", active: true, vendorId: null,
    bookingSuspendedUntil: null, suspendReason: null, lockedUntil: null,
    password: DEMO_PASSWORD, mustChangePassword: false, failedLogins: 0, ...extra,
  };
}

/** Deterministic demo data for the mock API (same `now` gives identical output). */
export function createSeededDb(now: () => Date = () => new Date()): Db {
  const db = createDb(now);
  const day0 = today(db);
  db.vendors.push({ id: "v1", name: "PT Trans Jaya", contact: "021-555-0101", active: true }, { id: "v2", name: "CV Mitra Armada", contact: "021-555-0202", active: true });
  db.shifts.push(
    { id: "pagi", name: "Pagi", startTime: "07:00", endTime: "15:00" },
    { id: "siang", name: "Siang", startTime: "15:00", endTime: "23:00" },
    { id: "malam", name: "Malam", startTime: "23:00", endTime: "07:00" },
  );

  ROUTES.forEach(([code, name, color, stops, capacity], i) => {
    const routeId = `r${i + 1}`;
    db.routes.push({ id: routeId, code, name, color, active: true });
    // R1 is left unmapped so the "Belum dipetakan" state is visible; the others get demo coordinates.
    stops.forEach((stop, s) => {
      const [lat, lng] = i === 0 ? [null, null] : COORDS[i]![s]!;
      db.stops.push({ id: `${routeId}s${s + 1}`, routeId, name: stop, seq: s + 1, offsetMinutes: s * 15, lat, lng, active: true });
    });
    const vendorId = i < 3 ? "v1" : "v2";
    const [busA, busB] = [`b${i * 2 + 1}`, `b${i * 2 + 2}`];
    db.buses.push(
      { id: busA, plate: `B 7${i + 1}01 FX`, capacity, vendorId, active: true },
      { id: busB, plate: `B 7${i + 1}02 KR`, capacity, vendorId, active: true },
    );
    for (const [shiftId, direction, h, m, dayOffset] of TEMPLATES) {
      db.templates.push({
        id: nextId(db, "tp"), routeId, shiftId, direction, busId: direction === "PICKUP" ? busA : busB,
        departureTime: hhmm(h, m + i * 5), dayOffset, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
      });
    }
  });

  db.users.push(
    account("admin", "admin", "Super Admin", "SUPER_ADMIN"),
    account("ga", "ga", "Admin GA", "ADMIN_GA"),
    account("vendor", "vendor", "Operator PT Trans Jaya", "VENDOR", { vendorId: "v1" }),
    account("driver", "driver", "Sopir Joko", "DRIVER", { vendorId: "v1", phone: "081300000001" }),
    account("driver2", "driver2", "Sopir Hadi", "DRIVER", { vendorId: "v2", phone: "081300000002" }),
  );
  for (let i = 0; i < 90; i++) {
    const nik = `K${1001 + i}`;
    const u = account(nik.toLowerCase(), nik, NAMES[i] ?? `Karyawan ${nik}`, "EMPLOYEE", {
      department: DEPARTMENTS[i % DEPARTMENTS.length]!, phone: `0812000${1001 + i}`,
    });
    db.users.push(u);
    const routeId = `r${(i % 6) + 1}`;
    const shiftId = i < 60 ? "pagi" : i < 75 ? "siang" : "malam";
    for (const direction of ["PICKUP", "DROPOFF"] as const) {
      db.subscriptions.push({
        id: nextId(db, "sub"), userId: u.id, routeId, stopId: `${routeId}s${(i % 3) + 1}`, shiftId, direction,
        startDate: day0, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7], status: "ACTIVE", createdAt: nowIso(db),
      });
    }
  }
  const suspended = db.users.find((u) => u.nik === "K1059")!;
  suspended.bookingSuspendedUntil = addDays(day0, 3);
  suspended.suspendReason = "No-show 3x dalam 30 hari";
  db.users.find((u) => u.nik === "K1090")!.mustChangePassword = true;

  runGenerate(db);
  // Driver Joko runs every trip of buses b1/b2 (R1, vendor v1); driver2 runs R4 (vendor v2).
  for (const t of db.trips) {
    if (t.busId === "b1" || t.busId === "b2") db.ops.tripDrivers.set(t.id, "driver");
    if (t.busId === "b7" || t.busId === "b8") db.ops.tripDrivers.set(t.id, "driver2");
  }
  return db;
}
