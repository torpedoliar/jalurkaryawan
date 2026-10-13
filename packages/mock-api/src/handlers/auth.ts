import { ChangePasswordRequest, ENDPOINTS, LoginRequest, SetupRequest } from "@bms/shared";
import { http } from "msw";
import { z } from "zod";
import { bearer, changePassword, login, needsSetup, refresh, requireUser, setup, toMe } from "../auth";
import { handle, parseBody } from "../http";
import { p } from "./util";

const RefreshBody = z.object({ refreshToken: z.string().min(1) });
const DeviceToken = z.object({ token: z.string().min(1), platform: z.enum(["android", "ios", "web"]) });

export const authHandlers = [
  http.get(p(ENDPOINTS.setupStatus), handle(({ db }) => ({ needsSetup: needsSetup(db) }))),
  http.post(p(ENDPOINTS.setup), handle(async ({ db, request }) => setup(db, await parseBody(request, SetupRequest)))),
  http.post(p(ENDPOINTS.login), handle(async ({ db, request }) => login(db, await parseBody(request, LoginRequest)))),
  http.post(p(ENDPOINTS.refresh), handle(async ({ db, request }) => refresh(db, (await parseBody(request, RefreshBody)).refreshToken))),
  http.post(p(ENDPOINTS.logout), handle(async ({ db, request }) => {
    const { refreshToken } = await parseBody(request, RefreshBody);
    db.sessions.delete(refreshToken);
    const access = bearer(request);
    if (access) db.sessions.delete(access);
  })),
  http.get(p(ENDPOINTS.me), handle(({ db, request }) => toMe(requireUser(db, request, { allowMustChange: true })))),
  http.post(p(ENDPOINTS.changePassword), handle(async ({ db, request }) => {
    const u = requireUser(db, request, { allowMustChange: true });
    changePassword(db, u, await parseBody(request, ChangePasswordRequest));
  })),
  // ponytail: tokens are validated and dropped; FCM storage is backend work (Plan 4).
  http.post(p(ENDPOINTS.deviceTokens), handle(async ({ db, request }) => {
    requireUser(db, request);
    await parseBody(request, DeviceToken);
  })),
  http.delete(p(ENDPOINTS.deviceTokens), handle(async ({ db, request }) => {
    requireUser(db, request);
    await parseBody(request, DeviceToken.pick({ token: true }));
  })),
];