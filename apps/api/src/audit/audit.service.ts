import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { SECRET_SETTING_KEYS } from '@bms/shared';

export interface AuditInput {
  actorId?: string | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Mask secret-setting values to "***" (spec §5.12); empty string stays "". */
function maskSnapshot(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  const clone = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  for (const k of SECRET_SETTING_KEYS) {
    if (k in clone && clone[k] !== '' && clone[k] !== null && clone[k] !== undefined) clone[k] = '***';
  }
  return clone as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async write(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorName: input.actorName,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: maskSnapshot(input.before) ?? Prisma.JsonNull,
        after: maskSnapshot(input.after) ?? Prisma.JsonNull,
      },
    });
  }

  async list(filters: { actorId?: string; action?: string; from?: string; to?: string; page?: number }) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.action) where.action = filters.action;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(`${filters.from}T00:00:00+07:00`);
      if (filters.to) where.createdAt.lt = new Date(`${filters.to}T23:59:59.999+07:00`);
    }
    const pageSize = 50;
    const page = Math.max(1, Number(filters.page) || 1);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
    ]);
    return { items: rows.map((r) => ({ ...r, before: r.before ?? null, after: r.after ?? null })), total, page, pageSize };
  }
}
