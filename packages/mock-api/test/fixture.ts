import { createDb, type Db, type UserRow } from "../src/db";

export function user(id: string, extra: Partial<UserRow> = {}): UserRow {
  return {
    id, nik: id.toUpperCase(), name: `User ${id}`, department: "Produksi", phone: "0812",
    role: "EMPLOYEE", authProvider: "LOCAL", active: true, vendorId: null,
    bookingSuspendedUntil: null, suspendReason: null, lockedUntil: null,
    password: "password", mustChangePassword: false, failedLogins: 0, ...extra,
  };
}

/** One route, one shift, two 1-seat buses on two PICKUP templates (05:00, 05:10). Now = Wed 14 Oct 2026 00:00 WIB. */
export function world(now = "2026-10-14T00:00:00+07:00"): Db {
  const db = createDb(() => new Date(now));
  db.vendors.push({ id: "v1", name: "PT Trans", contact: "", active: true });
  db.buses.push(
    { id: "b1", plate: "B 1 AA", capacity: 1, vendorId: "v1", active: true },
    { id: "b2", plate: "B 2 BB", capacity: 1, vendorId: "v1", active: true },
    { id: "b3", plate: "B 3 CC", capacity: 40, vendorId: "v1", active: true },
  );
  db.shifts.push({ id: "sh1", name: "Pagi", startTime: "06:00", endTime: "14:00" });
  db.routes.push({ id: "r1", code: "R1", name: "Cikarang", color: "#D6322B", active: true });
  db.stops.push(
    { id: "s1", routeId: "r1", name: "Halte A", seq: 1, offsetMinutes: 0, lat: null, lng: null, active: true },
    { id: "s2", routeId: "r1", name: "Halte B", seq: 2, offsetMinutes: 20, lat: null, lng: null, active: true },
    { id: "s9", routeId: "r1", name: "Halte Tutup", seq: 3, offsetMinutes: 30, lat: null, lng: null, active: false },
  );
  const all = [1, 2, 3, 4, 5, 6, 7];
  db.templates.push(
    { id: "tp1", routeId: "r1", shiftId: "sh1", direction: "PICKUP", busId: "b1", departureTime: "05:00", dayOffset: 0, weekdays: all, active: true },
    { id: "tp2", routeId: "r1", shiftId: "sh1", direction: "PICKUP", busId: "b2", departureTime: "05:10", dayOffset: 0, weekdays: all, active: true },
  );
  db.users.push(user("u1"), user("u2"), user("u3"), user("adm", { role: "SUPER_ADMIN" }));
  return db;
}

export const pick = { routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "PICKUP" as const };
