import { describe, expect, test } from "vitest";
import { DriverCheckinRequest, LocationBatch, SelfCheckinRequest, StopInput, UserInput } from "../src";

describe("operations contracts", () => {
  test("coordinates are optional as a pair and must be geographical", () => {
    const stop = { name: "Halte", seq: 1, offsetMinutes: 0 };
    expect(StopInput.safeParse(stop).success).toBe(true);
    expect(StopInput.safeParse({ ...stop, lat: -6.2, lng: 107.1 }).success).toBe(true);
    for (const coords of [{ lat: -6.2 }, { lng: 107 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: NaN, lng: 0 }]) {
      expect(StopInput.safeParse({ ...stop, ...coords }).success).toBe(false);
    }
  });
  test("drivers need a vendor and employee accounts must not have one", () => {
    const base = { nik: "d1", name: "Sopir", role: "DRIVER" };
    expect(UserInput.safeParse(base).success).toBe(false);
    expect(UserInput.safeParse({ ...base, vendorId: "v1" }).success).toBe(true);
    expect(UserInput.safeParse({ ...base, role: "EMPLOYEE", vendorId: "v1" }).success).toBe(false);
  });
  test("scanner endpoints reject the wrong kind of QR", () => {
    expect(DriverCheckinRequest.safeParse({ qr: "BMS-B1:bus-secret", method: "DRIVER_SCANNER" }).success).toBe(false);
    expect(SelfCheckinRequest.safeParse({ qr: "BMS-T1:ticket-secret" }).success).toBe(false);
    expect(DriverCheckinRequest.safeParse({ qr: "BMS-T1:ticket-secret", method: "DRIVER_CAMERA" }).success).toBe(true);
    expect(SelfCheckinRequest.safeParse({ qr: "BMS-B1:bus-secret" }).success).toBe(true);
  });
  test("location ingestion has bounded batches and coordinates", () => {
    const sample = { sampleId: "sample-0001", lat: -6.3, lng: 107.1, capturedAt: "2026-10-14T05:00:00+07:00" };
    expect(LocationBatch.safeParse({ samples: [sample] }).success).toBe(true);
    expect(LocationBatch.safeParse({ samples: [] }).success).toBe(false);
    expect(LocationBatch.safeParse({ samples: Array(101).fill(sample) }).success).toBe(false);
    expect(LocationBatch.safeParse({ samples: [{ ...sample, lat: 100 }] }).success).toBe(false);
  });
});
