import { z } from "zod";
import { BusPosition, CheckinResult, DriverCheckinRequest, DriverManifestRow, DriverTrip, ENDPOINTS, LocationBatch, LocationBatchResult, SelfCheckinRequest, TicketQrResponse, TripExecution } from "@bms/shared";
import { api, ensureSession } from "./api";
import { setLocationReporter, trackingContextMatches } from "./tracking";
import { drainLocations, enqueueLocations } from "./telemetryQueue";

export { DriverTrip };
export const operations = {
  position: (id: string) => api.get(ENDPOINTS.myBusPosition(id), BusPosition),
  ticket: async (id: string) => { const value = await api.get(ENDPOINTS.ticketQr(id), TicketQrResponse); return { qrPayload: value.qr, expiresAt: value.expiresAt }; },
  selfCheckin: (id: string, qr: string) => api.post(ENDPOINTS.selfCheckin(id), CheckinResult, SelfCheckinRequest.parse({ qr })),
  trips: (date: string) => api.get(ENDPOINTS.driverTrips, z.array(DriverTrip), { date }),
  manifest: (id: string) => api.get(ENDPOINTS.driverManifest(id), z.array(DriverManifestRow)),
  checkin: (id: string, qr: string, method: "CAMERA" | "DATAWEDGE") => api.post(ENDPOINTS.driverCheckin(id), CheckinResult, DriverCheckinRequest.parse({ qr, method: method === "DATAWEDGE" ? "DRIVER_SCANNER" : "DRIVER_CAMERA" })),
  start: (id: string) => api.post(ENDPOINTS.tripStart(id), TripExecution),
  end: (id: string) => api.post(ENDPOINTS.tripEnd(id), TripExecution),
};
export async function flushTelemetry(tripId: string) {
  await drainLocations(tripId, async (samples) => {
    await ensureSession();
    await api.post(ENDPOINTS.tripLocations(tripId), LocationBatchResult, LocationBatch.parse({ samples }));
  });
}
setLocationReporter(async (tripId, location) => {
  const sample = {
    sampleId: `${tripId}-${location.timestamp}`, lat: location.coords.latitude, lng: location.coords.longitude,
    accuracy: location.coords.accuracy, speed: location.coords.speed, heading: location.coords.heading,
    capturedAt: new Date(location.timestamp).toISOString(),
  };
  await enqueueLocations(tripId, [sample], () => trackingContextMatches(tripId));
  await flushTelemetry(tripId);
});
