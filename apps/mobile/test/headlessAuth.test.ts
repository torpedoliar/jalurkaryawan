import { http, HttpResponse } from "msw";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import { z } from "zod";
import { api, ensureSession, REFRESH_KEY, setToken } from "../src/api";
import { server } from "./setup";
import { drainLocations, enqueueLocations } from "../src/telemetryQueue";

async function tracking() {
  await SecureStore.setItemAsync("bms_active_tracking", JSON.stringify({ tripId: "trip" }));
  jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
  await enqueueLocations("trip", [{ sampleId: "sample-test", lat: 1, lng: 2, accuracy: null, speed: null, heading: null, capturedAt: new Date().toISOString() }]);
}
it("stops and purges on headless protected 401 without App mounting or storage deadlock", async () => {
  await tracking(); setToken("expired");
  server.use(http.post("http://localhost/api/headless-test", () => HttpResponse.json({ code: "UNAUTHORIZED", message: "Expired" }, { status: 401 })));
  await expect(drainLocations("trip", async () => { await api.post("/api/headless-test", z.unknown()); })).rejects.toThrow();
  expect(await SecureStore.getItemAsync("bms_active_tracking")).toBeNull();
  expect(await SecureStore.getItemAsync("bms_gps_pending_0")).toBeNull();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
});
it("stops headless tracking when refresh is revoked", async () => {
  await tracking(); setToken(null); await SecureStore.setItemAsync(REFRESH_KEY, "revoked");
  server.use(http.post("http://localhost/api/auth/refresh", () => HttpResponse.json({}, { status: 401 })));
  await expect(ensureSession()).rejects.toThrow();
  expect(await SecureStore.getItemAsync("bms_active_tracking")).toBeNull();
});
