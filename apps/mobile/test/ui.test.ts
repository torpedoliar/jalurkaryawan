import { describe, expect, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { BusInput, SubscriptionInput, TripTemplateInput, UserInput, VendorInput } from "@bms/shared";
import { ApiFailure } from "../src/api";
import { errorText, useLoad } from "../src/ui";

describe("errorText", () => {
  test("ApiFailure keeps the server message verbatim", () => {
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

  test("unknown errors fall back to the generic Indonesian line", () => {
    expect(errorText(new Error("boom"))).toBe("Terjadi kesalahan. Coba lagi.");
  });
});

describe("useLoad", () => {
  test("a failed fetch surfaces the server message as error", async () => {
    const { result } = await renderHook(() => useLoad(() => Promise.reject(new ApiFailure("TRIP_FULL", "Sudah penuh.", 409)), []));
    await waitFor(() => expect(result.current.error).toBe("Sudah penuh."));
    expect(result.current.data).toBeUndefined();
  });

  test("a stale response from a changed dependency is discarded", async () => {
    let resolveFirst: (v: string) => void = () => {};
    const first = new Promise<string>((r) => { resolveFirst = r; });
    const fetches: Record<string, () => Promise<string>> = {
      a: () => first,
      b: () => Promise.resolve("b-data"),
    };
    // RNTL v14: renderHook is async, rerender returns a promise.
    const { result, rerender } = await renderHook(({ dep }: { dep: string }) => useLoad(() => fetches[dep]!(), [dep]), {
      initialProps: { dep: "a" },
    });
    await rerender({ dep: "b" });
    await waitFor(() => expect(result.current.data).toBe("b-data"));
    await act(async () => resolveFirst("a-data"));
    expect(result.current.data).toBe("b-data");
  });
});
