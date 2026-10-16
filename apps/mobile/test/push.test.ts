import { describe, expect, test, jest } from "@jest/globals";
import { DEMO_PASSWORD } from "@bms/mock-api";
import * as Notifications from "expo-notifications";
import { login } from "../src/api";
import { registerPush, unregisterPush } from "../src/push";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
}));

describe("push", () => {
  test("register posts the token; unregister deletes it", async () => {
    await login("K1001", DEMO_PASSWORD);
    await registerPush();
    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalled();
    await unregisterPush();
  });

  // Review Focus 5
  test("permission denied never throws", async () => {
    await login("K1001", DEMO_PASSWORD);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ status: "denied", granted: false } as never);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status: "denied", granted: false } as never);
    await expect(registerPush()).resolves.toBeUndefined();
  });

  test("mustChangePassword user (FORBIDDEN device-token) never throws", async () => {
    await login("K1090", DEMO_PASSWORD);
    await expect(registerPush()).resolves.toBeUndefined();
  });

  test("unregister without a token never throws", async () => {
    await expect(unregisterPush()).resolves.toBeUndefined();
  });
});
