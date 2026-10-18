import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { addDays, departureAt, isoWeekday, jakartaDate } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AllocateService } from '../bookings/allocate.service';

/**
 * Trip generation (spec §5.2): one logical unit per date, ON CONFLICT (templateId,date)
 * DO NOTHING via createMany skipDuplicates — idempotent catch-up safe.
 */
@Injectable()
export class GenerateService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly allocate: AllocateService,
  ) {}

  /** Generate trips for one operational date. Returns count created. */
  async generateTrips(date: string): Promise<number> {
    const templates = await this.prisma.tripTemplate.findMany({
      where: { active: true },
      include: { bus: true },
    });
    const weekday = isoWeekday(date);
    const rows = templates
      .filter((t) => t.weekdays.includes(weekday))
      .map((t) => ({
        templateId: t.id,
        date,
        departureAt: departureAt(date, t.departureTime, t.dayOffset as 0 | 1),
        status: 'SCHEDULED' as const,
        bookedCount: 0,
        capacity: t.bus.capacity,
        routeId: t.routeId,
        shiftId: t.shiftId,
        direction: t.direction,
        busId: t.busId,
      }));
    if (!rows.length) return 0;
    const r = await this.prisma.trip.createMany({ data: rows, skipDuplicates: true });
    return r.count;
  }

  /** Generate today..today+generate_days_ahead (settings-driven). Returns total created. */
  async fillWindow(): Promise<number> {
    const today = jakartaDate(new Date());
    const ahead = this.settings.get().generate_days_ahead;
    let total = 0;
    for (let i = 0; i <= ahead; i++) {
      total += await this.generateTrips(addDays(today, i));
    }
    return total;
  }

  /** spec §5.2: generate SUBSCRIPTION-source bookings for one date. Idempotent via 4 skip rules. */
  async generateSubscriptionBookings(date: string): Promise<void> {
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gte: date } }],
        startDate: { lte: date },
      },
      orderBy: { createdAt: 'asc' },
    });
    const weekday = isoWeekday(date);
    for (const sub of subs) {
      if (!sub.weekdays.includes(weekday)) continue;
      // skip suspended-on-date (DAILY uses today, SUB uses date)
      const user = await this.prisma.user.findUnique({ where: { id: sub.userId } });
      if (!user?.active) continue;
      if (user.bookingSuspendedUntil && user.bookingSuspendedUntil >= new Date(`${date}T00:00:00+07:00`)) continue;
      // skip already booked
      const hasBooked = await this.prisma.booking.findFirst({
        where: { userId: sub.userId, date, shiftId: sub.shiftId, direction: sub.direction, status: 'BOOKED' },
      });
      if (hasBooked) continue;
      // skip cancelled on purpose (USER | ADMIN_TRIP) for this subscription
      const cancelledOnPurpose = await this.prisma.booking.findFirst({
        where: { subscriptionId: sub.id, date, cancelReason: { in: ['USER', 'ADMIN_TRIP'] } },
      });
      if (cancelledOnPurpose) continue;
      // skip if a rejected row already exists for this subscription+date (prevents repeat notification)
      const alreadyRejected = await this.prisma.rejectedRequest.findFirst({
        where: { subscriptionId: sub.id, date },
      });
      if (alreadyRejected) continue;

      try {
        await this.allocate.allocateSeat({
          userId: sub.userId, routeId: sub.routeId, stopId: sub.stopId,
          shiftId: sub.shiftId, direction: sub.direction as 'PICKUP' | 'DROPOFF',
          date, source: 'SUBSCRIPTION', subscriptionId: sub.id, fromCron: true,
        });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e; // mock parity (domain/generate.ts): only domain errors are non-fatal
        if (e.code === 'TRIP_FULL') {
          // allocateSeat already inserted the rejected row; notify (mock data parity: { date })
          await this.notifications.insert(
            sub.userId, 'SUBSCRIPTION_REJECTED', 'Langganan tidak kebagian kursi',
            `Langganan tanggal ${date} tidak kebagian kursi. Coba booking harian.`,
            { date },
          );
        }
        // TRIP_FULL and other domain skips are non-fatal for the cron loop
      }
    }
  }
}
