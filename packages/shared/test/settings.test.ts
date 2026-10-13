import { describe, expect, test } from "vitest";
import { SECRET_SETTING_KEYS, SETTING_GROUPS, Settings, SettingsUpdate, toSettingsView } from "../src/index";

describe("settings", () => {
  test("defaults match spec 5.12", () => {
    const s = Settings.parse({});
    expect(s).toMatchObject({
      booking_cutoff_minutes: 120, generate_days_ahead: 7, generate_run_time: "00:30",
      reminder_minutes: 60, push_enabled: false, fcm_service_account: "", notification_retention_days: 90,
      login_max_failed: 5, login_lockout_minutes: 15, login_rate_limit_per_minute: 10,
      access_token_minutes: 15, refresh_token_days: 30, password_min_length: 8,
      backup_run_time: "02:00", backup_retention_days: 14, backup_share_enabled: false,
      backup_share_path: "", backup_share_username: "", backup_share_password: "",
    });
    expect(Object.keys(s)).toHaveLength(19);
  });

  test.each([
    ["booking_cutoff_minutes", -1], ["booking_cutoff_minutes", 1441], ["generate_days_ahead", 0],
    ["generate_days_ahead", 32], ["reminder_minutes", 4], ["login_max_failed", 21],
    ["password_min_length", 5], ["refresh_token_days", 181], ["backup_retention_days", 0],
    ["generate_run_time", "24:00"], ["backup_share_path", "\\\\host\\share"],
  ])("rejects %s = %s", (key, value) => {
    expect(SettingsUpdate.safeParse({ [key]: value }).success).toBe(false);
  });

  test("accepts boundary values and partial update", () => {
    expect(SettingsUpdate.safeParse({ booking_cutoff_minutes: 0, generate_days_ahead: 31 }).success).toBe(true);
    expect(SettingsUpdate.parse({ reminder_minutes: 30 })).toEqual({ reminder_minutes: 30 });
    expect(SettingsUpdate.safeParse({ backup_share_path: "//nas/backup/bms" }).success).toBe(true);
  });

  test("fcm service account must be JSON with required fields when set", () => {
    expect(SettingsUpdate.safeParse({ fcm_service_account: "not json" }).success).toBe(false);
    const ok = JSON.stringify({ type: "service_account", project_id: "p", private_key: "k", client_email: "a@b.c" });
    expect(SettingsUpdate.safeParse({ fcm_service_account: ok }).success).toBe(true);
    expect(SettingsUpdate.safeParse({ fcm_service_account: "" }).success).toBe(true);
  });

  test("view never exposes secrets", () => {
    const s = Settings.parse({ backup_share_password: "hunter2" });
    const view = toSettingsView(s);
    expect(view.backup_share_password).toEqual({ isSet: true });
    expect(view.fcm_service_account).toEqual({ isSet: false });
    expect(JSON.stringify(view)).not.toContain("hunter2");
    expect(SECRET_SETTING_KEYS).toEqual(["fcm_service_account", "backup_share_password"]);
  });

  test("groups cover every key exactly once", () => {
    const all = Object.values(SETTING_GROUPS).flat().sort();
    expect(all).toEqual(Object.keys(Settings.shape).sort());
  });
});
