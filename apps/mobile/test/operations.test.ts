import { ENDPOINTS } from "@bms/shared";
import { api } from "../src/api";
import { operations } from "../src/operations";

jest.mock("../src/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, ensureSession: jest.fn() }));
describe("canonical operational contracts", () => {
  beforeEach(() => jest.clearAllMocks());
  it("posts a bus QR for a specific employee booking, never a raw ID as a ticket", async () => {
    jest.mocked(api.post).mockResolvedValue({ alreadyCheckedIn: false } as never);
    await operations.selfCheckin("booking-1", "BMS-B1:opaque");
    expect(api.post).toHaveBeenCalledWith(ENDPOINTS.selfCheckin("booking-1"), expect.anything(), { qr: "BMS-B1:opaque" });
  });
  it("maps native Zebra and camera to the supported server methods", async () => {
    await operations.checkin("trip-1", "BMS-T1:opaque", "DATAWEDGE");
    expect(api.post).toHaveBeenLastCalledWith(ENDPOINTS.driverCheckin("trip-1"), expect.anything(), { qr: "BMS-T1:opaque", method: "DRIVER_SCANNER" });
    await operations.checkin("trip-1", "BMS-T1:opaque", "CAMERA");
    expect(api.post).toHaveBeenLastCalledWith(ENDPOINTS.driverCheckin("trip-1"), expect.anything(), { qr: "BMS-T1:opaque", method: "DRIVER_CAMERA" });
  });
  it("propagates offline errors instead of returning check-in success", async () => {
    jest.mocked(api.post).mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(operations.selfCheckin("booking-1", "BMS-B1:opaque")).rejects.toThrow("Network request failed");
  });
});
