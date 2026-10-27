jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startLocationUpdatesAsync: jest.fn(), stopLocationUpdatesAsync: jest.fn(), Accuracy: { High: 4 },
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { activeTracking, startTracking, stopTracking } from "../src/tracking";

describe("explicit driver tracking", () => {
  beforeEach(() => jest.clearAllMocks());
  it("does not stop an unrelated trip OS task or remove its context", async () => {
    await SecureStore.setItemAsync("bms_active_tracking", JSON.stringify({ tripId: "other" }));
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
    await stopTracking("viewed");
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(await SecureStore.getItemAsync("bms_active_tracking")).toContain("other");
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
  });
  it("clears context and queue even if OS stop rejects", async () => {
    await SecureStore.setItemAsync("bms_active_tracking", JSON.stringify({ tripId: "trip-1" }));
    await SecureStore.setItemAsync("bms_gps_pending_0", "pending");
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
    jest.mocked(Location.stopLocationUpdatesAsync).mockRejectedValueOnce(new Error("OS stop failed"));
    await expect(stopTracking()).rejects.toThrow("OS stop failed");
    expect(await SecureStore.getItemAsync("bms_active_tracking")).toBeNull();
    expect(await SecureStore.getItemAsync("bms_gps_pending_0")).toBeNull();
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(false);
  });
  it("does not start GPS when foreground permission is denied", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: "denied" } as never);
    await expect(startTracking("trip-1")).rejects.toThrow("Check-in tetap tersedia");
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
  it("requires background permission and does not silently fall back", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: "granted" } as never);
    jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ status: "denied" } as never);
    await expect(startTracking("trip-1")).rejects.toThrow("latar belakang");
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
  it("starts only explicitly and stops the operating-system task", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: "granted" } as never);
    jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue({ status: "granted" } as never);
    expect(await activeTracking()).toBeNull();
    await startTracking("trip-1");
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ foregroundService: expect.any(Object) }));
    jest.mocked(Location.hasStartedLocationUpdatesAsync).mockResolvedValue(true);
    await stopTracking();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
  });
});
