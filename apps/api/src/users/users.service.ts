import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import {
  ADMIN_ROLES, ImportRow, type ImportPreview, type TempPassword, type UserInput, type UserSummary,
} from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { toUserSummary } from '../common/mappers';
import { zodMessage } from '../common/zod';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // i,l,o,0,1 excluded (mock parity)
function tempPassword(): string {
  return [...randomBytes(10)].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]).join('');
}

type Actor = { id: string | null; name: string; role: string };

/** Mock handlers/users.ts parity: coerce numeric Excel cells to string before zod. */
function coerceCells(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null
    ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]))
    : {};
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private requireAdminRole(actorRole: string, targetRole?: string): void {
    // spec 6.1 / mock actor(): any admin-role arg && caller ≠ SUPER_ADMIN → FORBIDDEN
    if (targetRole && (ADMIN_ROLES as readonly string[]).includes(targetRole) && actorRole !== 'SUPER_ADMIN') {
      throw new DomainError('FORBIDDEN', 'Hanya Super Admin yang boleh mengelola akun admin.');
    }
  }

  async list(filters: { q?: string; role?: string; page?: number }): Promise<{ items: UserSummary[]; total: number; page: number; pageSize: number }> {
    const where: Record<string, unknown> = {};
    if (filters.q) {
      const q = filters.q.toLowerCase();
      where.OR = [
        { nik: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (filters.role) where.role = filters.role;
    const pageSize = 50;
    const page = Math.max(1, Number(filters.page) || 1);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, orderBy: { nik: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map(toUserSummary), total, page, pageSize };
  }

  async create(input: UserInput, actor: Actor): Promise<{ userId: string; nik: string; tempPassword: string }> {
    this.requireAdminRole(actor.role, input.role);
    if (input.vendorId && !(await this.prisma.vendor.findUnique({ where: { id: input.vendorId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    if (await this.prisma.user.findUnique({ where: { nik: input.nik } })) {
      throw new DomainError('VALIDATION_ERROR', `NIK ${input.nik} sudah terdaftar.`);
    }
    const pw = tempPassword();
    const user = await this.prisma.user.create({
      data: {
        nik: input.nik, name: input.name, department: input.department, phone: input.phone,
        role: input.role, vendorId: input.vendorId,
        passwordHash: await argon2.hash(pw), mustChangePassword: true, active: true,
      },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_CREATE', entity: 'user', entityId: user.id, after: toUserSummary(user) });
    return { userId: user.id, nik: user.nik, tempPassword: pw };
  }

  async update(id: string, input: UserInput, actor: Actor): Promise<UserSummary> {
    const old = await this.prisma.user.findUnique({ where: { id } });
    if (!old) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.requireAdminRole(actor.role, old.role);
    this.requireAdminRole(actor.role, input.role);
    if (input.vendorId && !(await this.prisma.vendor.findUnique({ where: { id: input.vendorId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const dup = await this.prisma.user.findUnique({ where: { nik: input.nik } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `NIK ${input.nik} sudah terdaftar.`);
    // mock order: admin-role guards → vendor → dup → self-role (GA self role-change is 403, not this)
    if (old.role !== input.role && id === actor.id) {
      throw new DomainError('VALIDATION_ERROR', 'Tidak bisa mengubah role akun sendiri.');
    }
    const before = toUserSummary(old);
    const u = await this.prisma.user.update({
      where: { id },
      data: { nik: input.nik, name: input.name, department: input.department, phone: input.phone, role: input.role, vendorId: input.vendorId },
    });
    const after = toUserSummary(u);
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_UPDATE', entity: 'user', entityId: id, before, after });
    return after;
  }

  async resetPassword(id: string, actor: Actor): Promise<{ userId: string; nik: string; tempPassword: string }> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.requireAdminRole(actor.role, u.role);
    if (u.authProvider === 'SSO') throw new DomainError('VALIDATION_ERROR', 'User SSO tidak memakai password.');
    const pw = tempPassword();
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await argon2.hash(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_RESET_PASSWORD', entity: 'user', entityId: id, after: { mustChangePassword: true } });
    return { userId: id, nik: u.nik, tempPassword: pw };
  }

  // ---- import ----------------------------------------------------------------

  /** Spec 5.9 preview (mock ImportPreview parity): row = index+2, numeric cells to string, ganda/non-karyawan errors. */
  async importPreview(rows: Record<string, unknown>[]): Promise<ImportPreview> {
    const out: ImportPreview = { created: [], updated: [], errors: [] };
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      const row = i + 2; // header is row 1
      const cells = coerceCells(rows[i]);
      const parsed = ImportRow.safeParse(cells);
      if (!parsed.success) {
        out.errors.push({ row, message: zodMessage(parsed.error.issues[0]!) });
        continue;
      }
      const r = parsed.data;
      if (seen.has(r.nik)) {
        out.errors.push({ row, message: `NIK ${r.nik} ganda di file` });
        continue;
      }
      seen.add(r.nik);
      const existing = await this.prisma.user.findUnique({ where: { nik: r.nik } });
      if (existing && existing.role !== 'EMPLOYEE') {
        out.errors.push({ row, message: `NIK ${r.nik} milik akun non-karyawan` });
        continue;
      }
      (existing ? out.updated : out.created).push(r);
    }
    return out;
  }

  async importCommit(rows: Record<string, unknown>[], actor: { id: string | null; name: string }): Promise<{ passwords: TempPassword[] }> {
    const passwords: TempPassword[] = [];
    const summary = { created: 0, updated: 0 };
    const valid = new Map<string, ImportRow>(); // nik → first row (preview already validated; skip bad/dup)
    for (const raw of rows) {
      const parsed = ImportRow.safeParse(coerceCells(raw));
      if (parsed.success && !valid.has(parsed.data.nik)) valid.set(parsed.data.nik, parsed.data);
    }
    // argon2 is slow: hash OUTSIDE the interactive tx (default 5s timeout) for niks not yet in the DB
    const known = new Set((await this.prisma.user.findMany({ where: { nik: { in: [...valid.keys()] } }, select: { nik: true } })).map((u) => u.nik));
    const temp = new Map<string, { pw: string; hash: string }>();
    for (const nik of valid.keys()) {
      if (known.has(nik)) continue;
      const pw = tempPassword();
      temp.set(nik, { pw, hash: await argon2.hash(pw) });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const r of valid.values()) {
        const existing = await tx.user.findUnique({ where: { nik: r.nik } });
        if (existing && existing.role === 'EMPLOYEE') {
          await tx.user.update({ where: { id: existing.id }, data: { name: r.name, department: r.department, phone: r.phone } });
          summary.updated++;
        } else if (!existing) {
          // ponytail: a nik created concurrently between pre-hash and tx hashes inline (rare race)
          const t = temp.get(r.nik) ?? { pw: tempPassword(), hash: '' };
          const row = await tx.user.create({
            data: {
              nik: r.nik, name: r.name, department: r.department, phone: r.phone, role: 'EMPLOYEE',
              passwordHash: t.hash || (await argon2.hash(t.pw)), mustChangePassword: true, active: true,
            },
          });
          passwords.push({ userId: row.id, nik: row.nik, tempPassword: t.pw });
          summary.created++;
        }
      }
    });
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'USER_IMPORT', entity: 'user', entityId: '-',
      after: { created: summary.created, updated: summary.updated },
    });
    return { passwords };
  }
}
