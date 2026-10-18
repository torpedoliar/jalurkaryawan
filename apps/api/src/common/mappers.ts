import type { Booking, Departure, Passenger, UserSummary } from '@bms/shared';
import { cutoffAt, departureStatus, jakartaDate, stopTime, toJakartaIso } from '@bms/shared';

/** UserSummary wire shape (mock util.toSummary parity); dates via @bms/shared Jakarta helpers. */
export function toUserSummary(u: {
  id: string; nik: string; name: string; department: string; phone: string; role: string;
  authProvider: string; active: boolean; vendorId: string | null;
  bookingSuspendedUntil: Date | null; suspendReason: string | null; lockedUntil: Date | null;
}): UserSummary {
  return {
    id: u.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone,
    role: u.role as UserSummary['role'],
    authProvider: u.authProvider as UserSummary['authProvider'],
    active: u.active, vendorId: u.vendorId,
    bookingSuspendedUntil: u.bookingSuspendedUntil ? jakartaDate(u.bookingSuspendedUntil) : null,
    suspendReason: u.suspendReason,
    lockedUntil: u.lockedUntil ? toJakartaIso(u.lockedUntil.getTime()) : null,
  };
}

export interface BookingContext {
  routeCode: string; routeName: string; routeColor: string; stopName: string;
  busPlate: string; departureAt: string; direction: 'PICKUP' | 'DROPOFF';
  stopOffset: number; maxStopOffset: number; cutoffMinutes: number;
  seatsLeft: number; capacity: number;
}

/** toBooking: contract `Booking` plus route/stop/bus/departure derived fields (mock util.toBooking parity). */
export function toBooking(row: {
  id: string; userId: string; tripId: string | null; routeId: string; stopId: string;
  subscriptionId: string | null; shiftId: string; direction: string; date: string;
  status: string; source: string; cancelReason: string | null; cancelledAt: Date | null; createdAt: Date;
}, ctx: BookingContext): Booking {
  return {
    id: row.id, userId: row.userId, tripId: row.tripId!, stopId: row.stopId,
    subscriptionId: row.subscriptionId, shiftId: row.shiftId,
    direction: row.direction as Booking['direction'], date: row.date,
    status: row.status as Booking['status'], source: row.source as Booking['source'],
    cancelReason: row.cancelReason as Booking['cancelReason'],
    cancelledAt: row.cancelledAt ? toJakartaIso(row.cancelledAt.getTime()) : null,
    createdAt: toJakartaIso(row.createdAt.getTime()),
    routeCode: ctx.routeCode, routeName: ctx.routeName, routeColor: ctx.routeColor,
    stopName: ctx.stopName, busPlate: ctx.busPlate, departureAt: ctx.departureAt,
    pickupAt: stopTime(ctx.departureAt, ctx.direction, ctx.stopOffset, ctx.maxStopOffset),
    cutoffAt: cutoffAt(ctx.departureAt, ctx.cutoffMinutes),
    seatsLeft: ctx.seatsLeft, capacity: ctx.capacity,
  };
}

/** Manifest row (contract `Passenger`; mock util.toPassenger parity — no status field). */
export function toPassenger(row: {
  bookingId: string; nik: string; name: string; department: string; phone: string;
  stopName: string; stopSeq: number; pickupAt: string;
}): Passenger {
  return {
    bookingId: row.bookingId, nik: row.nik, name: row.name, department: row.department,
    phone: row.phone, stopName: row.stopName, stopSeq: row.stopSeq, pickupAt: row.pickupAt,
  };
}

/** Departure board row (contract `Departure`; mock util.toDeparture parity). `mine` = caller holds a BOOKED seat. */
export function toDeparture(trip: {
  tripId: string; date: string; departureAt: string; routeId: string; routeCode: string;
  routeName: string; routeColor: string; shiftId: string; shiftName: string;
  direction: 'PICKUP' | 'DROPOFF'; busPlate: string;
  bookedCount: number; capacity: number; status: string; hasBooking?: boolean;
}): Departure {
  return {
    tripId: trip.tripId, date: trip.date, departureAt: trip.departureAt,
    routeId: trip.routeId, routeCode: trip.routeCode, routeName: trip.routeName, routeColor: trip.routeColor,
    shiftId: trip.shiftId, shiftName: trip.shiftName, direction: trip.direction,
    busPlate: trip.busPlate,
    bookedCount: trip.bookedCount, capacity: trip.capacity,
    status: departureStatus(trip.status as 'SCHEDULED' | 'CANCELLED', trip.capacity, trip.bookedCount),
    mine: !!trip.hasBooking,
  };
}
