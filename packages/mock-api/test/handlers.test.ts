import { ENDPOINTS } from "@bms/shared";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { DEMO_PASSWORD, getDb, handlers, resetDb } from "../src/index";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => resetDb(() => new Date("2026-10-14T00:00:00+07:00")));

const DAY = "2026-10-14";

// Response bodies are checked field by field below; full typing would only repeat the contract.
type Json = any;

async function api(path: string, opts: { token?: string; method?: string; body?: unknown; form?: FormData } = {}) {
  const res = await fetch(`http://localhost${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

async function login(nik: string, password = DEMO_PASSWORD): Promise<{ token: string; name: string }> {
  const r = await api(ENDPOINTS.login, { body: { nik, password } });
  expect(r.status).toBe(200);
  return { token: r.body.accessToken, name: r.body.user.name };
}

describe("auth", () => {
  test("login works and must-change-password blocks everything but /me", async () => {
    const { token } = await login("K1090");
    expect((await api(ENDPOINTS.me, { token })).status).toBe(200);
    const blocked = await api(ENDPOINTS.myBookings, { token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("FORBIDDEN");
  });

  test("5 wrong passwords lock the account, even the right password then gets 423", async () => {
    for (let i = 0; i < 4; i++) expect((await api(ENDPOINTS.login, { body: { nik: "K1001", password: "salah" } })).status).toBe(401);
    expect((await api(ENDPOINTS.login, { body: { nik: "K1001", password: "salah" } })).status).toBe(423);
    const locked = await api(ENDPOINTS.login, { body: { nik: "K1001", password: DEMO_PASSWORD } });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe("ACCOUNT_LOCKED");
  });

  test("setup is locked once a super admin exists", async () => {
    const r = await api(ENDPOINTS.setup, { body: { nik: "x", name: "X", password: "12345678" } });
    expect(r.status).toBe(403);
  });

  test("maintenance returns 503 everywhere except system status", async () => {
    getDb().maintenance = true;
    const r = await api(ENDPOINTS.login, { body: { nik: "admin", password: DEMO_PASSWORD } });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("MAINTENANCE");
    const s = await api(ENDPOINTS.systemStatus);
    expect(s.status).toBe(200);
    expect(s.body.maintenance).toBe(true);
  });
});

describe("roles", () => {
  test("vendor cannot write master data", async () => {
    const { token } = await login("vendor");
    expect((await api(ENDPOINTS.vendors, { token, body: { name: "PT Baru" } })).status).toBe(403);
    expect((await api(ENDPOINTS.vendors, { token })).status).toBe(200);
  });

  test("ADMIN_GA cannot create an admin account", async () => {
    const { token } = await login("ga");
    const r = await api(ENDPOINTS.users, { token, body: { nik: "GA2", name: "GA Dua", role: "ADMIN_GA" } });
    expect(r.status).toBe(403);
    const ok = await api(ENDPOINTS.users, { token, body: { nik: "K2001", name: "Karyawan Baru", role: "EMPLOYEE" } });
    expect(ok.status).toBe(200);
    expect(ok.body.tempPassword).toBeTruthy();
  });

  test("an employee cannot cancel someone else's booking", async () => {
    const owner = await login("K1002");
    const [booking] = (await api(`${ENDPOINTS.myBookings}?from=${DAY}&to=${DAY}`, { token: owner.token })).body;
    const other = await login("K1003");
    const r = await api(ENDPOINTS.bookingCancel(booking.id), { token: other.token, method: "POST" });
    expect(r.status).toBe(404);
    expect(getDb().bookings.find((b) => b.id === booking.id)!.status).toBe("BOOKED");
  });
});

describe("booking", () => {
  test("departures show no passenger identity and flag the caller's own trip", async () => {
    const { token, name } = await login("K1002");
    const r = await api(`${ENDPOINTS.departures}?date=${DAY}`, { token });
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('"nik"');
    expect(text).not.toContain(name);
    const mine = r.body.filter((d: Json) => d.mine);
    expect(mine.map((d: Json) => `${d.routeId}/${d.shiftId}/${d.direction}`).sort()).toEqual(["r2/pagi/DROPOFF", "r2/pagi/PICKUP"]);
  });

  test("two requests for the last seat: one wins, one gets TRIP_FULL", async () => {
    const trip = getDb().trips.find((t) => t.date === DAY && t.routeId === "r2" && t.shiftId === "pagi" && t.direction === "PICKUP")!;
    trip.capacity = trip.bookedCount + 1;
    const [a, b] = await Promise.all([login("K1061"), login("K1062")]);
    const body = { routeId: "r2", stopId: "r2s1", shiftId: "pagi", direction: "PICKUP", date: DAY };
    const results = await Promise.all([a, b].map(({ token }) => api(ENDPOINTS.bookings, { token, body })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe("TRIP_FULL");
    expect(trip.bookedCount).toBe(trip.capacity);
    expect(getDb().rejected.some((x) => x.date === DAY && x.routeId === "r2")).toBe(true);
  });
});

describe("settings and backups", () => {
  test("secrets are never echoed and are masked in the audit log", async () => {
    const { token } = await login("admin");
    const r = await api(ENDPOINTS.settings, { token, method: "PUT", body: { backup_share_password: "hunter2", booking_cutoff_minutes: 90 } });
    expect(r.status).toBe(200);
    expect(r.body.backup_share_password).toEqual({ isSet: true });
    expect(r.body.booking_cutoff_minutes).toBe(90);
    expect(JSON.stringify(r.body)).not.toContain("hunter2");

    const bad = await api(ENDPOINTS.settings, { token, method: "PUT", body: { booking_cutoff_minutes: 5000 } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_ERROR");
    expect(getDb().settings.booking_cutoff_minutes).toBe(90);

    const audit = await api(`${ENDPOINTS.audit}?action=SETTINGS_UPDATE`, { token });
    expect(JSON.stringify(audit.body)).not.toContain("hunter2");
    expect(audit.body.items[0].after).toEqual({ backup_share_password: "***", booking_cutoff_minutes: 90 });
  });

  test("ADMIN_GA cannot read settings", async () => {
    const { token } = await login("ga");
    expect((await api(ENDPOINTS.settings, { token })).status).toBe(403);
  });

  test("restore checks confirm and password, snapshots first, then logs everyone out", async () => {
    const { token } = await login("admin");
    const backup = (await api(ENDPOINTS.backupRun, { token, method: "POST" })).body;
    expect(backup.name).toMatch(/\.dump$/);

    const noConfirm = await api(ENDPOINTS.restore, { token, body: { fileName: backup.name, password: DEMO_PASSWORD, confirm: "YES" } });
    expect(noConfirm.status).toBe(400);
    const wrongPw = await api(ENDPOINTS.restore, { token, body: { fileName: backup.name, password: "salah", confirm: "RESTORE" } });
    expect(wrongPw.status).toBe(400);
    expect(wrongPw.body.code).toBe("VALIDATION_ERROR");

    const ok = await api(ENDPOINTS.restore, { token, body: { fileName: backup.name, password: DEMO_PASSWORD, confirm: "RESTORE" } });
    expect(ok.status).toBe(200);
    expect(ok.body.preRestore.name).toMatch(/^pre-restore-.*\.dump$/);
    expect(getDb().backups.map((b) => b.name)).toContain(ok.body.preRestore.name);
    expect((await api(ENDPOINTS.backups, { token })).status).toBe(401);
  });

  test("upload rejects a file that is not a pg_dump archive", async () => {
    const { token } = await login("admin");
    const form = new FormData();
    form.append("file", new File(["hello"], "fake.dump"));
    const r = await api(ENDPOINTS.backupUpload, { token, form });
    expect(r.status).toBe(400);
    const good = new FormData();
    good.append("file", new File(["PGDMP-data"], "real.dump"));
    expect((await api(ENDPOINTS.backupUpload, { token, form: good })).status).toBe(200);
  });
});

describe("import", () => {
  test("preview reports errors with Excel row numbers", async () => {
    const { token } = await login("ga");
    const rows = [
      { nik: 9001, name: "Satu" },
      { nik: "9001", name: "Dobel" },
      { nik: "", name: "Kosong" },
      { nik: "admin", name: "Admin" },
      { nik: "K1001", name: "Update" },
    ];
    const r = await api(ENDPOINTS.importPreview, { token, body: { rows } });
    expect(r.status).toBe(200);
    expect(r.body.created.map((x: Json) => x.nik)).toEqual(["9001"]);
    expect(r.body.updated.map((x: Json) => x.nik)).toEqual(["K1001"]);
    expect(r.body.errors.map((e: Json) => e.row)).toEqual([3, 4, 5]);
  });
});