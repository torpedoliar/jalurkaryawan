import {
  ADMIN_ROLES, CancelDateRequest, ChangeBusRequest, Direction, ENDPOINTS, Id, IsoDate, TripTemplateInput,
  cutoffAt, isPastCutoff, type Availability,
} from "@bms/shared";
import { http } from "msw";
import { z } from "zod";
import { requireUser } from "../auth";
import { DomainError, audit, nextId, today, type Db } from "../db";
import { generateTrips } from "../domain/allocate";
import { cancelDate, cancelTrip, changeTripBus } from "../domain/admin";
import { handle, parseBody, type Ctx } from "../http";
import { find, p, q, toDeparture, toPassenger } from "./util";

const admin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
const dateParam = (ctx: Ctx) => IsoDate.parse(q(ctx.url, "date") ?? today(ctx.db));
const AvailabilityQuery = z.object({ routeId: Id, shiftId: Id, direction: Direction, date: IsoDate });

function checkTemplate(db: Db, t: TripTemplateInput) {
  find(db.routes, t.routeId);
  find(db.shifts, t.shiftId);
  if (!find(db.buses, t.busId).active) throw new DomainError("VALIDATION_ERROR", "Bus tidak aktif.");
}

/** New template also fills dates the nightly job already generated (spec 5.2). */
function fillGeneratedDates(db: Db) {
  for (const date of new Set(db.trips.map((t) => t.date).filter((d) => d >= today(db)))) generateTrips(db, date);
}

export const tripHandlers = [
  http.get(p(ENDPOINTS.templates), handle((ctx) => (admin(ctx), ctx.db.templates))),
  http.post(p(ENDPOINTS.templates), handle(async (ctx) => {
    const u = admin(ctx);
    const input = await parseBody(ctx.request, TripTemplateInput);
    checkTemplate(ctx.db, input);
    const row = { id: nextId(ctx.db, "tp"), ...input };
    ctx.db.templates.push(row);
    audit(ctx.db, u.id, "TEMPLATE_CREATE", "template", row.id, null, row);
    fillGeneratedDates(ctx.db);
    return row;
  })),
  http.put(p(ENDPOINTS.template(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.templates, ctx.params.id);
    const input = await parseBody(ctx.request, TripTemplateInput);
    checkTemplate(ctx.db, input);
    const before = { ...row };
    Object.assign(row, input);
    audit(ctx.db, u.id, "TEMPLATE_UPDATE", "template", row.id, before, row);
    // ponytail: edits apply to dates generated from now on; propagation to existing trips is backend work (Plan 4).
    fillGeneratedDates(ctx.db);
    return row;
  })),

  http.get(p(ENDPOINTS.trips), handle((ctx) => {
    admin(ctx);
    const date = dateParam(ctx);
    const routeId = q(ctx.url, "routeId");
    const shiftId = q(ctx.url, "shiftId");
    return ctx.db.trips
      .filter((t) => t.date === date && (!routeId || t.routeId === routeId) && (!shiftId || t.shiftId === shiftId))
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt) || a.id.localeCompare(b.id));
  })),
  http.put(p(ENDPOINTS.tripBus(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    changeTripBus(ctx.db, u.id, find(ctx.db.trips, ctx.params.id).id, (await parseBody(ctx.request, ChangeBusRequest)).busId);
    return find(ctx.db.trips, ctx.params.id);
  })),
  http.post(p(ENDPOINTS.tripCancel(":id")), handle((ctx) => {
    const u = admin(ctx);
    cancelTrip(ctx.db, u.id, find(ctx.db.trips, ctx.params.id).id);
    return find(ctx.db.trips, ctx.params.id);
  })),
  http.post(p(ENDPOINTS.tripsCancelDate), handle(async (ctx) => {
    const u = admin(ctx);
    return { cancelled: cancelDate(ctx.db, u.id, (await parseBody(ctx.request, CancelDateRequest)).date) };
  })),
  http.get(p(ENDPOINTS.tripPassengers(":id")), handle((ctx) => {
    admin(ctx);
    const trip = find(ctx.db.trips, ctx.params.id);
    return ctx.db.bookings
      .filter((b) => b.tripId === trip.id && b.status !== "CANCELLED")
      .map((b) => toPassenger(ctx.db, b))
      .sort((a, b) => a.stopSeq - b.stopSeq || a.name.localeCompare(b.name));
  })),

  /** Spec 6.2/6.3 departure board: every role, no passenger names. */
  http.get(p(ENDPOINTS.departures), handle((ctx) => {
    const u = requireUser(ctx.db, ctx.request);
    const date = dateParam(ctx);
    return ctx.db.trips
      .filter((t) => t.date === date)
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt) || a.id.localeCompare(b.id))
      .map((t) => toDeparture(ctx.db, t.id, u.id));
  })),

  /** Spec 5.4: seats for one combo. bookable mirrors allocateSeat: an open (pre-cutoff) trip with a free seat. */
  http.get(p(ENDPOINTS.availability), handle((ctx) => {
    requireUser(ctx.db, ctx.request);
    // Not Object.fromEntries(searchParams): tsconfig lib has no DOM.Iterable, so URLSearchParams is not iterable here.
    const f = AvailabilityQuery.parse({
      routeId: q(ctx.url, "routeId"), shiftId: q(ctx.url, "shiftId"),
      direction: q(ctx.url, "direction"), date: q(ctx.url, "date"),
    });
    const db = ctx.db;
    const min = db.settings.booking_cutoff_minutes;
    const trips = db.trips
      .filter((t) => t.routeId === f.routeId && t.shiftId === f.shiftId && t.direction === f.direction && t.date === f.date && t.status === "SCHEDULED")
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
    const first = trips[0]?.departureAt ?? null;
    return {
      ...f,
      capacity: trips.reduce((n, t) => n + t.capacity, 0),
      bookedCount: trips.reduce((n, t) => n + t.bookedCount, 0),
      firstDepartureAt: first,
      cutoffAt: first && cutoffAt(first, min),
      bookable: trips.some((t) => t.bookedCount < t.capacity && !isPastCutoff(t.departureAt, min, db.now())),
    } satisfies Availability;
  })),
];