import { z } from "zod";
import { Direction, NotificationType } from "../enums";
import { HexColor, Id, IsoDate, IsoDateTime } from "./common";

export const OccupancyRow = z.object({
  date: IsoDate, routeId: Id, routeCode: z.string(), routeName: z.string(), routeColor: HexColor,
  shiftId: Id, shiftName: z.string(), direction: Direction,
  trips: z.number().int(), capacity: z.number().int(), booked: z.number().int(), rejected: z.number().int(),
});
export type OccupancyRow = z.infer<typeof OccupancyRow>;

export const DashboardSummary = z.object({
  date: IsoDate, trips: z.number().int(), capacity: z.number().int(), booked: z.number().int(),
  fullTrips: z.number().int(), rejectedToday: z.number().int(), rejectedYesterday: z.number().int(),
  rejectedLast7: z.array(z.object({ date: IsoDate, count: z.number().int() })),
  backupWarning: z.string().nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

export const NoShowCandidate = z.object({ userId: Id, nik: z.string(), name: z.string(), noShows30d: z.number().int() });
export type NoShowCandidate = z.infer<typeof NoShowCandidate>;

export const Notification = z.object({
  id: Id, type: NotificationType, title: z.string(), body: z.string(),
  data: z.record(z.unknown()), readAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof Notification>;

export const AuditLog = z.object({
  id: Id, actorId: Id, actorName: z.string(), action: z.string(), entity: z.string(), entityId: z.string(),
  before: z.unknown(), after: z.unknown(), createdAt: IsoDateTime,
});
export type AuditLog = z.infer<typeof AuditLog>;

export const BackupFile = z.object({ name: z.string(), sizeBytes: z.number().int(), createdAt: IsoDateTime, copiedToShare: z.boolean() });
export type BackupFile = z.infer<typeof BackupFile>;
export const RestoreRequest = z.object({ fileName: z.string().min(1), password: z.string().min(1), confirm: z.literal("RESTORE") });
export type RestoreRequest = z.infer<typeof RestoreRequest>;
export const SystemStatus = z.object({ maintenance: z.boolean(), message: z.string().nullable() });
export type SystemStatus = z.infer<typeof SystemStatus>;
