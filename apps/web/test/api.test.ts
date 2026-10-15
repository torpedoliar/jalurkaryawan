import { describe, expect, test, vi } from "vitest";
import { HttpResponse, http } from "msw";
import { z } from "zod";
import { DEMO_PASSWORD } from "@bms/mock-api";
import { Departure, ENDPOINTS, LoginResponse, Me } from "@bms/shared";
import { ApiFailure, api, apiEvents, login } from "../src/api";
import { server } from "./setup";

const unauthorized = () => HttpResponse.json({ code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." }, { status: 401 });

async function freshLogin(nik: string) {
  const r = await fetch(`http://localhost${ENDPOINTS.login}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nik, password: DEMO_PASSWORD }),
  });
  return LoginResponse.parse(await r.json());
}

describe("api client", () => {
  test("login keeps the access token in memory and authenticates later calls", async () => {
    const me = await login("K1001", DEMO_PASSWORD);
    expect(me.role).toBe("EMPLOYEE");
    expect((await api.get(ENDPOINTS.me, Me)).nik).toBe("K1001");
  });

  test("server error becomes ApiFailure with the server message verbatim", async () => {
    const err = await login("K1001", "salah").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "NIK atau password salah." });
  });

  test("401 refreshes once via cookie (no body) and retries", async () => {
    await login("K1001", DEMO_PASSWORD);
    const fresh = await freshLogin("K1001");
    const bodies: string[] = [];
    server.use(
      http.get(`*${ENDPOINTS.me}`, unauthorized, { once: true }),
      http.post(`*${ENDPOINTS.refresh}`, async ({ request }) => { bodies.push(await request.text()); return HttpResponse.json(fresh); }),
    );
    expect((await api.get(ENDPOINTS.me, Me)).nik).toBe("K1001");
    expect(bodies).toEqual([""]);
  });

  test("401 after a failed refresh logs out once, no loop", async () => {
    await login("K1001", DEMO_PASSWORD);
    let refreshes = 0;
    server.use(
      http.get(`*${ENDPOINTS.me}`, unauthorized),
      http.post(`*${ENDPOINTS.refresh}`, () => { refreshes++; return unauthorized(); }),
    );
    apiEvents.loggedOut = vi.fn();
    await expect(api.get(ENDPOINTS.me, Me)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(refreshes).toBe(1);
    expect(apiEvents.loggedOut).toHaveBeenCalledTimes(1);
  });

  test("MAINTENANCE fires the maintenance hook", async () => {
    await login("K1001", DEMO_PASSWORD);
    server.use(http.get(`*${ENDPOINTS.departures}`, () =>
      HttpResponse.json({ code: "MAINTENANCE", message: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi." }, { status: 503 })));
    apiEvents.maintenance = vi.fn();
    await expect(api.get(ENDPOINTS.departures, z.array(Departure))).rejects.toMatchObject({ code: "MAINTENANCE" });
    expect(apiEvents.maintenance).toHaveBeenCalledTimes(1);
  });

  test("query params skip empty values; 204 parses with z.void()", async () => {
    await login("K1001", DEMO_PASSWORD);
    const rows = await api.get(ENDPOINTS.departures, z.array(Departure), { date: "2026-10-15", routeId: undefined });
    expect(rows.every((d) => d.date === "2026-10-15")).toBe(true);
    await expect(api.post(ENDPOINTS.logout, z.void())).resolves.toBeUndefined();
  });

  test("response that breaks the contract is rejected, not passed through", async () => {
    await login("K1001", DEMO_PASSWORD);
    server.use(http.get(`*${ENDPOINTS.me}`, () => HttpResponse.json({ nik: 1 })));
    await expect(api.get(ENDPOINTS.me, Me)).rejects.toThrow();
  });
});
