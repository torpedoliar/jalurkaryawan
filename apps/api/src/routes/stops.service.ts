import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { StopInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AuditService } from '../audit/audit.service';

type Actor = { id: string | null; name: string };

@Injectable()
export class StopsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async listByRoute(routeId: string) {
    const route = await this.prisma.route.findUnique({ where: { id: routeId } });
    if (!route) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    return this.prisma.stop.findMany({ where: { routeId }, orderBy: { seq: 'asc' } });
  }

  async create(routeId: string, input: StopInput, actor: Actor) {
    if (!(await this.prisma.route.findUnique({ where: { id: routeId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const s = await this.prisma.stop.create({
      data: { routeId, name: input.name, seq: input.seq, offsetMinutes: input.offsetMinutes, lat: input.lat, lng: input.lng, active: input.active },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'STOP_CREATE', entity: 'stop', entityId: s.id, after: s });
    return s;
  }

  /** Active subscription or future BOOKED booking still uses this stop. */
  private async used(stopId: string) {
    const activeSub = await this.prisma.subscription.findFirst({ where: { stopId, status: 'ACTIVE' } });
    if (activeSub) return true;
    return !!(await this.prisma.booking.findFirst({
      where: { stopId, status: 'BOOKED', trip: { departureAt: { gt: new Date() } } },
    }));
  }

  async update(routeId: string, stopId: string, input: StopInput, actor: Actor) {
    const existing = await this.prisma.stop.findUnique({ where: { id: stopId } });
    if (!existing || existing.routeId !== routeId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    // mock PUT parity: deactivation is rejected while subscriptions/bookings still use the stop
    if (existing.active && !input.active && (await this.used(stopId))) {
      throw new DomainError('VALIDATION_ERROR', 'Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.');
    }
    const s = await this.prisma.stop.update({
      where: { id: stopId },
      data: { name: input.name, seq: input.seq, offsetMinutes: input.offsetMinutes, lat: input.lat, lng: input.lng, active: input.active },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'STOP_UPDATE', entity: 'stop', entityId: stopId, before: existing, after: s });
    return s;
  }

  async deactivate(routeId: string, stopId: string, actor: Actor) {
    const existing = await this.prisma.stop.findUnique({ where: { id: stopId } });
    if (!existing || existing.routeId !== routeId) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (await this.used(stopId)) {
      throw new DomainError('VALIDATION_ERROR', 'Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.');
    }
    const s = await this.prisma.stop.update({ where: { id: stopId }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'STOP_UPDATE', entity: 'stop', entityId: stopId, before: existing, after: s });
    return s;
  }
}
