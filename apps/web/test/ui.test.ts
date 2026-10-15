import { describe, expect, test } from "vitest";
import { write } from "xlsx";
import { BusInput, SubscriptionInput, TripTemplateInput, UserInput, VendorInput } from "@bms/shared";
import { ApiFailure } from "../src/api";
import { errorText, pct, readXlsx } from "../src/ui";

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

describe("readXlsx", () => {
  test("readXlsx surfaces its own message for a truncated xlsx", async () => {
    // A truncated archive is what makes SheetJS throw "Unsupported ZIP file"; ApiFailure is what
    // lets errorText() show the Indonesian line instead of the generic one.
    const whole = new Uint8Array(write({ SheetNames: ["Data"], Sheets: { Data: {} } }, { type: "array", bookType: "xlsx" }) as number[]);
    const err = await readXlsx(new File([whole.subarray(0, 200)], "truncated.xlsx")).then(() => undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err).toMatchObject({ code: "VALIDATION_ERROR", message: "File truncated.xlsx bukan format Excel atau CSV yang bisa dibaca." });
    expect(errorText(err)).toBe("File truncated.xlsx bukan format Excel atau CSV yang bisa dibaca.");
  });
});

describe("pct", () => {
  test("rounds occupancy to whole percent", () => {
    expect(pct(174, 1314)).toBe(13);
    expect(pct(10, 50)).toBe(20);
  });

  test("a zero-capacity trip reads as 0%, not NaN", () => {
    expect(pct(0, 0)).toBe(0);
    expect(pct(5, 0)).toBe(0);
  });
});
