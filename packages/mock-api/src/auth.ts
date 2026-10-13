import {
  toJakartaIso,
  type ChangePasswordRequest, type LoginRequest, type LoginResponse, type Me, type Role, type SetupRequest, type TempPassword,
} from "@bms/shared";
import { DomainError, audit, nextId, type Db, type UserRow } from "./db";

const BAD_LOGIN = "NIK atau password salah.";

export const toMe = (u: UserRow): Me => ({
  id: u.id, nik: u.nik, name: u.name, role: u.role, vendorId: u.vendorId, mustChangePassword: u.mustChangePassword,
  bookingSuspendedUntil: u.bookingSuspendedUntil, suspendReason: u.suspendReason,
});

export const bearer = (request: Request): string | null =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;

export function revokeAll(db: Db, userId: string): void {
  for (const [token, id] of db.sessions) if (id === userId) db.sessions.delete(token);
}

// ponytail: mock tokens never expire; access_token_minutes / refresh_token_days expiry is backend work (Plan 4).
function issue(db: Db, u: UserRow): LoginResponse {
  const accessToken = nextId(db, "at.");
  const refreshToken = nextId(db, "rt.");
  db.sessions.set(accessToken, u.id);
  db.sessions.set(refreshToken, u.id);
  return { accessToken, refreshToken, user: toMe(u) };
}

/** Spec 5.8: lockout after login_max_failed failures; SSO users cannot use a password. */
export function login(db: Db, input: LoginRequest): LoginResponse {
  const u = db.users.find((x) => x.nik === input.nik);
  if (!u || !u.active || u.authProvider === "SSO") throw new DomainError("UNAUTHORIZED", BAD_LOGIN);
  const now = db.now().getTime();
  if (u.lockedUntil && Date.parse(u.lockedUntil) > now) throw new DomainError("ACCOUNT_LOCKED");
  if (u.password !== input.password) {
    if (++u.failedLogins >= db.settings.login_max_failed) {
      u.failedLogins = 0;
      u.lockedUntil = toJakartaIso(now + db.settings.login_lockout_minutes * 60_000);
      throw new DomainError("ACCOUNT_LOCKED");
    }
    throw new DomainError("UNAUTHORIZED", BAD_LOGIN);
  }
  u.failedLogins = 0;
  u.lockedUntil = null;
  return issue(db, u);
}

export function refresh(db: Db, refreshToken: string): LoginResponse {
  const userId = refreshToken.startsWith("rt.") ? db.sessions.get(refreshToken) : undefined;
  const u = db.users.find((x) => x.id === userId && x.active);
  if (!u) throw new DomainError("UNAUTHORIZED");
  db.sessions.delete(refreshToken);
  return issue(db, u);
}

export function requireUser(db: Db, request: Request, opts: { roles?: readonly Role[]; allowMustChange?: boolean } = {}): UserRow {
  const token = bearer(request);
  const userId = token?.startsWith("at.") ? db.sessions.get(token) : undefined;
  const u = db.users.find((x) => x.id === userId);
  if (!u || !u.active) throw new DomainError("UNAUTHORIZED");
  if (u.mustChangePassword && !opts.allowMustChange) throw new DomainError("FORBIDDEN", "Ganti password terlebih dahulu.");
  if (opts.roles && !opts.roles.includes(u.role)) throw new DomainError("FORBIDDEN");
  return u;
}

export function changePassword(db: Db, u: UserRow, input: ChangePasswordRequest): void {
  if (u.password !== input.currentPassword) throw new DomainError("VALIDATION_ERROR", "Password lama salah.");
  const min = db.settings.password_min_length;
  if (input.newPassword.length < min) throw new DomainError("VALIDATION_ERROR", `Password minimal ${min} karakter.`);
  if (input.newPassword === input.currentPassword) throw new DomainError("VALIDATION_ERROR", "Password baru harus berbeda.");
  u.password = input.newPassword;
  u.mustChangePassword = false;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (i, l, o, 0, 1)
export const tempPassword = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHABET.charAt(b % ALPHABET.length)).join("");

/** Spec 5.8: temp password shown once, must change on next login, every token revoked. */
export function resetPassword(db: Db, actorId: string, userId: string): TempPassword {
  const u = db.users.find((x) => x.id === userId);
  if (!u) throw new DomainError("NOT_FOUND");
  if (u.authProvider === "SSO") throw new DomainError("VALIDATION_ERROR", "User SSO tidak memakai password.");
  const pw = tempPassword();
  u.password = pw;
  u.mustChangePassword = true;
  u.failedLogins = 0;
  u.lockedUntil = null;
  revokeAll(db, userId);
  audit(db, actorId, "USER_RESET_PASSWORD", "user", userId, null, { mustChangePassword: true });
  return { userId, nik: u.nik, tempPassword: pw };
}

export const needsSetup = (db: Db): boolean => !db.users.some((u) => u.role === "SUPER_ADMIN");

/** Spec 5.12: first SUPER_ADMIN; locked permanently once one exists. */
export function setup(db: Db, input: SetupRequest): LoginResponse {
  if (!needsSetup(db)) throw new DomainError("FORBIDDEN", "Setup awal sudah dilakukan.");
  if (db.users.some((u) => u.nik === input.nik)) throw new DomainError("VALIDATION_ERROR", "NIK sudah dipakai.");
  if (input.password.length < db.settings.password_min_length) {
    throw new DomainError("VALIDATION_ERROR", `Password minimal ${db.settings.password_min_length} karakter.`);
  }
  const u: UserRow = {
    id: nextId(db, "usr"), nik: input.nik, name: input.name, department: "", phone: "",
    role: "SUPER_ADMIN", authProvider: "LOCAL", active: true, vendorId: null,
    bookingSuspendedUntil: null, suspendReason: null, lockedUntil: null,
    password: input.password, mustChangePassword: false, failedLogins: 0,
  };
  db.users.push(u);
  audit(db, u.id, "SETUP_SUPER_ADMIN", "user", u.id, null, { nik: u.nik });
  return issue(db, u);
}
