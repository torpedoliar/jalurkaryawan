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

  test("web refresh works from the httpOnly cookie alone; mobile from the body", async () => {
    const res = await fetch(`http://localhost${ENDPOINTS.login}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nik: "K1001", password: DEMO_PASSWORD }),
    });
    expect(res.headers.get("set-cookie")).toMatch(/^bms_refresh=rt\.\d+; .*HttpOnly; Secure; SameSite=Strict/);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const { refreshToken } = await res.json();
    const web = await fetch(`http://localhost${ENDPOINTS.refresh}`, { method: "POST", headers: { cookie } });
    expect(web.status).toBe(200);
    const stale = await api(ENDPOINTS.refresh, { body: { refreshToken } });
    expect(stale.status).toBe(401); // rotated by the cookie refresh
    const fresh = (await web.json()).refreshToken;
    expect((await api(ENDPOINTS.refresh, { body: { refreshToken: fresh } })).status).toBe(200);
  });

  test("/me hides a suspension that has already ended", async () => {
    getDb().users.find((u) => u.nik === "K1001")!.bookingSuspendedUntil = "2026-10-13";
    const { token } = await login("K1001");
    expect((await api(ENDPOINTS.me, { token })).body).toMatchObject({ bookingSuspendedUntil: null, suspendReason: null });
  });

  test("device-token DELETE is also blocked until the password is changed", async () => {
    const { token } = await login("K1090");
    const r = await api(ENDPOINTS.deviceTokens, { token, method: "DELETE", body: { token: "tok" } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("FORBIDDEN");
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
    expect(getDb().rejected.filter((x) => x.date === DAY && x.routeId === "r2" && x.shiftId === "pagi" && x.direction === "PICKUP")).toHaveLength(1);
  });
});

describe("manifest", () => {
  test("passengers are listed in stop-visit order: DROPOFF runs the stops in reverse", async () => {
    const { token } = await login("admin");
    const db = getDb();
    for (const direction of ["PICKUP", "DROPOFF"] as const) {
      const trip = db.trips.find((t) => t.date === DAY && t.direction === direction && t.bookedCount > 2)!;
      const stops = db.stops.filter((x) => x.routeId === trip.routeId && x.active);
      db.bookings.filter((b) => b.tripId === trip.id).forEach((b, i) => (b.stopId = stops[i % stops.length]!.id)); // seed puts all on one stop
      const seqs = (await api(ENDPOINTS.tripPassengers(trip.id), { token })).body.map((x: Json) => x.stopSeq);
      const sorted = [...seqs].sort((a, b) => (direction === "PICKUP" ? a - b : b - a));
      expect(seqs).toEqual(sorted);
    }
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

  test("an uploaded backup never raises the share-copy warning; a failed job run does", async () => {
    const { token } = await login("admin");
    const db = getDb();
    db.settings.backup_share_enabled = true;
    db.settings.backup_share_path = "\\nas\bms";
    await api(ENDPOINTS.backupRun, { token, method: "POST" });
    const good = new FormData();
    good.append("file", new File(["PGDMP-data"], "zz-upload.dump"));
    await api(ENDPOINTS.backupUpload, { token, form: good });
    expect((await api(ENDPOINTS.dashboard, { token })).body.backupWarning).toBeNull();
    db.backups.find((b) => b.name.startsWith("bms-"))!.copiedToShare = false;
    expect((await api(ENDPOINTS.dashboard, { token })).body.backupWarning).toMatch(/gagal disalin/);
  });

  test("an unknown settings key is rejected in Indonesian", async () => {
    const { token } = await login("admin");
    const r = await api(ENDPOINTS.settings, { token, method: "PUT", body: { not_a_setting: 1 } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
    expect(r.body.message).toBe("Ada kolom yang tidak dikenali.");
    expect(r.body.message).not.toContain("Unrecognized");
  });

  test("the first write of a secret records an empty before, not ***", async () => {
    const { token } = await login("admin");
    expect(getDb().settings.backup_share_password).toBe("");
    await api(ENDPOINTS.settings, { token, method: "PUT", body: { backup_share_password: "hunter2" } });
    const audit = await api(`${ENDPOINTS.audit}?action=SETTINGS_UPDATE`, { token });
    expect(JSON.stringify(audit.body)).not.toContain("hunter2");
    expect(audit.body.items[0].before).toEqual({ backup_share_password: "" });
    expect(audit.body.items[0].after).toEqual({ backup_share_password: "***" });
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

  test("a row with a missing cell is reported in Indonesian, naming the column", async () => {
    const { token } = await login("ga");
    const r = await api(ENDPOINTS.importPreview, { token, body: { rows: [{ name: "Tanpa NIK" }] } });
    expect(r.status).toBe(200);
    expect(r.body.errors).toEqual([{ row: 2, message: "nik: format tidak sesuai." }]);
  });
});

describe("self-service roles", () => {
  test("an admin can book, cancel and list their own booking", async () => {
    const { token } = await login("admin");
    const created = await api(ENDPOINTS.bookings, { token, body: {
      routeId: "r2", stopId: "r2s1", shiftId: "siang", direction: "PICKUP", date: "2026-10-15",
    } });
    expect(created.status).toBe(200);
    const mine = await api(ENDPOINTS.myBookings, { token });
    expect(mine.body.some((b: Json) => b.id === created.body.id)).toBe(true);

    const cancelled = await api(ENDPOINTS.bookingCancel(created.body.id), { token, method: "POST" });
    expect(cancelled.body.status).toBe("CANCELLED");
    const after = await api(ENDPOINTS.myBookings, { token });
    expect(after.body.find((b: Json) => b.id === created.body.id).status).toBe("CANCELLED");
  });
});

describe("stop deletion", () => {
  const NEW_STOP = { name: "Halte Sementara", seq: 9, offsetMinutes: 60, lat: null, lng: null, active: true };

  test("DELETE deactivates an unused stop and the row stays in the list", async () => {
    const { token } = await login("ga");
    const created = await api(ENDPOINTS.routeStops("r1"), { token, body: NEW_STOP });
    expect(created.status).toBe(200);

    const deleted = await api(ENDPOINTS.stop("r1", created.body.id), { token, method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ id: created.body.id, active: false });
    expect(getDb().stops.find((s) => s.id === created.body.id)!.active).toBe(false);
    expect((await api(ENDPOINTS.routeStops("r1"), { token })).body.some((s: Json) => s.id === created.body.id)).toBe(true);
  });

  test("a stop used by an active subscription or a future booking cannot be deleted", async () => {
    const { token } = await login("ga");
    const r = await api(ENDPOINTS.stop("r1", "r1s1"), { token, method: "DELETE" });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe("Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.");
    expect(getDb().stops.find((s) => s.id === "r1s1")!.active).toBe(true);
  });

  test("a wrong route id is NOT_FOUND", async () => {
    const { token } = await login("ga");
    expect((await api(ENDPOINTS.stop("r2", "r1s1"), { token, method: "DELETE" })).status).toBe(404);
  });
});
