type UserRow = {
  passwordHash?: unknown;
  password?: unknown;
  mustChangePassword?: unknown;
  failedLogins?: unknown;
};

/** Strip auth-only fields before returning a user row (mock util.toSummary parity). Minimal here; Task 7 expands. */
export function toUserSummary<T extends UserRow>(user: T): Omit<T, keyof UserRow> {
  const { passwordHash: _p, password: _pw, mustChangePassword: _m, failedLogins: _f, ...rest } = user;
  return rest;
}
