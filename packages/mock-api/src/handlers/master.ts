import { ADMIN_ROLES, BusInput, ENDPOINTS, RouteInput, ShiftInput, StopInput, VendorInput } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, type Db } from "../db";
import { setBusCapacity } from "../domain/admin";
import { handle, parseBody, type Ctx } from "../http";
import { find, insert, notDeparted, p, update } from "./util";

const admin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
const reader = (ctx: Ctx) => requireUser(ctx.db, ctx.request);
const reject = (message: string) => { throw new DomainError("VALIDATION_ERROR", message); };

const inUseByTrips = (db: Db, key: "busId" | "routeId", id: string) =>
  db.templates.some((t) => t.active && t[key] === id) ||
  db.trips.some((t) => t[key] === id && t.status === "SCHEDULED" && notDeparted(db, t.departureAt));

function checkBus(db: Db, input: BusInput, id: string | null) {
  find(db.vendors, input.vendorId);
  if (db.buses.some((b) => b.plate === input.plate && b.id !== id)) reject(`Plat ${input.plate} sudah terdaftar.`);
}

export const masterHandlers = [
  http.get(p(ENDPOINTS.vendors), handle((ctx) => (reader(ctx), ctx.db.vendors))),
  http.post(p(ENDPOINTS.vendors), handle(async (ctx) => {
    const u = admin(ctx);
    return insert(ctx.db, u.id, ctx.db.vendors, "v", "vendor", await parseBody(ctx.request, VendorInput));
  })),
  http.put(p(ENDPOINTS.vendor(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.vendors, ctx.params.id);
    const input = await parseBody(ctx.request, VendorInput);
    if (!input.active && ctx.db.buses.some((b) => b.vendorId === row.id && b.active)) reject("Vendor masih punya bus aktif.");
    return update(ctx.db, u.id, row, "vendor", input);
  })),

  http.get(p(ENDPOINTS.buses), handle((ctx) => (reader(ctx), ctx.db.buses))),
  http.post(p(ENDPOINTS.buses), handle(async (ctx) => {
    const u = admin(ctx);
    const input = await parseBody(ctx.request, BusInput);
    checkBus(ctx.db, input, null);
    return insert(ctx.db, u.id, ctx.db.buses, "b", "bus", input);
  })),
  http.put(p(ENDPOINTS.bus(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.buses, ctx.params.id);
    const input = await parseBody(ctx.request, BusInput);
    checkBus(ctx.db, input, row.id);
    if (row.active && !input.active && inUseByTrips(ctx.db, "busId", row.id)) reject("Bus masih dipakai template aktif atau trip yang belum berangkat.");
    // Capacity goes through the domain rule so scheduled trips follow and CAPACITY_BELOW_BOOKED is enforced.
    if (input.capacity !== row.capacity) setBusCapacity(ctx.db, u.id, row.id, input.capacity);
    return update(ctx.db, u.id, row, "bus", input);
  })),

  http.get(p(ENDPOINTS.shifts), handle((ctx) => (reader(ctx), ctx.db.shifts))),
  http.post(p(ENDPOINTS.shifts), handle(async (ctx) => {
    const u = admin(ctx);
    return insert(ctx.db, u.id, ctx.db.shifts, "sh", "shift", await parseBody(ctx.request, ShiftInput));
  })),
  http.put(p(ENDPOINTS.shift(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    return update(ctx.db, u.id, find(ctx.db.shifts, ctx.params.id), "shift", await parseBody(ctx.request, ShiftInput));
  })),

  http.get(p(ENDPOINTS.routes), handle((ctx) => (reader(ctx), ctx.db.routes))),
  http.post(p(ENDPOINTS.routes), handle(async (ctx) => {
    const u = admin(ctx);
    const input = await parseBody(ctx.request, RouteInput);
    if (ctx.db.routes.some((r) => r.code === input.code)) reject(`Kode rute ${input.code} sudah dipakai.`);
    return insert(ctx.db, u.id, ctx.db.routes, "r", "route", input);
  })),
  http.put(p(ENDPOINTS.route(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.routes, ctx.params.id);
    const input = await parseBody(ctx.request, RouteInput);
    if (ctx.db.routes.some((r) => r.code === input.code && r.id !== row.id)) reject(`Kode rute ${input.code} sudah dipakai.`);
    if (row.active && !input.active && inUseByTrips(ctx.db, "routeId", row.id)) reject("Rute masih dipakai template aktif atau trip yang belum berangkat.");
    return update(ctx.db, u.id, row, "route", input);
  })),

  http.get(p(ENDPOINTS.routeStops(":routeId")), handle((ctx) => {
    reader(ctx);
    find(ctx.db.routes, ctx.params.routeId);
    return ctx.db.stops.filter((s) => s.routeId === ctx.params.routeId).sort((a, b) => a.seq - b.seq);
  })),
  http.post(p(ENDPOINTS.routeStops(":routeId")), handle(async (ctx) => {
    const u = admin(ctx);
    const route = find(ctx.db.routes, ctx.params.routeId);
    return insert(ctx.db, u.id, ctx.db.stops, "s", "stop", { ...(await parseBody(ctx.request, StopInput)), routeId: route.id });
  })),
  http.put(p(ENDPOINTS.stop(":routeId", ":stopId")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.stops, ctx.params.stopId);
    if (row.routeId !== ctx.params.routeId) throw new DomainError("NOT_FOUND");
    const input = await parseBody(ctx.request, StopInput);
    const db = ctx.db;
    const used = db.subscriptions.some((s) => s.stopId === row.id && s.status === "ACTIVE") ||
      db.bookings.some((b) => b.stopId === row.id && b.status === "BOOKED" && notDeparted(db, find(db.trips, b.tripId).departureAt));
    if (row.active && !input.active && used) reject("Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.");
    return update(db, u.id, row, "stop", input);
  })),
];