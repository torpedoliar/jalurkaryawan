import { ADMIN_ROLES, ENDPOINTS, ImportRequest, ImportRow, SuspendRequest, UserInput, type ImportPreview, type Role, type TempPassword } from "@bms/shared";
import { http } from "msw";
import { requireUser, resetPassword, tempPassword } from "../auth";
import { DomainError, audit, nextId, type Db, type UserRow } from "../db";
import { deactivateUser, suspendUser, unsuspendUser } from "../domain/admin";
import { handle, parseBody, type Ctx } from "../http";
import { find, p, paginate, q, toBooking, toSummary } from "./util";

const isAdminRole = (r: Role) => ADMIN_ROLES.includes(r);

/** Spec 6.1: only SUPER_ADMIN touches admin accounts (old or new role). */
function actor(ctx: Ctx, ...roles: Role[]): UserRow {
  const u = requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
  if (roles.some(isAdminRole) && u.role !== "SUPER_ADMIN") throw new DomainError("FORBIDDEN", "Hanya Super Admin yang boleh mengelola akun admin.");
  return u;
}

/** Auth first, so a stranger probing ids gets UNAUTHORIZED/FORBIDDEN, never NOT_FOUND. */
function target(ctx: Ctx): UserRow {
  requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
  return find(ctx.db.users, ctx.params.id);
}

function checkVendor(db: Db, input: UserInput) {
  if (input.vendorId) find(db.vendors, input.vendorId);
}

/** Spec 5.9 preview: Excel row numbers (header = row 1), numeric cells to string, NIK matched to existing users. */
function preview(db: Db, rows: unknown[]): ImportPreview & { valid: ImportRow[] } {
  const out: ImportPreview & { valid: ImportRow[] } = { created: [], updated: [], errors: [], valid: [] };
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const row = i + 2;
    const cells = typeof raw === "object" && raw !== null
      ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]))
      : raw;
    const parsed = ImportRow.safeParse(cells);
    if (!parsed.success) return void out.errors.push({ row, message: parsed.error.issues[0]!.message });
    const r = parsed.data;
    if (seen.has(r.nik)) return void out.errors.push({ row, message: `NIK ${r.nik} ganda di file` });
    seen.add(r.nik);
    const existing = db.users.find((u) => u.nik === r.nik);
    if (existing && existing.role !== "EMPLOYEE") return void out.errors.push({ row, message: `NIK ${r.nik} milik akun non-karyawan` });
    (existing ? out.updated : out.created).push(r);
    out.valid.push(r);
  });
  return out;
}

const newUser = (db: Db, input: Omit<UserRow, "id" | "authProvider" | "active" | "bookingSuspendedUntil" | "suspendReason" | "lockedUntil" | "mustChangePassword" | "failedLogins">): UserRow => ({
  id: nextId(db, "usr"), authProvider: "LOCAL", active: true, bookingSuspendedUntil: null, suspendReason: null,
  lockedUntil: null, mustChangePassword: true, failedLogins: 0, ...input,
});

