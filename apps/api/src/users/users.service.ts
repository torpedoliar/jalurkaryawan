import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import {
  ADMIN_ROLES, ImportRow, jakartaDate, type UserInput, type UserSummary,
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
    // brief test pins self-role message for a non-super caller; check before the admin-role guard
    if (old.role !== input.role && id === actor.id) {
      throw new DomainError('VALIDATION_ERROR', 'Tidak bisa mengubah role akun sendiri.');
    }
    this.requireAdminRole(actor.role, old.role);
    this.requireAdminRole(actor.role, input.role);
    if (input.vendorId && !(await this.prisma.vendor.findUnique({ where: { id: input.vendorId } }))) {
      throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    }
    const dup = await this.prisma.user.findUnique({ where: { nik: input.nik } });
    if (dup && dup.id !== id) throw new DomainError('VALIDATION_ERROR', `NIK ${input.nik} sudah terdaftar.`);
    const before = toUserSummary(old);
    const u = await this.prisma.user.update({
      where: { id },
      data: { nik: input.nik, name: input.name, department: input.department, phone: input.phone, role: input.role, vendorId: input.vendorId },
    });
    const after = toUserSummary(u);
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_UPDATE', entity: 'user', entityId: id, before, after });
    return after;
  }

  async suspend(id: string, until: string, reason: string, actor: Actor): Promise<UserSummary> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new DomainError('NOT_FOUND', 'Data tidak ditemukan.');
    this.requireAdminRole(actor.role, u.role);
    if (u.role !== 'EMPLOYEE') throw new DomainError('VALIDATION_ERROR', 'Pembekuan booking hanya untuk karyawan.');
    if (until < jakartaDate(new Date())) throw new DomainError('VALIDATION_ERROR', 'Tanggal akhir pembekuan sudah lewat.');
    const before = toUserSummary(u);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { bookingSuspendedUntil: new Date(`${until}T00:00:00+07:00`), suspendReason: reason },
    });
    await this.audit.write({ actorId: actor.id, actorName: actor.name, action: 'USER_SUSPEND', entity: 'user', entityId: id, before, after: toUserSummary(updated) });
    return toUserSummary(updated);
  }

  /** Task 9 admin deactivate calls this before cancelling bookings. */
  async deactivateSelfGuard(id: string, actorId: string): Promise<void> {
    if (id === actorId) throw new DomainError('VALIDATION_ERROR', 'Tidak bisa menonaktifkan akun sendiri.');
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

  /** Spec 5.9 preview: Excel row numbers (header = row 1), numeric cells to string, NIK matched to existing users. */
  async importPreview(rows: Record<string, unknown>[]): Promise<{
    created: number; updated: number; errors: { row: number; nik: string; message: string }[];
  }> {
    const errors: { row: number; nik: string; message: string }[] = [];
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = i + 2; // header is row 1
      const cells = coerceCells(rows[i]);
      const parsed = ImportRow.safeParse(cells);
      if (!parsed.success) {
        errors.push({ row, nik: typeof cells.nik === 'string' ? cells.nik : '', message: zodMessage(parsed.error.issues[0]!) });
        continue;
      }
      const r = parsed.data;
      if (seen.has(r.nik)) {
        errors.push({ row, nik: r.nik, message: `NIK ${r.nik} ganda di file` });
        continue;
      }
      seen.add(r.nik);
      const existing = await this.prisma.user.findUnique({ where: { nik: r.nik } });
      if (existing && existing.role !== 'EMPLOYEE') {
        errors.push({ row, nik: r.nik, message: `NIK ${r.nik} milik akun non-karyawan` });
        continue;
      }
      if (existing) updated++;
      else created++;
    }
    return { created, updated, errors };
  }

  async importCommit(rows: Record<string, unknown>[], actor: { id: string | null; name: string }): Promise<{ passwords: Record<string, string> }> {
    const passwords: Record<string, string> = {};
    const summary = { created: 0, updated: 0 };
    await this.prisma.$transaction(async (tx) => {
      const seen = new Set<string>();
      for (const raw of rows) {
        const parsed = ImportRow.safeParse(coerceCells(raw));
        if (!parsed.success || seen.has(parsed.data.nik)) continue; // preview already validated; skip bad/dup
        const r = parsed.data;
        seen.add(r.nik);
        const existing = await tx.user.findUnique({ where: { nik: r.nik } });
        if (existing && existing.role === 'EMPLOYEE') {
          await tx.user.update({ where: { id: existing.id }, data: { name: r.name, department: r.department, phone: r.phone } });
          summary.updated++;
        } else if (!existing) {
          const pw = tempPassword();
          passwords[r.nik] = pw;
          await tx.user.create({
            data: {
              nik: r.nik, name: r.name, department: r.department, phone: r.phone, role: 'EMPLOYEE',
              passwordHash: await argon2.hash(pw), mustChangePassword: true, active: true,
            },
          });
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
