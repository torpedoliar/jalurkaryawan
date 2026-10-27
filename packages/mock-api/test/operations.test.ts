import { ENDPOINTS } from "@bms/shared";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { DEMO_PASSWORD, getDb, handlers, resetDb } from "../src/index";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Response bodies are checked field by field below; full typing would only repeat the contract.
type Json = any;

async function api(path: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
  const res = await fetch(`http://localhost${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}
const login = async (nik: string) => (await api(ENDPOINTS.login, { body: { nik, password: DEMO_PASSWORD } })).body.accessToken as string;

/** K1001 rides R1 Pagi PICKUP from stop 1 (05:20). Clock at 05:00 puts that inside the check-in window. */
const AT_0500 = () => new Date("2026-10-14T05:00:00+07:00");
function k1001Pickup() {
  const db = getDb();
  return db.bookings.find((b) => b.userId === "k1001" && b.date === "2026-10-14" && b.direction === "PICKUP" && b.status === "BOOKED")!;
}

describe("trip operations", () => {
  beforeEach(() => resetDb(AT_0500));

  test("driver scan and employee self check-in converge on one attendance", async () => {
    const emp = await login("K1001");
    const drv = await login("driver");
    const adm = await login("admin");
    const b = k1001Pickup();

    const ticket = await api(ENDPOINTS.ticketQr(b.id), { token: emp });
    expect(ticket.status).toBe(200);
    expect(ticket.body.qr).toMatch(/^BMS-T1:/);
    expect(ticket.body.qr).not.toContain(b.id);

    const first = await api(ENDPOINTS.driverCheckin(b.tripId), { token: drv, body: { qr: ticket.body.qr, method: "DRIVER_SCANNER" } });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ alreadyCheckedIn: false, attendance: { bookingId: b.id, method: "DRIVER_SCANNER" } });

    const trip = getDb().trips.find((t) => t.id === b.tripId)!;
    const bus = await api(ENDPOINTS.busQr(trip.busId), { token: adm });
    const second = await api(ENDPOINTS.selfCheckin(b.id), { token: emp, body: { qr: bus.body.qr } });
    expect(second.status).toBe(200);
    expect(second.body.alreadyCheckedIn).toBe(true);
    expect(second.body.attendance.method).toBe("DRIVER_SCANNER");
    expect(getDb().ops.attendance.filter((a) => a.bookingId === b.id)).toHaveLength(1);
    // Attendance never touches reservations.
    expect(getDb().trips.find((t) => t.id === b.tripId)!.bookedCount).toBe(trip.bookedCount);
  });

  test("self check-in rejects another bus's QR and a rotated (revoked) QR", async () => {
    const emp = await login("K1001");
    const adm = await login("admin");
    const b = k1001Pickup();
    const trip = getDb().trips.find((t) => t.id === b.tripId)!;
    const other = await api(ENDPOINTS.busQr("b3"), { token: adm });
    expect((await api(ENDPOINTS.selfCheckin(b.id), { token: emp, body: { qr: other.body.qr } })).status).toBe(400);

    const old = await api(ENDPOINTS.busQr(trip.busId), { token: adm });
    await api(ENDPOINTS.busQrRotate(trip.busId), { token: adm, method: "POST" });
    const revoked = await api(ENDPOINTS.selfCheckin(b.id), { token: emp, body: { qr: old.body.qr } });
    expect(revoked.status).toBe(400);
    expect(revoked.body.message).toBe("QR ini bukan untuk bus trip kamu.");
  });

  test("a driver cannot act on a trip not assigned to them", async () => {
    const drv2 = await login("driver2");
    const b = k1001Pickup();
    expect((await api(ENDPOINTS.driverManifest(b.tripId), { token: drv2 })).status).toBe(403);
    expect((await api(ENDPOINTS.tripStart(b.tripId), { token: drv2, method: "POST" })).status).toBe(403);
  });

  test("check-in outside the window is rejected", async () => {
    resetDb(() => new Date("2026-10-14T03:00:00+07:00"));
    const emp = await login("K1001");
    const drv = await login("driver");
    const b = k1001Pickup();
    const ticket = await api(ENDPOINTS.ticketQr(b.id), { token: emp });
    const early = await api(ENDPOINTS.driverCheckin(b.tripId), { token: drv, body: { qr: ticket.body.qr, method: "DRIVER_CAMERA" } });
    expect(early.status).toBe(400);
    expect(early.body.message).toContain("Check-in dibuka");
  });

  test("GPS is accepted only during the run, deduplicated, and readable by admin and the booking owner", async () => {
    const drv = await login("driver");
    const adm = await login("admin");
    const emp = await login("K1001");
    const b = k1001Pickup();
    const sample = { sampleId: "dev1-0001", lat: -6.29, lng: 107.15, accuracy: 8, capturedAt: "2026-10-14T05:00:00+07:00" };

    expect((await api(ENDPOINTS.tripLocations(b.tripId), { token: drv, body: { samples: [sample] } })).status).toBe(400);
    expect((await api(ENDPOINTS.tripStart(b.tripId), { token: drv, method: "POST" })).body.status).toBe("IN_PROGRESS");
    const sent = await api(ENDPOINTS.tripLocations(b.tripId), { token: drv, body: { samples: [sample, sample] } });
    expect(sent.body).toEqual({ accepted: 1, duplicates: 1 });

    const all = await api(`${ENDPOINTS.tracking}?date=2026-10-14`, { token: adm });
    expect(all.body.find((x: Json) => x.tripId === b.tripId)).toMatchObject({ execution: "IN_PROGRESS", driverName: "Sopir Joko", position: { lat: -6.29 } });
    const mine = await api(ENDPOINTS.myBusPosition(b.id), { token: emp });
    expect(mine.body.position.lng).toBe(107.15);

    await api(ENDPOINTS.tripEnd(b.tripId), { token: drv, method: "POST" });
    expect((await api(ENDPOINTS.tripLocations(b.tripId), { token: drv, body: { samples: [{ ...sample, sampleId: "dev1-0002" }] } })).status).toBe(400);
  });

  test("GPS timestamp sanity rejects the whole batch without partial insertion", async () => {
    const token = await login("driver");
    const b = k1001Pickup();
    await api(ENDPOINTS.tripStart(b.tripId), { token, method: "POST" });
    const good = { sampleId: "dev1-good", lat: -6.29, lng: 107.15, capturedAt: "2026-10-14T05:00:00+07:00" };
    const future = { ...good, sampleId: "dev1-future", capturedAt: "2026-10-14T06:00:00+07:00" };
    expect((await api(ENDPOINTS.tripLocations(b.tripId), { token, body: { samples: [good, future] } })).status).toBe(400);
    expect(getDb().ops.locations).toHaveLength(0);
  });

  test("one driver cannot start two trips concurrently or be reassigned during a run", async () => {
    const token = await login("driver"), admin = await login("admin");
    const b = k1001Pickup();
    const other = getDb().trips.find((t) => t.id !== b.tripId && getDb().ops.tripDrivers.get(t.id) === "driver")!;
    await api(ENDPOINTS.tripStart(b.tripId), { token, method: "POST" });
    expect((await api(ENDPOINTS.tripStart(other.id), { token, method: "POST" })).status).toBe(400);
    expect((await api(ENDPOINTS.tripDriver(b.tripId), { token: admin, method: "PUT", body: { driverId: null } })).status).toBe(400);
  });

  test("driver assignment requires an active driver from the bus's vendor", async () => {
    const adm = await login("admin");
    const b = k1001Pickup();
    const wrongVendor = await api(ENDPOINTS.tripDriver(b.tripId), { token: adm, method: "PUT", body: { driverId: "driver2" } });
    expect(wrongVendor.status).toBe(400);
    expect((await api(ENDPOINTS.tripDriver(b.tripId), { token: adm, method: "PUT", body: { driverId: null } })).status).toBe(200);
    expect(getDb().ops.tripDrivers.has(b.tripId)).toBe(false);
  });
});
