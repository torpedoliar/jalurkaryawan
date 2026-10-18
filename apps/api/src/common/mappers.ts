import type { UserSummary } from '@bms/shared';
import { jakartaDate, toJakartaIso } from '@bms/shared';

/** UserSummary wire shape (mock util.toSummary parity); dates via @bms/shared Jakarta helpers. */
export function toUserSummary(u: {
  id: string; nik: string; name: string; department: string; phone: string; role: string;
  authProvider: string; active: boolean; vendorId: string | null;
  bookingSuspendedUntil: Date | null; suspendReason: string | null; lockedUntil: Date | null;
}): UserSummary {
  return {
    id: u.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone,
    role: u.role as UserSummary['role'],
    authProvider: u.authProvider as UserSummary['authProvider'],
    active: u.active, vendorId: u.vendorId,
    bookingSuspendedUntil: u.bookingSuspendedUntil ? jakartaDate(u.bookingSuspendedUntil) : null,
    suspendReason: u.suspendReason,
    lockedUntil: u.lockedUntil ? toJakartaIso(u.lockedUntil.getTime()) : null,
  };
}
