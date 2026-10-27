import { DailyBookingRequest, ENDPOINTS, SELF_SERVICE_ROLES, SubscriptionInput } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, today } from "../db";
import { allocateSeat, cancelBooking } from "../domain/allocate";
import { createSubscription, endSubscription } from "../domain/generate";
import { handle, parseBody, type Ctx } from "../http";
import { p, q, toBooking } from "./util";

const rider = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: SELF_SERVICE_ROLES });

export const bookingHandlers = [
  http.get(p(ENDPOINTS.myBookings), handle((ctx) => {
    const u = rider(ctx);
    const from = q(ctx.url, "from");
    const to = q(ctx.url, "to");
    return ctx.db.bookings
      .filter((b) => b.userId === u.id && (!from || b.date >= from) && (!to || b.date <= to))
      .map((b) => toBooking(ctx.db, b))
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
  })),
  http.post(p(ENDPOINTS.bookings), handle(async (ctx) => {
    const u = rider(ctx);
    const input = await parseBody(ctx.request, DailyBookingRequest);
    return toBooking(ctx.db, allocateSeat(ctx.db, { ...input, userId: u.id, source: "DAILY", subscriptionId: null }));
  })),
  http.post(p(ENDPOINTS.bookingCancel(":id")), handle((ctx) => {
    const u = rider(ctx);
    const b = ctx.db.bookings.find((x) => x.id === ctx.params.id && x.userId === u.id);
    if (!b) throw new DomainError("NOT_FOUND");
    if (b.status !== "BOOKED") throw new DomainError("VALIDATION_ERROR", "Booking sudah tidak aktif.");
    cancelBooking(ctx.db, b, "USER", { checkCutoff: true });
    return toBooking(ctx.db, b);
  })),

  http.get(p(ENDPOINTS.mySubscriptions), handle((ctx) => {
    const u = rider(ctx);
    return ctx.db.subscriptions.filter((s) => s.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  })),
  http.post(p(ENDPOINTS.subscriptions), handle(async (ctx) => {
    const u = rider(ctx);
    const input = await parseBody(ctx.request, SubscriptionInput);
    const stop = ctx.db.stops.find((s) => s.id === input.stopId);
    if (!stop || stop.routeId !== input.routeId || !stop.active) throw new DomainError("VALIDATION_ERROR", "Titik jemput tidak valid untuk rute ini.");
    if (input.startDate < today(ctx.db)) throw new DomainError("VALIDATION_ERROR", "Tanggal mulai sudah lewat.");
    return createSubscription(ctx.db, u.id, input);
  })),
  http.post(p(ENDPOINTS.subscriptionEnd(":id")), handle((ctx) => {
    const u = rider(ctx);
    return endSubscription(ctx.db, u.id, ctx.params.id!);
  })),
];