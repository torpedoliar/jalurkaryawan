import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, isPastCutoff } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toBooking } from '../common/mappers';
import { SettingsService } from '../settings/settings.service';
import { AllocateService } from './allocate.service';

const bookingInclude = {
  route: { include: { stops: true } },
  stop: true,
  trip: { include: { bus: true } },
} as const;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allocate: AllocateService,
    private readonly settings: SettingsService,
  ) {}

  async bookDaily(userId: string, input: { routeId: string; stopId: string; shiftId: string; direction: 'PICKUP' | 'DROPOFF'; date: string }) {
    const { bookingId } = await this.allocate.allocateSeat({ ...input, userId, source: 'DAILY' });
    return this.view(bookingId); // mock POST /bookings returns full toBooking row
  }

  async myBookings(userId: string, from?: string, to?: string) {
    const rows = await this.prisma.booking.findMany({
      where: {
        userId,
        ...(from && { date: { gte: from } }),
        ...(to && { date: { lte: to } }),
      },
      include: bookingInclude,
      orderBy: [{ trip: { departureAt: 'asc' } }],
    });
    return rows.map((b) => this.toView(b));
  }

  async cancelBooking(bookingId: string, userId: string) {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.userId !== userId) throw new DomainError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
    if (b.status !== 'BOOKED') throw new DomainError('VALIDATION_ERROR', 'Booking sudah tidak aktif.');
    // USER cancel respects cutoff (mock checkCutoff: true)
    const trip = b.tripId ? await this.prisma.trip.findUnique({ where: { id: b.tripId } }) : null;
    if (trip && isPastCutoff(trip.departureAt.toISOString(), this.settings.get().booking_cutoff_minutes, new Date())) {
      throw new DomainError('CUTOFF_PASSED', ERROR_MESSAGES.CUTOFF_PASSED);
    }
    // conditional flip + decrement in one tx (allocation's pattern): only the flip winner decrements,
    // so concurrent cancels cannot free the same seat twice
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.booking.updateMany({
        where: { id: bookingId, status: 'BOOKED' },
        data: { status: 'CANCELLED', cancelReason: 'USER', cancelledAt: new Date() },
      });
      if (flipped.count === 0) {
        // lost the race / already cancelled — mock: non-BOOKED cancel = "Booking sudah tidak aktif."
        throw new DomainError('VALIDATION_ERROR', 'Booking sudah tidak aktif.');
      }
      if (trip) await tx.trip.update({ where: { id: trip.id }, data: { bookedCount: { decrement: 1 } } });
    });
    return this.view(bookingId); // mock cancel returns full toBooking row
  }

  private async view(bookingId: string) {
    const b = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude });
    return this.toView(b);
  }

  private toView(b: {
    route: { code: string; name: string; color: string; stops: { offsetMinutes: number }[] };
    stop: { name: string; offsetMinutes: number };
    trip: { departureAt: Date; capacity: number; bookedCount: number; bus: { plate: string } } | null;
  } & Parameters<typeof toBooking>[0]) {
    const maxOffset = Math.max(0, ...b.route.stops.map((s) => s.offsetMinutes));
    return toBooking(b, {
      routeCode: b.route.code, routeName: b.route.name, routeColor: b.route.color,
      stopName: b.stop.name, busPlate: b.trip?.bus.plate ?? '',
      departureAt: b.trip?.departureAt.toISOString() ?? '',
      direction: b.direction as 'PICKUP' | 'DROPOFF',
      stopOffset: b.stop.offsetMinutes, maxStopOffset: maxOffset,
      cutoffMinutes: this.settings.get().booking_cutoff_minutes,
      seatsLeft: b.trip ? b.trip.capacity - b.trip.bookedCount : 0,
      capacity: b.trip?.capacity ?? 0,
    });
  }
}
