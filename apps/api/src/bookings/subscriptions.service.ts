import { Injectable } from '@nestjs/common';
import { PrismaClient, type Subscription as SubscriptionRow } from '@prisma/client';
import { isPastCutoff, isoWeekday, jakartaDate, toJakartaIso, type SubscriptionInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';
import { AllocateService } from './allocate.service';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allocate: AllocateService,
    private readonly settings: SettingsService,
  ) {}

  /** Contract `Subscription` wire shape: drop updatedAt, createdAt as +07:00 no-ms (mock nowIso parity). */
  private toWire(s: SubscriptionRow): Omit<SubscriptionRow, 'updatedAt' | 'createdAt'> & { createdAt: string } {
    const { updatedAt: _u, createdAt, ...rest } = s;
    return { ...rest, createdAt: toJakartaIso(createdAt.getTime()) };
  }

  async list(userId: string) {
    const rows = await this.prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toWire(r));
  }

  /** spec §5.3 create: book already-generated dates with cutoff check; later dates come from cron. */
  async create(userId: string, input: SubscriptionInput) {
    // mock handler order: stop check → startDate check → overlap (inside createSubscription)
    const stop = await this.prisma.stop.findFirst({ where: { id: input.stopId, routeId: input.routeId, active: true } });
    if (!stop) throw new DomainError('VALIDATION_ERROR', 'Titik jemput tidak valid untuk rute ini.');
    const today = jakartaDate(new Date());
    if (input.startDate < today) throw new DomainError('VALIDATION_ERROR', 'Tanggal mulai sudah lewat.');

    const existing = await this.prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE', shiftId: input.shiftId, direction: input.direction },
    });
    for (const e of existing) {
      const rangeOverlap =
        (!e.endDate || e.endDate >= input.startDate) &&
        (!input.endDate || input.endDate >= e.startDate);
      const weekdayOverlap = e.weekdays.some((d) => input.weekdays.includes(d));
      if (rangeOverlap && weekdayOverlap) {
        throw new DomainError('SCHEDULE_CONFLICT', 'Langganan bentrok dengan langganan lain di shift dan arah yang sama.');
      }
    }

    const sub = await this.prisma.subscription.create({
      data: {
        userId, routeId: input.routeId, stopId: input.stopId, shiftId: input.shiftId,
        direction: input.direction, startDate: input.startDate, endDate: input.endDate,
        weekdays: input.weekdays, status: 'ACTIVE',
      },
    });

    // mock: only already-generated dates for this route/shift/direction, covered by the subscription
    const tripDates = await this.prisma.trip.findMany({
      where: { routeId: input.routeId, shiftId: input.shiftId, direction: input.direction },
      distinct: ['date'], select: { date: true },
    });
    const dates = tripDates
      .map((t) => t.date)
      .filter((d) => this.covers(sub, d))
      .sort();

    const booked: string[] = [];
    const rejected: string[] = [];
    const skippedCutoff: string[] = [];
    for (const date of dates) {
      try {
        await this.allocate.allocateSeat({
          userId, routeId: input.routeId, stopId: input.stopId,
          shiftId: input.shiftId, direction: input.direction,
          date, source: 'SUBSCRIPTION', subscriptionId: sub.id,
        });
        booked.push(date);
      } catch (e) {
        if (!(e instanceof DomainError)) throw e; // mock parity: only domain skips are swallowed
        const code = e.code;
        if (code === 'CUTOFF_PASSED') skippedCutoff.push(date);
        else if (code === 'TRIP_FULL') rejected.push(date);
        // USER_SUSPENDED (per date), SCHEDULE_CONFLICT (daily booking exists) and NOT_FOUND: skip silently (mock parity)
      }
    }
    return { subscription: this.toWire(sub), booked, rejected, skippedCutoff };
  }

  /** spec §5.3 end. Idempotent on ENDED. */
  async end(userId: string, id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (sub.status === 'ENDED') return this.toWire(sub);
    const updated = await this.prisma.subscription.update({
      where: { id }, data: { status: 'ENDED', endDate: jakartaDate(new Date()) },
    });
    // cancel BOOKED bookings of this sub that are not past cutoff (mock endSubscription parity)
    const cutoffMin = this.settings.get().booking_cutoff_minutes;
    const now = new Date();
    const bookings = await this.prisma.booking.findMany({
      where: { subscriptionId: id, status: 'BOOKED' },
      include: { trip: true },
    });
    for (const b of bookings) {
      if (!b.trip || isPastCutoff(b.trip.departureAt.toISOString(), cutoffMin, now)) continue;
      await this.cancelBooking(b.id, b.tripId, 'SUBSCRIPTION_ENDED');
    }
    return this.toWire(updated);
  }

  private covers(s: { status: string; startDate: string; endDate: string | null; weekdays: number[] }, date: string): boolean {
    return s.status === 'ACTIVE' && date >= s.startDate && (s.endDate === null || date <= s.endDate) && s.weekdays.includes(isoWeekday(date));
  }

  /** Conditional BOOKED flip + decrement (T8 pattern): only the flip winner frees the seat. */
  private async cancelBooking(bookingId: string, tripId: string | null, reason: 'SUBSCRIPTION_ENDED' | 'SUSPENDED' | 'USER_DEACTIVATED'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.booking.updateMany({
        where: { id: bookingId, status: 'BOOKED' },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
      if (flipped.count && tripId) await tx.trip.update({ where: { id: tripId }, data: { bookedCount: { decrement: 1 } } });
    });
  }
}
