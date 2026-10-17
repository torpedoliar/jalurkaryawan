import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { z } from "zod";
import { ENDPOINTS } from "@bms/shared";
import { api } from "./api";

let currentToken: string | null = null;

/** Spec 6.2: register FCM token once the session is usable (login, restore, after forced change). Never throws — push is best-effort. */
export async function registerPush(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    const { status } = existing === "granted"
      ? { status: existing }
      : await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (!data) return;
    currentToken = data;
    const platform = Platform.OS === "ios" ? "ios" : "android";
    await api.post(ENDPOINTS.deviceTokens, z.void(), { token: data, platform });
  } catch {
    // best-effort: login already succeeded, push must not surface an error
  }
}

/** Spec 6.2: delete FCM token on logout. Never throws. */
export async function unregisterPush(): Promise<void> {
  try {
    if (currentToken) await api.delete(ENDPOINTS.deviceTokens, z.void(), { token: currentToken });
  } catch {
    // best-effort: logout proceeds regardless
  } finally {
    currentToken = null;
  }
}
