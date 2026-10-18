import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  ADMIN_ROLES, ERROR_MESSAGES, addDays, jakartaDate, toJakartaIso,
  type BookingSource, type DashboardSummary, type Direction, type NoShowCandidate,
  type NotificationType, type OccupancyRow, type RejectedRequest,
} from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';

const VIEWER_ROLES = [...ADMIN_ROLES, 'VENDOR'] as const;

type Actor = { id: string | null; role: string };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaClient, private readonly settings: SettingsService) {}

  private assertViewer(actor: { role: string }) {
    if (!(VIEWER_ROLES as readonly string[]).includes(actor.role)) {
      throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);
    }
  }

  /** mock GET /api/reports/dashboard wire (DashboardSummary). rejectedLast7 = 7 days ending at `date`. */
  async dashboard(actor: Actor, date?: string): Promise<DashboardSummary> {
    this.assertViewer(actor);
    const targetDate = date ?? jakartaDate(new Date());
    const trips = await this.prisma.trip.findMany({ where: { date: targetDate, status: 'SCHEDULED' } });
    const rejectedOn = (d: string) => this.prisma.rejectedRequest.count({ where: { date: d } });
    const rejectedLast7 = await Promise.all(
      Array.from({ length: 7 }, (_, i) => addDays(targetDate, i - 6)).map(async (d) => ({ date: d, count: await rejectedOn(d) })),
    );
    // backupWarning: SUPER_ADMIN only (mock reports.ts)
    let backupWarning: string | null = null;
    if (actor.role === 'SUPER_ADMIN') {
      const last = await this.prisma.backup.findFirst({
        where: { name: { startsWith: 'bms-' } },
        orderBy: { createdAt: 'desc' },
      });
      if (!last) backupWarning = 'Belum ada backup.';
      else if (this.settings.get().backup_share_enabled && !last.copiedToShare) {
        backupWarning = `Backup ${last.name} gagal disalin ke network share.`;
      }
    }
    return {
      date: targetDate,
      trips: trips.length,
      capacity: trips.reduce((s, t) => s + t.capacity, 0),
      booked: trips.reduce((s, t) => s + t.bookedCount, 0),
      fullTrips: trips.filter((t) => t.bookedCount >= t.capacity).length,
      rejectedToday: await rejectedOn(targetDate),
      rejectedYesterday: await rejectedOn(addDays(targetDate, -1)),
      rejectedLast7,
      backupWarning,
    };
  }

  /** mock occupancy(): SCHEDULED trips grouped date|routeId|shiftId|direction; rejected only counted for existing groups. */
  async occupancy(from?: string, to?: string): Promise<OccupancyRow[]> {
    const { from: startDate, to: endDate } = this.range(from, to);
    const trips = await this.prisma.trip.findMany({
      where: { date: { gte: startDate, lte: endDate }, status: 'SCHEDULED' },
      include: { route: true, shift: true },
    });
    const groups = new Map<string, OccupancyRow>();
    for (const t of trips) {
      const key = `${t.date}|${t.routeId}|${t.shiftId}|${t.direction}`;
      let row = groups.get(key);
      if (!row) {
        row = {
          date: t.date, routeId: t.routeId, routeCode: t.route.code, routeName: t.route.name, routeColor: t.route.color,
          shiftId: t.shiftId, shiftName: t.shift.name, direction: t.direction as Direction,
          trips: 0, capacity: 0, booked: 0, rejected: 0,
        };
        groups.set(key, row);
      }
      row.trips += 1;
      row.capacity += t.capacity;
      row.booked += t.bookedCount;
    }
    const rejected = await this.prisma.rejectedRequest.findMany({
      where: { date: { gte: startDate, lte: endDate } },
    });
    for (const r of rejected) {
      const g = groups.get(`${r.date}|${r.routeId}|${r.shiftId}|${r.direction}`);
      if (g) g.rejected += 1;
    }
    return [...groups.values()].sort((a, b) =>
      a.date.localeCompare(b.date) || a.routeCode.localeCompare(b.routeCode) ||
      a.shiftId.localeCompare(b.shiftId) || a.direction.localeCompare(b.direction));
  }

  /** mock GET /api/reports/rejected wire: contract RejectedRequest rows (db-only tripId/stopId/reason stripped). */
  async rejected(from?: string, to?: string): Promise<RejectedRequest[]> {
    const { from: startDate, to: endDate } = this.range(from, to);
    const rows = await this.prisma.rejectedRequest.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id, userId: r.userId, routeId: r.routeId, shiftId: r.shiftId,
      direction: r.direction as Direction, date: r.date, source: r.source as BookingSource,
      subscriptionId: r.subscriptionId, createdAt: toJakartaIso(r.createdAt.getTime()),
    }));
  }

  async noShowCandidates(): Promise<NoShowCandidate[]> {
    const since = addDays(jakartaDate(new Date()), -30);
    const rows = await this.prisma.booking.findMany({
      where: { status: 'NO_SHOW', date: { gte: since } },
      include: { user: true },
    });
    const counts = new Map<string, NoShowCandidate>();
    for (const b of rows) {
      const c = counts.get(b.userId) ?? { userId: b.userId, nik: b.user.nik, name: b.user.name, noShows30d: 0 };
      c.noShows30d += 1;
      counts.set(b.userId, c);
    }
    return [...counts.values()].sort((a, b) => b.noShows30d - a.noShows30d);
  }

  /** mock GET /api/me/notifications wire: own rows, userId stripped, ISO dates. */
  async notificationsList(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type as NotificationType,
      title: n.title, body: n.body,
      data: (n.data ?? {}) as Record<string, unknown>,
      readAt: n.readAt ? toJakartaIso(n.readAt.getTime()) : null,
      createdAt: toJakartaIso(n.createdAt.getTime()),
    }));
  }

  /** mock POST /api/me/notifications/:id/read: own else NOT_FOUND; readAt ??=; 204 via undefined. */
  async notificationRead(userId: string, id: string): Promise<void> {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new DomainError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
    if (!n.readAt) await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  private range(from?: string, to?: string) {
    const startDate = from ?? jakartaDate(new Date());
    const endDate = to ?? startDate;
    if (endDate < startDate) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir sebelum tanggal mulai.');
    return { from: startDate, to: endDate };
  }
}
