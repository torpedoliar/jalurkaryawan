import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import { discardLocations } from "./telemetryQueue";

export const TRACKING_TASK = "bms-active-driver-trip";
const TRACKING_KEY = "bms_active_tracking";
export type TrackingContext = { tripId: string };
type Reporter = (tripId: string, location: Location.LocationObject) => Promise<void>;
let report: Reporter | null = null;
let lastError: string | null = null;
export function setLocationReporter(reporter: Reporter) { report = reporter; }
export async function trackingContextMatches(tripId: string) {
  const raw = await SecureStore.getItemAsync(TRACKING_KEY);
  return !!raw && (JSON.parse(raw) as TrackingContext).tripId === tripId;
}
export function trackingError() { return lastError; }

// Defined at module scope, imported before registerRootComponent. No UI lifecycle dependency.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TRACKING_TASK, async ({ data, error }) => {
  if (error) { lastError = error.message; return; }
  try {
    const raw = await SecureStore.getItemAsync(TRACKING_KEY);
    if (!raw || !report) return;
    const { tripId } = JSON.parse(raw) as TrackingContext;
    let failed = false;
    for (const location of data?.locations ?? []) {
      if (await SecureStore.getItemAsync(TRACKING_KEY) !== raw) break;
      try { await report(tripId, location); } catch { failed = true; }
    }
    lastError = failed ? "Lokasi tersimpan untuk dicoba kembali; belum diterima server." : null;
  } catch { lastError = "Lokasi belum terkirim. Periksa koneksi dan sesi login."; }
});

export async function activeTracking(): Promise<string | null> {
  if (!(await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK))) return null;
  const raw = await SecureStore.getItemAsync(TRACKING_KEY);
  return raw ? (JSON.parse(raw) as TrackingContext).tripId : null;
}
export async function startTracking(tripId: string) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") throw new Error("GPS ditolak. Check-in tetap tersedia.");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") throw new Error("Izin lokasi latar belakang ditolak. Check-in tetap tersedia.");
  const current = await activeTracking();
  if (current && current !== tripId) throw new Error("Akhiri pelacakan perjalanan sebelumnya terlebih dahulu.");
  if (current === tripId) return;
  await SecureStore.setItemAsync(TRACKING_KEY, JSON.stringify({ tripId }));
  try {
    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 25,
      pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: "Pelacakan perjalanan aktif", notificationBody: "Lokasi bus dibagikan. Akhiri melalui aplikasi." },
    });
    lastError = null;
  } catch (e) { await SecureStore.deleteItemAsync(TRACKING_KEY); throw e; }
}
export async function stopTracking(expectedTripId?: string) {
  const raw = await SecureStore.getItemAsync(TRACKING_KEY);
  const current = raw ? (JSON.parse(raw) as TrackingContext).tripId : null;
  if (expectedTripId && current !== expectedTripId) return;
  // Revoke context before awaiting the OS: callbacks arriving during shutdown cannot enqueue more samples.
  await SecureStore.deleteItemAsync(TRACKING_KEY);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  } finally {
    await discardLocations(expectedTripId);
    lastError = null;
  }
}
