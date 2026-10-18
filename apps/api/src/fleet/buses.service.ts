import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BusInput, toJakartaIso } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { inUseByTrips } from '../common/in-use';
import { AuditService } from '../audit/audit.service';

type Actor = { id: string | null; name: string };

@Injectable()
export class BusesService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list(vendorId?: string) {
    return this.prisma.bus.findMany({
      where: vendorId ? { vendorId } : {},
      include: { vendor: true },
      orderBy: { plate: 'asc' },
    });
  }

  async create(input: BusInput, actor: Actor) {
    if (!(await this.prisma.vendor.findUnique({ where: { id: input.vendorId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const plate = input.plate.toUpperCase();
    if (await this.prisma.bus.findUnique({ where: { plate } })) {
      throw new DomainError('VALIDATION_ERROR', `Plat ${plate} sudah terdaftar.`);
    }
    const b = await this.prisma.bus.create({ data: { plate, capacity: input.capacity, vendorId: input.vendorId, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_CREATE', entity: 'bus', entityId: b.id, after: b });
    return b;
  }

  async update(id: string, input: BusInput, actor: Actor) {
    // mock PUT parity order: bus exists → vendor exists → plate unique → deactivate block → capacity rule → update
    const before = await this.prisma.bus.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (!(await this.prisma.vendor.findUnique({ where: { id: input.vendorId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const plate = input.plate.toUpperCase();
    const dup = await this.prisma.bus.findUnique({ where: { plate } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `Plat ${plate} sudah terdaftar.`);
    if (before.active && !input.active && (await inUseByTrips(this.prisma, { busId: id }))) {
      throw new DomainError('VALIDATION_ERROR', 'Bus masih dipakai template aktif atau trip yang belum berangkat.');
    }
    if (input.capacity !== before.capacity) await this.setBusCapacity(id, input.capacity, actor);
    const b = await this.prisma.bus.update({ where: { id }, data: { plate, capacity: input.capacity, vendorId: input.vendorId, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_UPDATE', entity: 'bus', entityId: id, before, after: b });
    return b;
  }

  async deactivate(id: string, actor: Actor) {
    const before = await this.prisma.bus.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    if (await inUseByTrips(this.prisma, { busId: id })) {
      throw new DomainError('VALIDATION_ERROR', 'Bus masih dipakai template aktif atau trip yang belum berangkat.');
    }
    const b = await this.prisma.bus.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_UPDATE', entity: 'bus', entityId: id, before, after: b });
    return b;
  }

  /** spec §5.6: capacity change rejected if any SCHEDULED not-departed trip already has more booked; else propagate. */
  async setBusCapacity(id: string, capacity: number, actor: Actor) {
    const bus = await this.prisma.bus.findUnique({ where: { id } });
    if (!bus) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const conflictTrip = await this.prisma.trip.findFirst({
      where: { busId: id, status: 'SCHEDULED', departureAt: { gt: new Date() }, bookedCount: { gt: capacity } },
    });
    if (conflictTrip) {
      // mock parity: HH:mm in Asia/Jakarta
      const time = toJakartaIso(conflictTrip.departureAt.getTime()).slice(11, 16);
      throw new DomainError(
        'CAPACITY_BELOW_BOOKED',
        `Trip ${conflictTrip.date} ${time} sudah ${conflictTrip.bookedCount} booking.`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.bus.update({ where: { id }, data: { capacity } }),
      this.prisma.trip.updateMany({
        where: { busId: id, status: 'SCHEDULED', departureAt: { gt: new Date() } },
        data: { capacity },
      }),
    ]);
    const after = await this.prisma.bus.findUniqueOrThrow({ where: { id } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'BUS_CAPACITY', entity: 'bus', entityId: id, before: { capacity: bus.capacity }, after: { capacity: after.capacity } });
    return after;
  }
}
