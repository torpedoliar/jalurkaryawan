import { describe, expect, test } from "vitest";
import { changePassword, login, needsSetup, refresh, requireUser, resetPassword, setup } from "../src/auth";
import { DomainError } from "../src/db";
import { world } from "./fixture";

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };
const req = (token?: string) => new Request("http://localhost/api/x", { headers: token ? { authorization: `Bearer ${token}` } : {} });
const U1 = { nik: "U1", password: "password" };

describe("login", () => {
  test("returns access + refresh token and me", () => {
    const db = world();
    const r = login(db, U1);
    expect(r.accessToken.startsWith("at.")).toBe(true);
    expect(r.refreshToken?.startsWith("rt.")).toBe(true);
    expect(r.user).toMatchObject({ id: "u1", role: "EMPLOYEE", mustChangePassword: false });
    expect(requireUser(db, req(r.accessToken)).id).toBe("u1");
  });

  test("unknown nik, wrong password, inactive, SSO -> same UNAUTHORIZED message", () => {
    const db = world();
    db.users[1]!.active = false;
    db.users[2]!.authProvider = "SSO";
    const msgs = [
      { nik: "NOPE", password: "password" }, { nik: "U1", password: "wrong" },
      { nik: "U2", password: "password" }, { nik: "U3", password: "password" },
    ].map((i) => { try { login(db, i); return "OK"; } catch (e) { return `${(e as DomainError).code}:${(e as Error).message}`; } });
    expect(new Set(msgs)).toEqual(new Set(["UNAUTHORIZED:NIK atau password salah."]));
  });

  test("locks after login_max_failed failures, unlocks after login_lockout_minutes", () => {
    const db = world();
    db.settings.login_max_failed = 3;
    const bad = { nik: "U1", password: "x" };
    expect([code(() => login(db, bad)), code(() => login(db, bad)), code(() => login(db, bad))]).toEqual(["UNAUTHORIZED", "UNAUTHORIZED", "ACCOUNT_LOCKED"]);
    expect(code(() => login(db, U1))).toBe("ACCOUNT_LOCKED");
    db.now = () => new Date("2026-10-14T00:16:00+07:00"); // default lockout 15 min
    expect(login(db, U1).user.id).toBe("u1");
    expect(db.users[0]).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  test("refresh rotates the refresh token", () => {
    const db = world();
    const r = login(db, U1);
    const r2 = refresh(db, r.refreshToken!);
    expect(r2.refreshToken).not.toBe(r.refreshToken);
    expect(code(() => refresh(db, r.refreshToken!))).toBe("UNAUTHORIZED");
    expect(code(() => refresh(db, r.accessToken))).toBe("UNAUTHORIZED");
  });
});

describe("requireUser", () => {
  test("no token or refresh token -> UNAUTHORIZED; wrong role -> FORBIDDEN", () => {
    const db = world();
    const r = login(db, U1);
    expect(code(() => requireUser(db, req()))).toBe("UNAUTHORIZED");
    expect(code(() => requireUser(db, req(r.refreshToken)))).toBe("UNAUTHORIZED");
    expect(code(() => requireUser(db, req(r.accessToken), { roles: ["ADMIN_GA", "SUPER_ADMIN"] }))).toBe("FORBIDDEN");
  });

  test("mustChangePassword blocks everything except allowMustChange until changed", () => {
    const db = world();
    db.users[0]!.mustChangePassword = true;
    const r = login(db, U1);
    expect(code(() => requireUser(db, req(r.accessToken)))).toBe("FORBIDDEN");
    const u = requireUser(db, req(r.accessToken), { allowMustChange: true });
    changePassword(db, u, { currentPassword: "password", newPassword: "newpass99" });
    expect(requireUser(db, req(r.accessToken)).id).toBe("u1");
  });
});

describe("password management", () => {
  test("change password checks current password and password_min_length", () => {
    const db = world();
    const u = db.users[0]!;
    db.settings.password_min_length = 10;
    expect(code(() => changePassword(db, u, { currentPassword: "nope", newPassword: "longenough1" }))).toBe("VALIDATION_ERROR");
    expect(code(() => changePassword(db, u, { currentPassword: "password", newPassword: "short99" }))).toBe("VALIDATION_ERROR");
    changePassword(db, u, { currentPassword: "password", newPassword: "longenough1" });
    expect(login(db, { nik: "U1", password: "longenough1" }).user.id).toBe("u1");
  });

  test("admin reset: one-time temp password, mustChangePassword, all sessions revoked, audited", () => {
    const db = world();
    const old = login(db, U1);
    const t = resetPassword(db, "adm", "u1");
    expect(t).toMatchObject({ userId: "u1", nik: "U1" });
    expect(t.tempPassword).toHaveLength(10);
    expect(code(() => requireUser(db, req(old.accessToken)))).toBe("UNAUTHORIZED");
    expect(login(db, { nik: "U1", password: t.tempPassword }).user.mustChangePassword).toBe(true);
    expect(db.audit.at(-1)).toMatchObject({ action: "USER_RESET_PASSWORD", entityId: "u1" });
  });
});

describe("setup", () => {
  test("only while no SUPER_ADMIN exists", () => {
    const db = world();
    db.users = db.users.filter((u) => u.role !== "SUPER_ADMIN");
    expect(needsSetup(db)).toBe(true);
    const r = setup(db, { nik: "root", name: "Root", password: "rootpass1" });
    expect(r.user.role).toBe("SUPER_ADMIN");
    expect(needsSetup(db)).toBe(false);
    expect(code(() => setup(db, { nik: "root2", name: "Root 2", password: "rootpass1" }))).toBe("FORBIDDEN");
  });
});
