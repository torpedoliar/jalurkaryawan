import { z } from "zod";
import { Direction } from "../enums";
import { HexColor, Id, IsoDate, IsoDateTime } from "./common";

/**
 * Trip operations: driver assignment, attendance (check-in) and GPS tracking.
 * Attendance and tracking are independent: a missing GPS never blocks check-in, and GPS never creates attendance.
 */

/** How a booking was checked in. One attendance per booking, whichever method arrives first wins. */
export const CheckinMethod = z.enum(["DRIVER_SCANNER", "DRIVER_CAMERA", "EMPLOYEE_BUS_QR", "ADMIN_MANUAL"]);
export type CheckinMethod = z.infer<typeof CheckinMethod>;

/** Lifecycle of a driver's run of one trip. Separate from TripStatus so reservation queries are unaffected. */
export const ExecutionStatus = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

/**
 * Check-in window, in minutes relative to the passenger's own stop time (pickupAt):
 * opens CHECKIN_OPEN_BEFORE_MIN before, closes CHECKIN_CLOSE_AFTER_MIN after. Server time is authoritative.
 */
export const CHECKIN_OPEN_BEFORE_MIN = 60;
export const CHECKIN_CLOSE_AFTER_MIN = 90;
/** A location older than this is shown as "last known", never as live. */
export const LOCATION_STALE_SECONDS = 120;
export const LOCATION_BATCH_MAX = 100;

/** Opaque QR payloads. Prefixes let a scanner reject the wrong kind of code before calling the API. */
export const TICKET_QR_PREFIX = "BMS-T1:";
export const BUS_QR_PREFIX = "BMS-B1:";
const TicketQr = z.string().trim().startsWith(TICKET_QR_PREFIX, "Bukan QR tiket.").max(200);
const BusQr = z.string().trim().startsWith(BUS_QR_PREFIX, "Bukan QR bus.").max(200);

// ---------- QR credentials

/** GET ticketQr(bookingId), owner employee only. Only for a BOOKED booking on a scheduled trip. */
export const TicketQrResponse = z.object({ bookingId: Id, qr: TicketQr, expiresAt: IsoDateTime });
export type TicketQrResponse = z.infer<typeof TicketQrResponse>;

/** GET busQr(busId) / POST busQrRotate(busId), admins only. Rotation revokes the previous printed code. */
export const BusQrResponse = z.object({ busId: Id, plate: z.string(), qr: BusQr, rotatedAt: IsoDateTime });
export type BusQrResponse = z.infer<typeof BusQrResponse>;

// ---------- attendance

export const Attendance = z.object({
  bookingId: Id, tripId: Id, busId: Id, checkedInAt: IsoDateTime, method: CheckinMethod,
});
export type Attendance = z.infer<typeof Attendance>;

/**
 * Result of any check-in call. `alreadyCheckedIn` true means an earlier scan won; `attendance` is that original record.
 * A rejected scan is an ApiError (4xx), never a CheckinResult.
 */
export const CheckinResult = z.object({
  attendance: Attendance, alreadyCheckedIn: z.boolean(),
  passenger: z.object({ name: z.string(), stopName: z.string(), pickupAt: IsoDateTime }),
});
export type CheckinResult = z.infer<typeof CheckinResult>;

