import { describe, expect, test, jest } from "@jest/globals";
import { DEMO_PASSWORD } from "@bms/mock-api";
import * as Notifications from "expo-notifications";
import { HttpResponse, http } from "msw";
import { Platform } from "react-native";
import { ENDPOINTS } from "@bms/shared";
import { screen, waitFor } from "@testing-library/react-native";
import { login, setToken } from "../src/api";
import { registerPush, unregisterPush } from "../src/push";
import { renderApp } from "./render";
import { server } from "./setup";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
}));

describe("push", () => {
  test("register posts the token; unregister deletes it", async () => {
    await login("K1001", DEMO_PASSWORD);
    const sent: Record<string, unknown> = {};
    server.use(
      http.post(`*${ENDPOINTS.deviceTokens}`, async ({ request }) => { sent.POST = await request.json(); return new HttpResponse(null, { status: 204 }); }),
      http.delete(`*${ENDPOINTS.deviceTokens}`, async ({ request }) => { sent.DELETE = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    await registerPush();
    expect(sent.POST).toEqual({ token: "ExponentPushToken[test]", platform: Platform.OS === "ios" ? "ios" : "android" });
    await unregisterPush();
    expect(sent.DELETE).toEqual({ token: "ExponentPushToken[test]" });
  });

  // Mock-api validates both bodies (DeviceToken / pick token) and answers 400 on a wrong shape.
  test("unregister body passes mock-api validation", async () => {
    await login("K1001", DEMO_PASSWORD);
    const statuses: number[] = [];
    server.events.on("response:mocked", ({ request, response }) => { if (request.url.endsWith(ENDPOINTS.deviceTokens)) statuses.push(response.status); });
    await registerPush();
    await unregisterPush();
    server.events.removeAllListeners();
    expect(statuses).toEqual([204, 204]);
  });

  test("App registers the token when a session is restored from SecureStore (no form login)", async () => {
    await login("K1001", DEMO_PASSWORD);
    setToken(null); // app restart: only the stored refresh token survives
    let posts = 0;
    server.use(http.post(`*${ENDPOINTS.deviceTokens}`, () => { posts++; return new HttpResponse(null, { status: 204 }); }));
    await renderApp();
    await screen.findByRole("header", { name: "Beranda" });
    await waitFor(() => expect(posts).toBe(1));
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
