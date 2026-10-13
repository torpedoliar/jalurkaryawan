import { describe, expect, test } from "vitest";
import {
  addDays, cutoffAt, departureAt, departureStatus, isPastCutoff, isoWeekday, jakartaDate, stopTime, toJakartaIso,
} from "../src/index";

describe("time", () => {
  test("jakartaDate rolls over at 17:00 UTC", () => {
    expect(jakartaDate(new Date("2026-10-13T16:59:00Z"))).toBe("2026-10-13");
    expect(jakartaDate(new Date("2026-10-13T17:00:00Z"))).toBe("2026-10-14");
  });

  test("addDays crosses month and year", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("isoWeekday", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // Monday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
  });

  test("departureAt same day", () => {
    expect(departureAt("2026-10-14", "05:20", 0)).toBe("2026-10-14T05:20:00+07:00");
  });

  test("night shift drop-off with dayOffset 1 crosses midnight and month", () => {
    expect(departureAt("2026-10-31", "00:15", 1)).toBe("2026-11-01T00:15:00+07:00");
  });

  test("cutoff computed from the next-day instant", () => {
    const dep = departureAt("2026-10-14", "00:15", 1); // 15 Oct 00:15 WIB
    expect(cutoffAt(dep, 120)).toBe("2026-10-14T22:15:00+07:00");
    expect(isPastCutoff(dep, 120, new Date("2026-10-14T22:14:59+07:00"))).toBe(false);
    expect(isPastCutoff(dep, 120, new Date("2026-10-14T22:15:00+07:00"))).toBe(true);
  });

  test("cutoff 0 means up to departure", () => {
    const dep = "2026-10-14T05:20:00+07:00";
    expect(isPastCutoff(dep, 0, new Date("2026-10-14T05:19:00+07:00"))).toBe(false);
  });

  test("stopTime pickup adds offset, dropoff uses reversed order ETA", () => {
    const dep = "2026-10-14T05:00:00+07:00";
    expect(stopTime(dep, "PICKUP", 25, 60)).toBe("2026-10-14T05:25:00+07:00");
    // drop-off: first stop dropped is the last one on the pickup order
    expect(stopTime("2026-10-14T15:00:00+07:00", "DROPOFF", 0, 60)).toBe("2026-10-14T16:00:00+07:00");
    expect(stopTime("2026-10-14T15:00:00+07:00", "DROPOFF", 60, 60)).toBe("2026-10-14T15:00:00+07:00");
  });

  test("toJakartaIso", () => {
    expect(toJakartaIso(Date.parse("2026-10-13T22:30:00Z"))).toBe("2026-10-14T05:30:00+07:00");
  });

  test("departureStatus thresholds", () => {
    expect(departureStatus("SCHEDULED", 50, 44)).toBe("AVAILABLE");
    expect(departureStatus("SCHEDULED", 50, 45)).toBe("ALMOST"); // 90%
    expect(departureStatus("SCHEDULED", 50, 50)).toBe("FULL");
    expect(departureStatus("CANCELLED", 50, 0)).toBe("CANCELLED");
  });
});