/** POST driverCheckin(tripId), DRIVER assigned to the trip. */
export const DriverCheckinRequest = z.object({
  qr: TicketQr, method: z.enum(["DRIVER_SCANNER", "DRIVER_CAMERA"]),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type DriverCheckinRequest = z.infer<typeof DriverCheckinRequest>;

/** POST selfCheckin(bookingId), owner EMPLOYEE. The bus QR must belong to the booking's trip bus. */
export const SelfCheckinRequest = z.object({ qr: BusQr, clientRequestId: z.string().min(8).max(64).optional() });
export type SelfCheckinRequest = z.infer<typeof SelfCheckinRequest>;

// ---------- driver

/** PUT tripDriver(tripId), admins. driverId null unassigns. Driver must be active, role DRIVER, same vendor as the bus. */
export const AssignDriverRequest = z.object({ driverId: Id.nullable() });
export type AssignDriverRequest = z.infer<typeof AssignDriverRequest>;

/** GET driverTrips?date=, DRIVER: own assigned trips for the operational date (default today, Asia/Jakarta). */
export const DriverTrip = z.object({
  tripId: Id, date: IsoDate, departureAt: IsoDateTime, direction: Direction,
  routeCode: z.string(), routeName: z.string(), routeColor: HexColor, shiftName: z.string(),
  busId: Id, busPlate: z.string(), cancelled: z.boolean(),
  bookedCount: z.number().int(), checkedInCount: z.number().int(),
  execution: ExecutionStatus, startedAt: IsoDateTime.nullable(), endedAt: IsoDateTime.nullable(),
});
export type DriverTrip = z.infer<typeof DriverTrip>;

/** GET driverManifest(tripId), DRIVER assigned. Minimal fields: no NIK, phone or department. */
export const DriverManifestRow = z.object({
  bookingId: Id, name: z.string(), stopName: z.string(), stopSeq: z.number().int(), pickupAt: IsoDateTime,
  checkedIn: z.boolean(), checkedInAt: IsoDateTime.nullable(), method: CheckinMethod.nullable(),
});
export type DriverManifestRow = z.infer<typeof DriverManifestRow>;

/** POST tripStart(tripId) / tripEnd(tripId), DRIVER assigned. Start is idempotent; one IN_PROGRESS run per trip. */
export const TripExecution = z.object({
  tripId: Id, driverId: Id, status: ExecutionStatus,
  startedAt: IsoDateTime.nullable(), endedAt: IsoDateTime.nullable(),
});
export type TripExecution = z.infer<typeof TripExecution>;

// ---------- GPS

/** sampleId is generated on the device; the server ignores a sampleId it already stored. */
export const LocationSample = z.object({
  sampleId: z.string().min(8).max(64),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  accuracy: z.number().finite().min(0).nullable().default(null),
  speed: z.number().finite().nullable().default(null), heading: z.number().finite().nullable().default(null),
  capturedAt: IsoDateTime,
});
export type LocationSample = z.infer<typeof LocationSample>;

/** POST tripLocations(tripId), DRIVER with the IN_PROGRESS run. Rejected once the run is COMPLETED. */
export const LocationBatch = z.object({ samples: z.array(LocationSample).min(1).max(LOCATION_BATCH_MAX) });
export type LocationBatch = z.infer<typeof LocationBatch>;
export const LocationBatchResult = z.object({ accepted: z.number().int(), duplicates: z.number().int() });
export type LocationBatchResult = z.infer<typeof LocationBatchResult>;

/** Latest known position of one trip's bus. `position` null = no sample yet. Clients compute staleness from capturedAt. */
export const BusPosition = z.object({
  tripId: Id, busId: Id, busPlate: z.string(), routeId: Id, routeCode: z.string(), routeColor: HexColor,
  direction: Direction, departureAt: IsoDateTime, execution: ExecutionStatus, driverName: z.string().nullable(),
  position: z.object({
    lat: z.number(), lng: z.number(), accuracy: z.number().nullable(), capturedAt: IsoDateTime,
  }).nullable(),
});
export type BusPosition = z.infer<typeof BusPosition>;
/** GET tracking?date=, admins: every trip of the date. GET myBusPosition(bookingId), owner employee: that booking's trip only. */

// ---------- admin manifest extension

/** GET tripAttendance(tripId), admins: attendance per booking for the manifest column. */
export const TripAttendanceRow = z.object({ bookingId: Id, checkedInAt: IsoDateTime, method: CheckinMethod });
export type TripAttendanceRow = z.infer<typeof TripAttendanceRow>;
