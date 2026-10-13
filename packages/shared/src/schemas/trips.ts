import { z } from "zod";
import { DepartureStatus, Direction, TripStatus } from "../enums";
import { HexColor, HhMm, Id, IsoDate, IsoDateTime, Weekdays } from "./common";

/** dayOffset 1 = departs the calendar day after the operational date (e.g. night-shift drop-off). */
export const TripTemplateInput = z.object({
  routeId: Id, shiftId: Id, direction: Direction, busId: Id,
  departureTime: HhMm, dayOffset: z.union([z.literal(0), z.literal(1)]),
  weekdays: Weekdays, active: z.boolean().default(true),
});
export type TripTemplateInput = z.infer<typeof TripTemplateInput>;
export const TripTemplate = TripTemplateInput.extend({ id: Id });
export type TripTemplate = z.infer<typeof TripTemplate>;

export const Trip = z.object({
  id: Id, templateId: Id, routeId: Id, shiftId: Id, direction: Direction,
  date: IsoDate, departureAt: IsoDateTime, busId: Id,
  capacity: z.number().int(), bookedCount: z.number().int(), status: TripStatus,
});
export type Trip = z.infer<typeof Trip>;

export const ChangeBusRequest = z.object({ busId: Id });
export type ChangeBusRequest = z.infer<typeof ChangeBusRequest>;
export const CancelDateRequest = z.object({ date: IsoDate });
export type CancelDateRequest = z.infer<typeof CancelDateRequest>;

/** Admin/vendor manifest row. pickupAt = departureAt + stop offset (PICKUP) or ETA (DROPOFF). */
export const Passenger = z.object({
  bookingId: Id, nik: z.string(), name: z.string(), department: z.string(), phone: z.string(),
  stopName: z.string(), stopSeq: z.number().int(), pickupAt: IsoDateTime,
});
export type Passenger = z.infer<typeof Passenger>;

/** Departure board row, readable by every role. No passenger data. */
export const Departure = z.object({
  tripId: Id, date: IsoDate, departureAt: IsoDateTime, direction: Direction,
  routeId: Id, routeCode: z.string(), routeName: z.string(), routeColor: HexColor,
  shiftId: Id, shiftName: z.string(), busPlate: z.string(),
  capacity: z.number().int(), bookedCount: z.number().int(),
  status: DepartureStatus, mine: z.boolean(),
});
export type Departure = z.infer<typeof Departure>;

/** Seats for one route+shift+direction+date combo (daily booking screen, spec 5.4). */
export const Availability = z.object({
  routeId: Id, shiftId: Id, direction: Direction, date: IsoDate,
  capacity: z.number().int(), bookedCount: z.number().int(),
  firstDepartureAt: IsoDateTime.nullable(), cutoffAt: IsoDateTime.nullable(), bookable: z.boolean(),
});
export type Availability = z.infer<typeof Availability>;