export const userHandlers = [
  http.get(p(ENDPOINTS.users), handle((ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const term = q(ctx.url, "q")?.toLowerCase();
    const role = q(ctx.url, "role");
    const rows = ctx.db.users
      .filter((u) => (!role || u.role === role) && (!term || u.nik.toLowerCase().includes(term) || u.name.toLowerCase().includes(term)))
      .sort((a, b) => a.nik.localeCompare(b.nik))
      .map(toSummary);
    return paginate(rows, ctx.url);
  })),
  http.post(p(ENDPOINTS.users), handle(async (ctx) => {
    actor(ctx); // auth before body validation
    const input = await parseBody(ctx.request, UserInput);
    const u = actor(ctx, input.role);
    checkVendor(ctx.db, input);
    if (ctx.db.users.some((x) => x.nik === input.nik)) throw new DomainError("VALIDATION_ERROR", `NIK ${input.nik} sudah terdaftar.`);
    const pw = tempPassword();
    const row = newUser(ctx.db, { ...input, password: pw });
    ctx.db.users.push(row);
    audit(ctx.db, u.id, "USER_CREATE", "user", row.id, null, toSummary(row));
    return { userId: row.id, nik: row.nik, tempPassword: pw } satisfies TempPassword;
  })),
  http.put(p(ENDPOINTS.user(":id")), handle(async (ctx) => {
    const row = target(ctx);
    actor(ctx, row.role);
    const input = await parseBody(ctx.request, UserInput);
    const u = actor(ctx, row.role, input.role);
    checkVendor(ctx.db, input);
    if (ctx.db.users.some((x) => x.nik === input.nik && x.id !== row.id)) throw new DomainError("VALIDATION_ERROR", `NIK ${input.nik} sudah terdaftar.`);
    if (row.id === u.id && input.role !== row.role) throw new DomainError("VALIDATION_ERROR", "Tidak bisa mengubah role akun sendiri.");
    const before = toSummary(row);
    Object.assign(row, input);
    audit(ctx.db, u.id, "USER_UPDATE", "user", row.id, before, toSummary(row));
    return toSummary(row);
  })),
  http.post(p(ENDPOINTS.userResetPassword(":id")), handle((ctx) => {
    const row = target(ctx);
    return resetPassword(ctx.db, actor(ctx, row.role).id, row.id);
  })),
  http.post(p(ENDPOINTS.userSuspend(":id")), handle(async (ctx) => {
    const row = target(ctx);
    const u = actor(ctx, row.role);
    if (row.role !== "EMPLOYEE") throw new DomainError("VALIDATION_ERROR", "Pembekuan booking hanya untuk karyawan.");
    const { until, reason } = await parseBody(ctx.request, SuspendRequest);
    suspendUser(ctx.db, u.id, row.id, until, reason);
    return toSummary(row);
  })),
  http.post(p(ENDPOINTS.userUnsuspend(":id")), handle((ctx) => {
    const row = target(ctx);
    unsuspendUser(ctx.db, actor(ctx, row.role).id, row.id);
    return toSummary(row);
  })),
  http.post(p(ENDPOINTS.userDeactivate(":id")), handle((ctx) => {
    const row = target(ctx);
    const u = actor(ctx, row.role);
    if (row.id === u.id) throw new DomainError("VALIDATION_ERROR", "Tidak bisa menonaktifkan akun sendiri.");
    deactivateUser(ctx.db, u.id, row.id);
    return toSummary(row);
  })),
  http.get(p(ENDPOINTS.userBookings(":id")), handle((ctx) => {
    const row = target(ctx);
    return ctx.db.bookings
      .filter((b) => b.userId === row.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((b) => toBooking(ctx.db, b));
  })),

  http.post(p(ENDPOINTS.importPreview), handle(async (ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const { valid: _v, ...out } = preview(ctx.db, (await parseBody(ctx.request, ImportRequest)).rows);
    return out;
  })),
  http.post(p(ENDPOINTS.importCommit), handle(async (ctx) => {
    const u = requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const { valid, created, updated, errors } = preview(ctx.db, (await parseBody(ctx.request, ImportRequest)).rows);
    const passwords: TempPassword[] = [];
    for (const r of valid) {
      const existing = ctx.db.users.find((x) => x.nik === r.nik);
      if (existing) {
        Object.assign(existing, r);
        continue;
      }
      const pw = tempPassword();
      const row = newUser(ctx.db, { ...r, role: "EMPLOYEE", vendorId: null, password: pw });
      ctx.db.users.push(row);
      passwords.push({ userId: row.id, nik: row.nik, tempPassword: pw });
    }
    audit(ctx.db, u.id, "USER_IMPORT", "user", "-", null, { created: created.length, updated: updated.length, errors: errors.length });
    return { passwords };
  })),
];