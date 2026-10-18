import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RouteInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { inUseByTrips } from '../common/in-use';
import { AuditService } from '../audit/audit.service';

type Actor = { id: string | null; name: string };

@Injectable()
export class RoutesService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list() {
    return this.prisma.route.findMany({ include: { stops: { orderBy: { seq: 'asc' } } }, orderBy: { code: 'asc' } });
  }

  async create(input: RouteInput, actor: Actor) {
    if (await this.prisma.route.findUnique({ where: { code: input.code } })) {
      throw new DomainError('VALIDATION_ERROR', `Kode rute ${input.code} sudah dipakai.`);
    }
    const r = await this.prisma.route.create({ data: { code: input.code, name: input.name, color: input.color, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'ROUTE_CREATE', entity: 'route', entityId: r.id, after: r });
    return r;
  }

  async update(id: string, input: RouteInput, actor: Actor) {
    const before = await this.prisma.route.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const dup = await this.prisma.route.findUnique({ where: { code: input.code } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `Kode rute ${input.code} sudah dipakai.`);
    // mock PUT parity: deactivation is rejected while trips/templates still use the route
    if (before.active && !input.active && (await inUseByTrips(this.prisma, { routeId: id }))) {
      throw new DomainError('VALIDATION_ERROR', 'Rute masih dipakai template aktif atau trip yang belum berangkat.');
    }
    const r = await this.prisma.route.update({ where: { id }, data: { code: input.code, name: input.name, color: input.color, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'ROUTE_UPDATE', entity: 'route', entityId: id, before, after: r });
    return r;
  }

  async deactivate(id: string, actor: Actor) {
    const before = await this.prisma.route.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (await inUseByTrips(this.prisma, { routeId: id })) {
      throw new DomainError('VALIDATION_ERROR', 'Rute masih dipakai template aktif atau trip yang belum berangkat.');
    }
    const r = await this.prisma.route.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'ROUTE_UPDATE', entity: 'route', entityId: id, before, after: r });
    return r;
  }
}
