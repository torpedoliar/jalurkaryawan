import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ADMIN_ROLES, isPastCutoff, isoWeekday, jakartaDate, toJakartaIso } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toUserSummary } from '../common/mappers';
import { AllocateService } from '../bookings/allocate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

type Actor = { id: string | null; name: string; role: string };

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly allocate: AllocateService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** mock actor(ctx, row.role) parity: admin-target guard, identical message to UsersService.requireAdminRole. */
  private adminTargetGuard(targetRole: string, actor: Actor): void {
    if ((ADMIN_ROLES as readonly string[]).includes(targetRole) && actor.role !== 'SUPER_ADMIN') {
      throw new DomainError('FORBIDDEN', 'Hanya Super Admin yang boleh mengelola akun admin.');
    }
  }

  async suspend(userId: string, until: string, reason: string, actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.adminTargetGuard(u.role, actor);
    if (u.role !== 'EMPLOYEE') throw new DomainError('VALIDATION_ERROR', 'Pembekuan booking hanya untuk karyawan.');
    const today = jakartaDate(new Date());
    if (until < today) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir pembekuan sudah lewat.');

    // spec 5.6: cancel not-past-cutoff BOOKED seats with SUSPENDED (checkCutoff false — filtered above)
    const cutoffMin = this.settings.get().booking_cutoff_minutes;
    const now = new Date();
    const futureBooked = await this.prisma.booking.findMany({
      where: { userId, status: 'BOOKED' },
      include: { trip: true },
    });
    for (const b of futureBooked) {
      if (!b.trip || isPastCutoff(b.trip.departureAt.toISOString(), cutoffMin, now)) continue;
      await this.cancelBooking(b.id, b.tripId, 'SUSPENDED');
    }

    const before = { bookingSuspendedUntil: u.bookingSuspendedUntil ? jakartaDate(u.bookingSuspendedUntil) : null, suspendReason: u.suspendReason };
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { bookingSuspendedUntil: new Date(`${until}T00:00:00+07:00`), suspendReason: reason },
    });
    await this.notifications.insert(
      userId, 'SUSPENDED', 'Booking dibekukan',
      `Booking kamu dibekukan sampai ${until}. Alasan: ${reason}`, { until },
    );
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'USER_SUSPEND', entity: 'user', entityId: userId,
      before, after: { bookingSuspendedUntil: until, suspendReason: reason },
    });
    return toUserSummary(updated);
  }

  async unsuspend(userId: string, actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.adminTargetGuard(u.role, actor);
    const before = { bookingSuspendedUntil: u.bookingSuspendedUntil ? jakartaDate(u.bookingSuspendedUntil) : null, suspendReason: u.suspendReason };
    const updated = await this.prisma.user.update({
      where: { id: userId }, data: { bookingSuspendedUntil: null, suspendReason: null },
    });

    // mock unsuspendUser: re-create seats on already-generated dates >= today, cutoff checked (no fromCron)
    const today = jakartaDate(new Date());
    const dates = (
      await this.prisma.trip.findMany({ where: { date: { gte: today } }, distinct: ['date'], select: { date: true } })
    ).map((t) => t.date).sort();
    const activeSubs = await this.prisma.subscription.findMany({ where: { userId, status: 'ACTIVE' } });
    for (const sub of activeSubs) {
      for (const date of dates) {
        if (date < sub.startDate || (sub.endDate && date > sub.endDate) || !sub.weekdays.includes(isoWeekday(date))) continue;
        const purposely = await this.prisma.booking.findFirst({
          where: { subscriptionId: sub.id, date, cancelReason: { in: ['USER', 'ADMIN_TRIP'] } },
        });
        if (purposely) continue;
        try {
          await this.allocate.allocateSeat({
            userId, routeId: sub.routeId, stopId: sub.stopId, shiftId: sub.shiftId,
            direction: sub.direction as 'PICKUP' | 'DROPOFF', date, source: 'SUBSCRIPTION', subscriptionId: sub.id,
          });
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          if (e.code === 'TRIP_FULL') {
            await this.notifications.insert(
              userId, 'SUBSCRIPTION_REJECTED', 'Langganan tidak kebagian kursi',
              `Langganan tanggal ${date} tidak kebagian kursi. Coba booking harian.`, { date },
            );
          }
          // SCHEDULE_CONFLICT (already booked), CUTOFF_PASSED, USER_SUSPENDED: swallow (mock parity)
        }
      }
    }

    await this.notifications.insert(userId, 'UNSUSPENDED', 'Pembekuan dicabut', 'Booking kamu aktif kembali.');
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'USER_UNSUSPEND', entity: 'user', entityId: userId,
      before, after: { bookingSuspendedUntil: null, suspendReason: null },
    });
    return toUserSummary(updated);
  }

  async deactivate(userId: string, actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.adminTargetGuard(u.role, actor);
    if (userId === actor.id) throw new DomainError('VALIDATION_ERROR', 'Tidak bisa menonaktifkan akun sendiri.');

    // mock deactivateUser: active=false first, then cancel all not-departed BOOKED (no cutoff filter)
    const futureBooked = await this.prisma.booking.findMany({
      where: { userId, status: 'BOOKED' },
      include: { trip: true },
    });
    for (const b of futureBooked) {
      if (!b.trip || b.trip.departureAt <= new Date()) continue;
      await this.cancelBooking(b.id, b.tripId, 'USER_DEACTIVATED');
    }
    const today = jakartaDate(new Date());
    await this.prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' }, data: { status: 'ENDED', endDate: today },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { active: false } });
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'USER_DEACTIVATE', entity: 'user', entityId: userId,
      before: { active: true }, after: { active: false },
    });
    return toUserSummary(updated);
  }

  /** mock changeTripBus: NOT_FOUND → inactive → departed → capacity, then swap + notify passengers. */
  async changeTripBus(tripId: string, busId: string, actor: Actor) {
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    const bus = await this.prisma.bus.findUnique({ where: { id: busId } });
    if (!trip || !bus) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!bus.active) throw new DomainError('VALIDATION_ERROR', 'Bus tidak aktif.');
    if (trip.status !== 'SCHEDULED' || trip.departureAt <= new Date()) {
      throw new DomainError('VALIDATION_ERROR', 'Trip sudah dibatalkan atau sudah berangkat.');
    }
    if (bus.capacity < trip.bookedCount) {
      throw new DomainError(
        'CAPACITY_BELOW_BOOKED',
        `Bus ${bus.plate} hanya ${bus.capacity} kursi, sudah ${trip.bookedCount} booking.`,
      );
    }
    const before = { busId: trip.busId, capacity: trip.capacity };
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id"=${tripId} FOR UPDATE`;
      const current = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
      if (current.departureAt <= new Date() || current.status !== 'SCHEDULED') throw new DomainError('VALIDATION_ERROR', 'Trip sudah berangkat atau dibatalkan.');
      if (await tx.attendance.count({ where: { tripId } }) || await tx.tripOperation.count({ where: { tripId, status: 'IN_PROGRESS' } })) throw new DomainError('VALIDATION_ERROR', 'Bus tidak bisa diganti setelah perjalanan atau check-in dimulai.');
      if (bus.capacity < current.bookedCount) throw new DomainError('CAPACITY_BELOW_BOOKED', 'Kapasitas bus di bawah jumlah booking.');
      await tx.tripOperation.deleteMany({ where: { tripId } });
      return tx.trip.update({ where: { id: tripId }, data: { busId, capacity: bus.capacity } });
    });
    const bookings = await this.prisma.booking.findMany({ where: { tripId, status: 'BOOKED' } });
    for (const b of bookings) {
      await this.notifications.insert(
        b.userId, 'BUS_CHANGED', 'Bus diganti',
        `Trip ${trip.date} sekarang memakai bus ${bus.plate}.`, { tripId },
      );
    }
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'TRIP_CHANGE_BUS', entity: 'trip', entityId: tripId,
      before, after: { busId, capacity: bus.capacity },
    });
    // mock returns the raw trip row (contract Trip wire shape)
    return {
      id: updated.id, templateId: updated.templateId, routeId: updated.routeId, shiftId: updated.shiftId,
      direction: updated.direction, date: updated.date, departureAt: toJakartaIso(updated.departureAt.getTime()),
      busId: updated.busId, capacity: updated.capacity, bookedCount: updated.bookedCount, status: updated.status,
    };
  }

  /** Conditional BOOKED flip + decrement (T8 pattern): only the flip winner frees the seat. */
  private async cancelBooking(bookingId: string, tripId: string | null, reason: 'SUSPENDED' | 'USER_DEACTIVATED'): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (tripId) await tx.$queryRaw`SELECT "id" FROM "Trip" WHERE "id"=${tripId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id"=${bookingId} FOR UPDATE`;
      const attended = await tx.$queryRaw<{ bookingId: string }[]>`SELECT "bookingId" FROM "Attendance" WHERE "bookingId"=${bookingId}`;
      if (attended.length) return;
      const flipped = await tx.booking.updateMany({
        where: { id: bookingId, status: 'BOOKED' },
        data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
      });
      if (flipped.count && tripId) await tx.trip.update({ where: { id: tripId }, data: { bookedCount: { decrement: 1 } } });
    });
  }
}
