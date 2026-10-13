import { z } from "zod";
import { BookingSource, BookingStatus, CancelReason, Direction, SubscriptionStatus } from "../enums";
import { HexColor, Id, IsoDate, IsoDateTime, Weekdays } from "./common";

export const DailyBookingRequest = z.object({ routeId: Id, stopId: Id, shiftId: Id, direction: Direction, date: IsoDate });
export type DailyBookingRequest = z.infer<typeof DailyBookingRequest>;

/** Booking plus denormalized fields the ticket card needs. */
export const Booking = z.object({
  id: Id, userId: Id, tripId: Id, stopId: Id, subscriptionId: Id.nullable(),
  date: IsoDate, shiftId: Id, direction: Direction,
  source: BookingSource, status: BookingStatus,
  cancelReason: CancelReason.nullable(), cancelledAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
  routeCode: z.string(), routeName: z.string(), routeColor: HexColor, stopName: z.string(),
  busPlate: z.string(), departureAt: IsoDateTime, pickupAt: IsoDateTime, cutoffAt: IsoDateTime,
  seatsLeft: z.number().int(), capacity: z.number().int(),
});
export type Booking = z.infer<typeof Booking>;

export const SubscriptionInput = z.object({
  routeId: Id, stopId: Id, shiftId: Id, direction: Direction,
  startDate: IsoDate, endDate: IsoDate.nullable().default(null), weekdays: Weekdays,
}).refine((s) => s.endDate === null || s.endDate >= s.startDate, { message: "Tanggal akhir sebelum tanggal mulai", path: ["endDate"] });
export type SubscriptionInput = z.infer<typeof SubscriptionInput>;

export const Subscription = z.object({
  id: Id, userId: Id, routeId: Id, stopId: Id, shiftId: Id, direction: Direction,
  startDate: IsoDate, endDate: IsoDate.nullable(), weekdays: Weekdays,
  status: SubscriptionStatus, createdAt: IsoDateTime,
});
export type Subscription = z.infer<typeof Subscription>;

/** Outcome per already-generated date when a subscription is created (spec 5.3). */
export const SubscriptionCreateResponse = z.object({
  subscription: Subscription,
  booked: z.array(IsoDate), rejected: z.array(IsoDate), skippedCutoff: z.array(IsoDate),
});
export type SubscriptionCreateResponse = z.infer<typeof SubscriptionCreateResponse>;

export const RejectedRequest = z.object({
  id: Id, userId: Id, routeId: Id, shiftId: Id, direction: Direction, date: IsoDate,
  source: BookingSource, subscriptionId: Id.nullable(), createdAt: IsoDateTime,
});
export type RejectedRequest = z.infer<typeof RejectedRequest>;
