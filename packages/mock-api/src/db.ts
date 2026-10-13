import {
  ERROR_MESSAGES, Settings, jakartaDate, toJakartaIso,
  type AuditLog, type BackupFile, type BookingSource, type BookingStatus, type Bus, type CancelReason,
  type Direction, type ErrorCode, type Notification, type NotificationType, type RejectedRequest, type Route, type Shift, type Stop,
  type Subscription, type Trip, type TripTemplate, type UserSummary, type Vendor,
} from "@bms/shared";

export interface UserRow extends UserSummary { password: string; mustChangePassword: boolean; failedLogins: number }

export interface BookingRow {
  id: string; userId: string; tripId: string; stopId: string; subscriptionId: string | null;
  date: string; shiftId: string; direction: Direction; source: BookingSource; status: BookingStatus;
  cancelReason: CancelReason | null; cancelledAt: string | null; createdAt: string;
}

export interface NotificationRow extends Notification { userId: string }

export interface Db {
  now: () => Date;
  seq: number;
  users: UserRow[]; vendors: Vendor[]; buses: Bus[]; shifts: Shift[]; routes: Route[]; stops: Stop[];
  templates: TripTemplate[]; trips: Trip[]; subscriptions: Subscription[]; bookings: BookingRow[];
  rejected: RejectedRequest[]; notifications: NotificationRow[]; audit: AuditLog[];
  settings: Settings; backups: BackupFile[]; maintenance: boolean;
  /** access token -> userId */
  sessions: Map<string, string>;
}

export function createDb(now: () => Date = () => new Date()): Db {
  return {
    now, seq: 0,
    users: [], vendors: [], buses: [], shifts: [], routes: [], stops: [], templates: [], trips: [],
    subscriptions: [], bookings: [], rejected: [], notifications: [], audit: [],
    settings: Settings.parse({}), backups: [], maintenance: false, sessions: new Map(),
  };
}

export const nextId = (db: Db, prefix: string) => `${prefix}${++db.seq}`;
export const nowIso = (db: Db) => toJakartaIso(db.now().getTime());
export const today = (db: Db) => jakartaDate(db.now());

export class DomainError extends Error {
  constructor(public code: ErrorCode, message = ERROR_MESSAGES[code]) {
    super(message);
  }
}

export function notify(db: Db, userId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown> = {}) {
  db.notifications.push({ id: nextId(db, "n"), userId, type, title, body, data, readAt: null, createdAt: nowIso(db) });
}

export function audit(db: Db, actorId: string, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  const actorName = db.users.find((u) => u.id === actorId)?.name ?? actorId;
  db.audit.push({ id: nextId(db, "a"), actorId, actorName, action, entity, entityId, before, after, createdAt: nowIso(db) });
}
