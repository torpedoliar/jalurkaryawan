import { describe, expect, test } from "vitest";
import {
  ApiError, DailyBookingRequest, Departure, ENDPOINTS, ERROR_HTTP_STATUS, ERROR_MESSAGES,
  ErrorCode, LoginRequest, RestoreRequest, RouteInput, SubscriptionInput, UserInput,
} from "../src/index";

describe("contract", () => {
  test("every error code has a message and HTTP status", () => {
    for (const code of ErrorCode.options) {
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(5);
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(ERROR_HTTP_STATUS.MAINTENANCE).toBe(503);
    expect(ApiError.parse({ code: "TRIP_FULL", message: "x" }).code).toBe("TRIP_FULL");
  });

  test("route color must be #RRGGBB", () => {
    expect(RouteInput.safeParse({ code: "R1", name: "Cikarang", color: "#D6322B" }).success).toBe(true);
    expect(RouteInput.safeParse({ code: "R1", name: "Cikarang", color: "red" }).success).toBe(false);
  });

  test("daily booking date is YYYY-MM-DD", () => {
    const base = { routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "PICKUP" };
    expect(DailyBookingRequest.safeParse({ ...base, date: "2026-10-14" }).success).toBe(true);
    expect(DailyBookingRequest.safeParse({ ...base, date: "14/10/2026" }).success).toBe(false);
  });

  test("subscription weekdays 1..7 non-empty, end >= start", () => {
    const base = { routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "DROPOFF", startDate: "2026-10-14" };
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [1, 2, 3] }).success).toBe(true);
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [] }).success).toBe(false);
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [8] }).success).toBe(false);
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [1], endDate: "2026-10-01" }).success).toBe(false);
  });

  test("vendor role requires vendorId, other roles forbid it", () => {
    const u = { nik: "V1", name: "Vendor", role: "VENDOR" };
    expect(UserInput.safeParse({ ...u, vendorId: "v1" }).success).toBe(true);
    expect(UserInput.safeParse(u).success).toBe(false);
    expect(UserInput.safeParse({ ...u, role: "ADMIN_GA", vendorId: "v1" }).success).toBe(false);
  });

  test("departure board row carries no passenger data", () => {
    const keys = Object.keys(Departure.shape);
    expect(keys).not.toContain("passengers");
    expect(keys).not.toContain("name");
  });

  test("restore requires typed RESTORE", () => {
    expect(RestoreRequest.safeParse({ fileName: "a.dump", password: "p", confirm: "restore" }).success).toBe(false);
  });

  test("login requires nik", () => {
    expect(LoginRequest.safeParse({ nik: " ", password: "x" }).success).toBe(false);
  });

  test("endpoint builders", () => {
    expect(ENDPOINTS.tripPassengers("t1")).toBe("/api/trips/t1/passengers");
    expect(ENDPOINTS.departures).toBe("/api/departures");
  });
});
