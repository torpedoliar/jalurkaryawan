import { z } from "zod";

export const ErrorCode = z.enum([
  "TRIP_FULL", "CUTOFF_PASSED", "SCHEDULE_CONFLICT", "USER_SUSPENDED",
  "CAPACITY_BELOW_BOOKED", "VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN",
  "ACCOUNT_LOCKED", "MAINTENANCE", "NOT_FOUND",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({ code: ErrorCode, message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  TRIP_FULL: "Semua bus untuk rute, shift, dan arah ini sudah penuh.",
  CUTOFF_PASSED: "Batas waktu booking atau pembatalan sudah lewat.",
  SCHEDULE_CONFLICT: "Kamu sudah punya booking di tanggal, shift, dan arah yang sama.",
  USER_SUSPENDED: "Booking kamu sedang dibekukan oleh admin.",
  CAPACITY_BELOW_BOOKED: "Kapasitas baru lebih kecil dari jumlah kursi yang sudah dibooking.",
  VALIDATION_ERROR: "Data yang dikirim tidak valid.",
  UNAUTHORIZED: "Silakan login terlebih dahulu.",
  FORBIDDEN: "Kamu tidak punya akses ke fitur ini.",
  ACCOUNT_LOCKED: "Akun terkunci sementara karena terlalu banyak gagal login.",
  MAINTENANCE: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi.",
  NOT_FOUND: "Data tidak ditemukan.",
};

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  TRIP_FULL: 409, CUTOFF_PASSED: 409, SCHEDULE_CONFLICT: 409, USER_SUSPENDED: 403,
  CAPACITY_BELOW_BOOKED: 409, VALIDATION_ERROR: 400, UNAUTHORIZED: 401, FORBIDDEN: 403,
  ACCOUNT_LOCKED: 423, MAINTENANCE: 503, NOT_FOUND: 404,
};
