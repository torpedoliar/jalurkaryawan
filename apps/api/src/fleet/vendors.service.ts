import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VendorInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AuditService } from '../audit/audit.service';

type Actor = { id: string | null; name: string };

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list() {
    return this.prisma.vendor.findMany({ orderBy: { name: 'asc' } });
  }

  async create(input: VendorInput, actor: Actor) {
    const v = await this.prisma.vendor.create({ data: { name: input.name, contact: input.contact, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'VENDOR_CREATE', entity: 'vendor', entityId: v.id, after: v });
    return v;
  }

  async update(id: string, input: VendorInput, actor: Actor) {
    const before = await this.prisma.vendor.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    // mock PUT parity: deactivation is rejected while the vendor still has active buses
    if (!input.active && (await this.prisma.bus.count({ where: { vendorId: id, active: true } })) > 0) {
      throw new DomainError('VALIDATION_ERROR', 'Vendor masih punya bus aktif.');
    }
    const v = await this.prisma.vendor.update({ where: { id }, data: { name: input.name, contact: input.contact, active: input.active } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'VENDOR_UPDATE', entity: 'vendor', entityId: id, before, after: v });
    return v;
  }

  async deactivate(id: string, actor: Actor) {
    const before = await this.prisma.vendor.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const activeBuses = await this.prisma.bus.count({ where: { vendorId: id, active: true } });
    if (activeBuses > 0) throw new DomainError('VALIDATION_ERROR', 'Vendor masih punya bus aktif.');
    const v = await this.prisma.vendor.update({ where: { id }, data: { active: false } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'VENDOR_UPDATE', entity: 'vendor', entityId: id, before, after: v });
    return v;
  }
}
