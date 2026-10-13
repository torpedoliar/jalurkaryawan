import { ADMIN_ROLES, ENDPOINTS, IsoDate, addDays, type DashboardSummary, type NoShowCandidate, type OccupancyRow } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, nowIso, today, type Db } from "../db";
import { handle, type Ctx } from "../http";
import { find, p, paginate, q } from "./util";

const viewer = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: [...ADMIN_ROLES, "VENDOR"] });

function range(ctx: Ctx) {
  const from = IsoDate.parse(q(ctx.url, "from") ?? today(ctx.db));
  const to = IsoDate.parse(q(ctx.url, "to") ?? from);
  if (to < from) throw new DomainError("VALIDATION_ERROR", "Tanggal akhir sebelum tanggal mulai.");
  return { from, to };
}

/** Spec 5.11: share copy failure shows on the Super Admin dashboard. */
function backupWarning(db: Db): string | null {
  const last = [...db.backups].filter((b) => !b.name.startsWith("pre-restore-")).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!last) return "Belum ada backup.";
  if (db.settings.backup_share_enabled && !last.copiedToShare) return `Backup ${last.name} gagal disalin ke network share.`;
  return null;
}

function occupancy(db: Db, from: string, to: string): OccupancyRow[] {
  const rows = new Map<string, OccupancyRow>();
  for (const t of db.trips) {
    if (t.date < from || t.date > to || t.status !== "SCHEDULED") continue;
    const key = `${t.date}|${t.routeId}|${t.shiftId}|${t.direction}`;
    let row = rows.get(key);
    if (!row) {
      const route = find(db.routes, t.routeId);
      row = {
        date: t.date, routeId: route.id, routeCode: route.code, routeName: route.name, routeColor: route.color,
        shiftId: t.shiftId, shiftName: find(db.shifts, t.shiftId).name, direction: t.direction,
        trips: 0, capacity: 0, booked: 0,
        rejected: db.rejected.filter((r) => r.date === t.date && r.routeId === t.routeId && r.shiftId === t.shiftId && r.direction === t.direction).length,
      };
      rows.set(key, row);
    }
    row.trips++;
    row.capacity += t.capacity;
    row.booked += t.bookedCount;
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.routeCode.localeCompare(b.routeCode) || a.shiftId.localeCompare(b.shiftId) || a.direction.localeCompare(b.direction));
}

export const reportHandlers = [
  http.get(p(ENDPOINTS.dashboard), handle((ctx) => {
    const u = viewer(ctx);
    const db = ctx.db;
    const date = IsoDate.parse(q(ctx.url, "date") ?? today(db));
    const trips = db.trips.filter((t) => t.date === date && t.status === "SCHEDULED");
    const rejectedOn = (d: string) => db.rejected.filter((r) => r.date === d).length;
    return {
      date,
      trips: trips.length,
      capacity: trips.reduce((n, t) => n + t.capacity, 0),
      booked: trips.reduce((n, t) => n + t.bookedCount, 0),
      fullTrips: trips.filter((t) => t.bookedCount >= t.capacity).length,
      rejectedToday: rejectedOn(date),
      rejectedYesterday: rejectedOn(addDays(date, -1)),
      rejectedLast7: Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) => ({ date: d, count: rejectedOn(d) })),
      backupWarning: u.role === "SUPER_ADMIN" ? backupWarning(db) : null,
    } satisfies DashboardSummary;
  })),
  http.get(p(ENDPOINTS.occupancy), handle((ctx) => {
    viewer(ctx);
    const { from, to } = range(ctx);
    return occupancy(ctx.db, from, to);
  })),
  http.get(p(ENDPOINTS.rejected), handle((ctx) => {
    viewer(ctx);
    const { from, to } = range(ctx);
    return ctx.db.rejected.filter((r) => r.date >= from && r.date <= to).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  })),
  /** NO_SHOW is marked by attendance (sub-project B); the list is ready for when it exists. */
  http.get(p(ENDPOINTS.noShowCandidates), handle((ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const since = addDays(today(ctx.db), -30);
    const counts = new Map<string, number>();
    for (const b of ctx.db.bookings) if (b.status === "NO_SHOW" && b.date >= since) counts.set(b.userId, (counts.get(b.userId) ?? 0) + 1);
    return [...counts].map(([userId, noShows30d]): NoShowCandidate => {
      const u = find(ctx.db.users, userId);
      return { userId, nik: u.nik, name: u.name, noShows30d };
    }).sort((a, b) => b.noShows30d - a.noShows30d);
  })),

  http.get(p(ENDPOINTS.notifications), handle((ctx) => {
    const u = requireUser(ctx.db, ctx.request);
    return ctx.db.notifications
      .filter((n) => n.userId === u.id)
      .map(({ userId: _u, ...n }) => n)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  })),
  http.post(p(ENDPOINTS.notificationRead(":id")), handle((ctx) => {
    const u = requireUser(ctx.db, ctx.request);
    const n = ctx.db.notifications.find((x) => x.id === ctx.params.id && x.userId === u.id);
    if (!n) throw new DomainError("NOT_FOUND");
    n.readAt ??= nowIso(ctx.db);
  })),

  http.get(p(ENDPOINTS.audit), handle((ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const actorId = q(ctx.url, "actorId");
    const action = q(ctx.url, "action");
    const from = q(ctx.url, "from");
    const to = q(ctx.url, "to");
    const rows = ctx.db.audit
      .filter((a) => (!actorId || a.actorId === actorId) && (!action || a.action === action) &&
        (!from || a.createdAt.slice(0, 10) >= from) && (!to || a.createdAt.slice(0, 10) <= to))
      .reverse();
    return paginate(rows, ctx.url);
  })),
];