import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TripTemplateInput, departureAt, isoWeekday, toJakartaIso } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AuditService } from '../audit/audit.service';
import { GenerateService } from '../generate/generate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

type Actor = { id: string | null; name: string };

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly generate: GenerateService,
    private readonly notifications: NotificationsService,
    // unused today; Task 10 keeps the brief's 5-arg ctor for SettingsService wiring
    private readonly settings?: SettingsService,
  ) {}

  list() {
    return this.prisma.tripTemplate.findMany({ include: { route: true, shift: true, bus: true }, orderBy: { createdAt: 'asc' } });
  }

  async create(input: TripTemplateInput, actor: Actor) {
    if (!(await this.prisma.route.findUnique({ where: { id: input.routeId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    if (!(await this.prisma.shift.findUnique({ where: { id: input.shiftId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const bus = await this.prisma.bus.findUnique({ where: { id: input.busId } });
    if (!bus) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!bus.active) throw new DomainError('VALIDATION_ERROR', 'Bus tidak aktif.');

    const tpl = await this.prisma.tripTemplate.create({ data: { ...input } });
    // full-window generate after create (documented deviation from mock fillGeneratedDates)
    await this.generate.fillWindow();
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TEMPLATE_CREATE', entity: 'tripTemplate', entityId: tpl.id, after: tpl });
    return tpl;
  }

  /**
   * spec §5.6: template edit applies to SCHEDULED not-departed trips in ONE transaction.
   * Rejection cases (full rollback, name the trip):
   *  - new bus capacity < any trip's bookedCount → CAPACITY_BELOW_BOOKED naming date+time+booked
   *  - weekday removed while future SCHEDULED trips on that weekday exist → VALIDATION_ERROR naming trip
   * On success: propagate departureAt/capacity/bus/route/shift/direction, notify passengers SCHEDULE_CHANGED.
   */
  async update(id: string, input: TripTemplateInput, actor: Actor) {
    const old = await this.prisma.tripTemplate.findUnique({ where: { id }, include: { route: true } });
    if (!old) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    // mock PUT checkTemplate parity: route exists → shift exists → bus exists → bus active
    if (!(await this.prisma.route.findUnique({ where: { id: input.routeId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    if (!(await this.prisma.shift.findUnique({ where: { id: input.shiftId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const bus = await this.prisma.bus.findUnique({ where: { id: input.busId } });
    if (!bus) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!bus.active) throw new DomainError('VALIDATION_ERROR', 'Bus tidak aktif.');

    // weekday-removal check BEFORE tx (fast fail naming the trip)
    const removed = old.weekdays.filter((d) => !input.weekdays.includes(d));
    if (removed.length) {
      const futureTrips = await this.prisma.trip.findMany({
        where: { templateId: id, status: 'SCHEDULED', departureAt: { gt: new Date() } },
      });
      for (const t of futureTrips) {
        const wd = isoWeekday(t.date);
        if (removed.includes(wd)) {
          throw new DomainError(
            'VALIDATION_ERROR',
            `Trip ${t.date} jam ${toJakartaIso(t.departureAt.getTime()).slice(11, 16)} masih memakai hari yang dihapus. Batalkan trip dulu.`,
          );
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const tpl = await tx.tripTemplate.update({ where: { id }, data: { ...input } });
      const trips = await tx.trip.findMany({
        where: { templateId: id, status: 'SCHEDULED', departureAt: { gt: new Date() } },
        include: { bookings: { where: { status: 'BOOKED' } } },
      });
      const notifyList: { userId: string; date: string; time: string }[] = [];
      for (const trip of trips) {
        const booked = trip.bookedCount;
        if (bus.capacity < booked) {
          throw new DomainError(
            'CAPACITY_BELOW_BOOKED',
            `Trip ${trip.date} jam ${toJakartaIso(trip.departureAt.getTime()).slice(11, 16)} sudah ${booked} booking; bus ${bus.plate} hanya ${bus.capacity} kursi.`,
          );
        }
        const newDep = departureAt(trip.date, input.departureTime, input.dayOffset);
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            departureAt: newDep, capacity: bus.capacity, busId: input.busId,
            routeId: input.routeId, shiftId: input.shiftId, direction: input.direction,
          },
        });
        for (const b of trip.bookings) {
          notifyList.push({ userId: b.userId, date: trip.date, time: newDep.slice(11, 16) });
        }
      }
      return { tpl, notifyList };
    });

    // notify outside tx (insert-only; failure must not roll back the edit)
    for (const n of updated.notifyList) {
      await this.notifications.insert(
        n.userId, 'SCHEDULE_CHANGED', 'Jadwal berubah',
        `Trip ${n.date} jam ${n.time} berubah.`,
        { date: n.date },
      );
    }
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TEMPLATE_UPDATE', entity: 'tripTemplate', entityId: id, before: old, after: updated.tpl });
    return updated.tpl;
  }

  /** Deactivation stops future generation only; existing SCHEDULED trips keep running until cancelled. */
  async deactivate(id: string, actor: Actor) {
    const old = await this.prisma.tripTemplate.findUnique({ where: { id } });
    if (!old) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const tpl = await this.prisma.tripTemplate.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'TEMPLATE_UPDATE', entity: 'tripTemplate', entityId: id, before: old, after: tpl });
    return tpl;
  }
}
