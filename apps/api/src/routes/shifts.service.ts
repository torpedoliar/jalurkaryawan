import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ShiftInput } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { AuditService } from '../audit/audit.service';

type Actor = { id: string | null; name: string };

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  list() {
    return this.prisma.shift.findMany({ orderBy: { startTime: 'asc' } });
  }

  /** POST /shifts (mock parity: id generated server-side). */
  async create(input: ShiftInput, actor: Actor) {
    const id = randomUUID();
    const s = await this.prisma.shift.create({ data: { id, name: input.name, startTime: input.startTime, endTime: input.endTime } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'SHIFT_CREATE', entity: 'shift', entityId: id, after: s });
    return s;
  }

  async update(id: string, input: ShiftInput, actor: Actor) {
    const before = await this.prisma.shift.findUnique({ where: { id } });
    if (!before) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    const s = await this.prisma.shift.update({ where: { id }, data: { name: input.name, startTime: input.startTime, endTime: input.endTime } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'SHIFT_UPDATE', entity: 'shift', entityId: id, before, after: s });
    return s;
  }
}
