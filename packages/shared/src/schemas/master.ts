import { z } from "zod";
import { AuthProvider, Role } from "../enums";
import { HexColor, HhMm, Id, IsoDate } from "./common";

export const VendorInput = z.object({ name: z.string().trim().min(1), contact: z.string().trim().default(""), active: z.boolean().default(true) });
export type VendorInput = z.infer<typeof VendorInput>;
export const Vendor = VendorInput.extend({ id: Id });
export type Vendor = z.infer<typeof Vendor>;

export const BusInput = z.object({
  plate: z.string().trim().min(3).transform((s) => s.toUpperCase()),
  capacity: z.number().int().min(1).max(100),
  vendorId: Id, active: z.boolean().default(true),
});
export type BusInput = z.infer<typeof BusInput>;
export const Bus = z.object({ id: Id, plate: z.string(), capacity: z.number().int(), vendorId: Id, active: z.boolean() });
export type Bus = z.infer<typeof Bus>;

export const ShiftInput = z.object({ name: z.string().trim().min(1), startTime: HhMm, endTime: HhMm });
export type ShiftInput = z.infer<typeof ShiftInput>;
export const Shift = ShiftInput.extend({ id: Id });
export type Shift = z.infer<typeof Shift>;

export const RouteInput = z.object({
  code: z.string().trim().min(1).max(10), name: z.string().trim().min(1),
  color: HexColor, active: z.boolean().default(true),
});
export type RouteInput = z.infer<typeof RouteInput>;
export const Route = RouteInput.extend({ id: Id });
export type Route = z.infer<typeof Route>;

/** offsetMinutes: minutes after trip departure that the bus reaches this stop. */
export const StopInput = z.object({
  name: z.string().trim().min(1), seq: z.number().int().min(1),
  offsetMinutes: z.number().int().min(0).max(300),
  lat: z.number().nullable().default(null), lng: z.number().nullable().default(null),
  active: z.boolean().default(true),
});
export type StopInput = z.infer<typeof StopInput>;
export const Stop = StopInput.extend({ id: Id, routeId: Id });
export type Stop = z.infer<typeof Stop>;

export const UserSummary = z.object({
  id: Id, nik: z.string(), name: z.string(), department: z.string(), phone: z.string(),
  role: Role, authProvider: AuthProvider, active: z.boolean(), vendorId: Id.nullable(),
  bookingSuspendedUntil: IsoDate.nullable(), suspendReason: z.string().nullable(),
  lockedUntil: z.string().nullable(),
});
export type UserSummary = z.infer<typeof UserSummary>;

/** Manual create/update (admins, vendor accounts, single employee). Bulk employees come from import. */
export const UserInput = z.object({
  nik: z.string().trim().min(1), name: z.string().trim().min(1),
  department: z.string().trim().default(""), phone: z.string().trim().default(""),
  role: Role, vendorId: Id.nullable().default(null),
}).refine((u) => (u.role === "VENDOR") === (u.vendorId !== null), { message: "vendorId wajib hanya untuk role VENDOR", path: ["vendorId"] });
export type UserInput = z.infer<typeof UserInput>;

/** Shown once after create / reset / import. */
export const TempPassword = z.object({ userId: Id, nik: z.string(), tempPassword: z.string() });
export type TempPassword = z.infer<typeof TempPassword>;

/** Rows produced by SheetJS in the browser, sent as JSON. */
export const ImportRow = z.object({
  nik: z.string().trim().min(1, "NIK kosong"), name: z.string().trim().min(1, "Nama kosong"),
  department: z.string().trim().default(""), phone: z.string().trim().default(""),
});
export type ImportRow = z.infer<typeof ImportRow>;
export const ImportRequest = z.object({ rows: z.array(z.unknown()).max(10000) });
export type ImportRequest = z.infer<typeof ImportRequest>;
export const ImportPreview = z.object({
  created: z.array(ImportRow), updated: z.array(ImportRow),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
});
export type ImportPreview = z.infer<typeof ImportPreview>;
export const ImportCommitResponse = z.object({ passwords: z.array(TempPassword) });
export type ImportCommitResponse = z.infer<typeof ImportCommitResponse>;

export const SuspendRequest = z.object({ until: IsoDate, reason: z.string().trim().min(1) });
export type SuspendRequest = z.infer<typeof SuspendRequest>;
