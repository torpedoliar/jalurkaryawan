import { z } from "zod";
import { HhMm } from "./schemas/common";

const int = (min: number, max: number, def: number) => z.number().int().min(min).max(max).default(def);

const FcmServiceAccount = z.string().default("").refine((v) => {
  if (v === "") return true;
  try {
    const j = JSON.parse(v) as Record<string, unknown>;
    return j.type === "service_account" && ["project_id", "private_key", "client_email"].every((k) => typeof j[k] === "string");
  } catch {
    return false;
  }
}, "File JSON service account Firebase tidak valid");

/** Spec 5.12. Every key has a default so an empty settings table still works. */
export const Settings = z.object({
  booking_cutoff_minutes: int(0, 1440, 120),
  generate_days_ahead: int(1, 31, 7),
  generate_run_time: HhMm.default("00:30"),
  reminder_minutes: int(5, 720, 60),
  push_enabled: z.boolean().default(false),
  fcm_service_account: FcmServiceAccount,
  notification_retention_days: int(7, 3650, 90),
  login_max_failed: int(3, 20, 5),
  login_lockout_minutes: int(1, 1440, 15),
  login_rate_limit_per_minute: int(1, 100, 10),
  access_token_minutes: int(5, 120, 15),
  refresh_token_days: int(1, 180, 30),
  password_min_length: int(6, 64, 8),
  backup_run_time: HhMm.default("02:00"),
  backup_retention_days: int(1, 365, 14),
  backup_share_enabled: z.boolean().default(false),
  backup_share_path: z.string().regex(/^(|\/\/[^/\s]+\/[^/\s]+(\/[^\s]*)?)$/, "Format //host/share/folder").default(""),
  backup_share_username: z.string().default(""),
  backup_share_password: z.string().default(""),
});
export type Settings = z.infer<typeof Settings>;

/** PUT body: any subset. Secret key: "" clears, string sets, absent leaves unchanged. */
export const SettingsUpdate = Settings.partial().strict();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

export const SECRET_SETTING_KEYS = ["fcm_service_account", "backup_share_password"] as const;
type SecretKey = (typeof SECRET_SETTING_KEYS)[number];

export const SETTING_GROUPS: Record<"booking" | "notification" | "security" | "backup", (keyof Settings)[]> = {
  booking: ["booking_cutoff_minutes", "generate_days_ahead", "generate_run_time"],
  notification: ["reminder_minutes", "push_enabled", "fcm_service_account", "notification_retention_days"],
  security: ["login_max_failed", "login_lockout_minutes", "login_rate_limit_per_minute", "access_token_minutes", "refresh_token_days", "password_min_length"],
  backup: ["backup_run_time", "backup_retention_days", "backup_share_enabled", "backup_share_path", "backup_share_username", "backup_share_password"],
};

export const SecretStatus = z.object({ isSet: z.boolean() });
export const SettingsView = Settings.omit({ fcm_service_account: true, backup_share_password: true }).extend({
  fcm_service_account: SecretStatus, backup_share_password: SecretStatus,
});
export type SettingsView = z.infer<typeof SettingsView>;

export function toSettingsView(s: Settings): SettingsView {
  const view: Record<string, unknown> = { ...s };
  for (const k of SECRET_SETTING_KEYS) view[k] = { isSet: s[k as SecretKey] !== "" };
  return view as SettingsView;
}
