import { describe, expect, test } from "vitest";
import { BusInput, SubscriptionInput, TripTemplateInput, UserInput, VendorInput } from "@bms/shared";
import { errorText } from "../src/ui";

describe("errorText", () => {
  test("ApiFailure keeps the server message verbatim", async () => {
    const { ApiFailure } = await import("../src/api");
    expect(errorText(new ApiFailure("TRIP_FULL", "Trip penuh.", 409))).toBe("Trip penuh.");
  });

  test("whitespace-only name reads as an empty required field", () => {
    expect(errorText(VendorInput.safeParse({ name: "   " }).error)).toBe("name: minimal 1 karakter.");
  });

  test("emptied number names the field and the minimum", () => {
    const err = BusInput.safeParse({ plate: "B 9999 ZZ", capacity: Number(""), vendorId: "v1" }).error;
    expect(errorText(err)).toBe("capacity: minimal 1.");
  });

  test("empty weekday array names the field and the minimum", () => {
    const err = TripTemplateInput.safeParse({
      routeId: "r1", shiftId: "sh1", direction: "PICKUP", busId: "b1",
      departureTime: "06:00", dayOffset: 0, weekdays: [],
    }).error;
    expect(errorText(err)).toBe("weekdays: minimal 1 elemen.");
  });

  test("wrong type on a string field says the format is wrong", () => {
    const err = SubscriptionInput.safeParse({
      routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "PICKUP", startDate: 123, weekdays: [1],
    }).error;
    expect(errorText(err)).toBe("startDate: format tidak sesuai.");
  });

  test("missing field is reported as required, not as a format error", () => {
    const err = VendorInput.safeParse({ contact: "021-1" }).error;
    expect(errorText(err)).toBe("name wajib diisi.");
  });

  test("schema author's Indonesian messages pass through unchanged", () => {
    const err = UserInput.safeParse({ nik: "V1", name: "Vendor", role: "VENDOR", vendorId: null }).error;
    expect(errorText(err)).toBe("vendorId wajib hanya untuk role VENDOR");
  });

  test("custom message on a min() check still passes through", async () => {
    const { ImportRow } = await import("@bms/shared");
    expect(errorText(ImportRow.safeParse({ nik: "   ", name: "Ani" }).error)).toBe("NIK kosong");
  });

  test("unknown errors fall back to the generic Indonesian line", () => {
    expect(errorText(new Error("boom"))).toBe("Terjadi kesalahan. Coba lagi.");
  });
});
