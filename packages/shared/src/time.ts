import type { DepartureStatus, Direction, TripStatus } from "./enums";

const OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta, fixed UTC+7, no DST
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export function toJakartaIso(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 19) + "+07:00";
}

export function jakartaDate(now: Date): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function departureAt(date: string, time: string, dayOffset: 0 | 1): string {
  return `${addDays(date, dayOffset)}T${time}:00+07:00`;
}

export function cutoffAt(departureAt: string, cutoffMinutes: number): string {
  return toJakartaIso(Date.parse(departureAt) - cutoffMinutes * MIN);
}

export function isPastCutoff(departureAt: string, cutoffMinutes: number, now: Date): boolean {
  return now.getTime() >= Date.parse(departureAt) - cutoffMinutes * MIN;
}

/** PICKUP: departure + offset. DROPOFF: stops visited in reverse, ETA = departure + (last − offset). */
export function stopTime(departureAt: string, direction: Direction, offsetMinutes: number, lastOffsetMinutes: number): string {
  const delta = direction === "PICKUP" ? offsetMinutes : lastOffsetMinutes - offsetMinutes;
  return toJakartaIso(Date.parse(departureAt) + delta * MIN);
}

export function departureStatus(tripStatus: TripStatus, capacity: number, booked: number): DepartureStatus {
  if (tripStatus === "CANCELLED") return "CANCELLED";
  if (booked >= capacity) return "FULL";
  return booked >= capacity * 0.9 ? "ALMOST" : "AVAILABLE";
}
