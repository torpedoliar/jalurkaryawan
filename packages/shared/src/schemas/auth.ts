import { z } from "zod";
import { Role } from "../enums";
import { Id, IsoDate } from "./common";

export const LoginRequest = z.object({ nik: z.string().trim().min(1), password: z.string().min(1) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const Me = z.object({
  id: Id, nik: z.string(), name: z.string(), role: Role, vendorId: Id.nullable(),
  mustChangePassword: z.boolean(),
  bookingSuspendedUntil: IsoDate.nullable(), suspendReason: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

/** Spec 5.8 refresh token cookie (httpOnly, Path=/api/auth). Web ignores `refreshToken` in the body and lets the browser send the cookie. */
export const REFRESH_COOKIE = "bms_refresh";
/** Web gets refresh token as httpOnly cookie; mobile reads `refreshToken` from the body and sends it back in the refresh/logout body. */
export const LoginResponse = z.object({ accessToken: z.string(), refreshToken: z.string().optional(), user: Me });
export type LoginResponse = z.infer<typeof LoginResponse>;
export const RefreshResponse = LoginResponse;
export type RefreshResponse = LoginResponse;

/** newPassword min length is enforced server-side from setting `password_min_length`. */
export const ChangePasswordRequest = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(128) });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const SetupStatus = z.object({ needsSetup: z.boolean() });
export type SetupStatus = z.infer<typeof SetupStatus>;
export const SetupRequest = z.object({ nik: z.string().trim().min(1), name: z.string().trim().min(1), password: z.string().min(8).max(128) });
export type SetupRequest = z.infer<typeof SetupRequest>;
