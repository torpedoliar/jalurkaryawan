import * as SecureStore from "expo-secure-store";
import { LocationSample } from "@bms/shared";

export const GPS_QUEUE_LIMIT = 100;
export const GPS_QUEUE_TTL_MS = 6 * 60 * 60 * 1000;
type Pending = { tripId: string; sample: LocationSample };
const key = (slot: number) => `bms_gps_pending_${slot}`;
let serial: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = serial.then(work, work); serial = next.catch(() => undefined); return next;
}
async function read() {
  const rows: { slot: number; value: Pending }[] = [];
  for (let slot = 0; slot < GPS_QUEUE_LIMIT; slot++) {
    const raw = await SecureStore.getItemAsync(key(slot));
    if (!raw) continue;
    try {
      const value = JSON.parse(raw) as Pending;
      LocationSample.parse(value.sample);
      if (Date.now() - Date.parse(value.sample.capturedAt) > GPS_QUEUE_TTL_MS) throw new Error("expired");
      rows.push({ slot, value });
    } catch { await SecureStore.deleteItemAsync(key(slot)); }
  }
  return rows.sort((a, b) => Date.parse(a.value.sample.capturedAt) - Date.parse(b.value.sample.capturedAt));
}
/** Separate small encrypted records avoid SecureStore's per-value size limits. Oldest samples are evicted. */
export function enqueueLocations(tripId: string, samples: LocationSample[], allowed?: () => Promise<boolean>) {
  return exclusive(async () => {
    if (allowed && !(await allowed())) return;
    const rows = await read();
    for (const sample of samples) {
      if (Date.now() - Date.parse(sample.capturedAt) > GPS_QUEUE_TTL_MS) continue;
      if (rows.some((row) => row.value.sample.sampleId === sample.sampleId)) continue;
      const slot = rows.length < GPS_QUEUE_LIMIT
        ? Array.from({ length: GPS_QUEUE_LIMIT }, (_, i) => i).find((i) => !rows.some((row) => row.slot === i))!
        : rows.shift()!.slot;
      const value = { tripId, sample: LocationSample.parse(sample) };
      await SecureStore.setItemAsync(key(slot), JSON.stringify(value));
      rows.push({ slot, value });
    }
  });
}
let draining: Promise<void> | null = null;
export function drainLocations(tripId: string, send: (samples: LocationSample[]) => Promise<void>): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    const rows = await exclusive(async () => (await read()).filter((row) => row.value.tripId === tripId));
    for (let index = 0; index < rows.length; index += 100) {
      const batch = rows.slice(index, index + 100);
      // Never hold the storage lock during HTTP: an auth failure must be able to discard immediately.
      await send(batch.map((row) => row.value.sample));
      await exclusive(async () => {
        for (const row of batch) {
          const raw = await SecureStore.getItemAsync(key(row.slot));
          if (raw === JSON.stringify(row.value)) await SecureStore.deleteItemAsync(key(row.slot));
        }
      });
    }
  })().finally(() => { draining = null; });
  return draining;
}
export function discardLocations(tripId?: string) {
  return exclusive(async () => {
    if (!tripId) {
      for (let slot = 0; slot < GPS_QUEUE_LIMIT; slot++) await SecureStore.deleteItemAsync(key(slot));
    } else {
      for (const row of await read()) if (row.value.tripId === tripId) await SecureStore.deleteItemAsync(key(row.slot));
    }
  });
}
