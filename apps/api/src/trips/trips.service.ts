import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { jakartaDate, stopTime, toJakartaIso, type Direction, type TripStatus } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toDeparture, toPassenger } from '../common/mappers';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

type Actor = { id: string | null; name: string };

/** Contract `Trip` wire shape (mock GET /api/trips raw-row parity). */
type TripRow = {
  id: string; templateId: string; routeId: string; shiftId: string; direction: Direction;
  date: string; departureAt: string; busId: string;
  capacity: number; bookedCount: number; status: TripStatus;
};

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit?: AuditService,
  ) {}

  private toTripRow(t: {
    id: string; templateId: string; routeId: string; shiftId: string; direction: string;
    date: string; departureAt: Date; busId: string; capacity: number; bookedCount: number; status: string;
  }): TripRow {
    return {
      id: t.id, templateId: t.templateId, routeId: t.routeId, shiftId: t.shiftId,
      direction: t.direction as Direction, date: t.date,
      departureAt: toJakartaIso(t.departureAt.getTime()), busId: t.busId,
      capacity: t.capacity, bookedCount: t.bookedCount, status: t.status as TripStatus,
    };
  }

  async list(filters: { date?: string; routeId?: string; shiftId?: string }) {
    const date = filters.date ?? jakartaDate(new Date());
    const trips = await this.prisma.trip.findMany({
      where: {
        date,
        ...(filters.routeId && { routeId: filters.routeId }),
        ...(filters.shiftId && { shiftId: filters.shiftId }),
      },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
    });
    return trips.map((t) => this.toTripRow(t));
  }

  async tripPassengers(tripId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { route: { include: { stops: true } } } });
    if (!trip) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const bookings = await this.prisma.booking.findMany({
      where: { tripId, status: { not: 'CANCELLED' } },
      include: { user: true, stop: true },
    });
    const maxOffset = Math.max(0, ...trip.route.stops.map((s) => s.offsetMinutes));
    const departure = toJakartaIso(trip.departureAt.getTime());
    return bookings
      .map((b) =>
        toPassenger({
          bookingId: b.id, nik: b.user.nik, name: b.user.name, department: b.user.department, phone: b.user.phone,
          stopName: b.stop.name, stopSeq: b.stop.seq,
          pickupAt: stopTime(departure, trip.direction as Direction, b.stop.offsetMinutes, maxOffset),
        }),
      )
      .sort((a, b) => a.pickupAt.localeCompare(b.pickupAt) || a.name.localeCompare(b.name));
  }

  async tripCancel(tripId: string, actor: Actor) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, include: { route: true } });
    if (!trip) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (trip.status === 'CANCELLED') return this.toTripRow(trip);
    if (trip.departureAt <= new Date()) throw new DomainError('VALIDATION_ERROR', 'Trip sudah berangkat.');

    const bookings = await this.prisma.booking.findMany({ where: { tripId, status: 'BOOKED' } });
    // mock allocate ADMIN_TRIP parity: bookedCount-- per BOOKED row flipped
    const [updated] = await this.prisma.$transaction([
      this.prisma.trip.update({
        where: { id: tripId },
        data: { status: 'CANCELLED', bookedCount: { decrement: bookings.length } },
      }),
      this.prisma.booking.updateMany({
        where: { tripId, status: 'BOOKED' },
        data: { status: 'CANCELLED', cancelReason: 'ADMIN_TRIP', cancelledAt: new Date() },
      }),
    ]);
    const time = toJakartaIso(trip.departureAt.getTime()).slice(11, 16);
    for (const b of bookings) {
      await this.notifications.insert(
        b.userId, 'TRIP_CANCELLED', 'Trip dibatalkan',
        `Trip ${trip.date} jam ${time} dibatalkan admin.`,
        { tripId },
      );
    }
    await this.audit?.write({ actorId: actor.id, actorName: actor.name, action: 'TRIP_CANCEL', entity: 'trip', entityId: tripId, before: { status: trip.status, bookedCount: trip.bookedCount }, after: { status: 'CANCELLED', bookedCount: updated.bookedCount } });
    return this.toTripRow(updated);
  }

  /** mock POST /api/trips/cancel-date wire: { cancelled: n }. */
  async cancelDate(date: string, actor: Actor): Promise<{ cancelled: number }> {
    const trips = await this.prisma.trip.findMany({
      where: { date, status: 'SCHEDULED', departureAt: { gt: new Date() } },
    });
    for (const t of trips) await this.tripCancel(t.id, actor);
    return { cancelled: trips.length };
  }

  /** departures board (ANY user): date's trips as contract `Departure` + mine flag for caller. */
  async departures(callerId: string | null, date?: string) {
    const d = date ?? jakartaDate(new Date());
    const trips = await this.prisma.trip.findMany({
      where: { date: d },
      include: { route: true, shift: true, bus: true },
      orderBy: [{ departureAt: 'asc' }, { id: 'asc' }],
    });
    const mineSet = callerId
      ? new Set(
          (await this.prisma.booking.findMany({
            where: { userId: callerId, date: d, status: 'BOOKED' },
            select: { tripId: true },
          })).map((b) => b.tripId),
        )
      : new Set<string>();
    return trips.map((t) =>
      toDeparture({
        tripId: t.id, date: t.date, departureAt: toJakartaIso(t.departureAt.getTime()),
        routeId: t.routeId, routeCode: t.route.code, routeName: t.route.name, routeColor: t.route.color,
        shiftId: t.shiftId, shiftName: t.shift.name, direction: t.direction as Direction,
        busPlate: t.bus.plate,
        bookedCount: t.bookedCount, capacity: t.capacity, status: t.status,
        hasBooking: mineSet.has(t.id),
      }),
    );
  }
}
