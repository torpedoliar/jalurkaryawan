import { ChangePasswordRequest, ENDPOINTS, LoginRequest, REFRESH_COOKIE, SetupRequest, type LoginResponse } from "@bms/shared";
import { HttpResponse, http } from "msw";
import { z } from "zod";
import { bearer, changePassword, login, needsSetup, refresh, requireUser, setup, toMe } from "../auth";
import { handle, parseBody, type Ctx } from "../http";
import { p } from "./util";

const RefreshBody = z.object({ refreshToken: z.string().min(1).optional() });

/** Spec 5.8: web sends the refresh token as an httpOnly cookie, mobile in the body. */
async function refreshToken(ctx: Ctx): Promise<string> {
  const hasBody = ctx.request.headers.get("content-type")?.includes("json");
  const fromBody = hasBody ? (await parseBody(ctx.request, RefreshBody)).refreshToken : undefined;
  return fromBody ?? ctx.cookies[REFRESH_COOKIE] ?? "";
}

const withCookie = (r: LoginResponse) => HttpResponse.json(r, {
  headers: { "set-cookie": `${REFRESH_COOKIE}=${r.refreshToken}; Path=/api/auth; HttpOnly; Secure; SameSite=Strict` },
});
const DeviceToken = z.object({ token: z.string().min(1), platform: z.enum(["android", "ios", "web"]) });

export const authHandlers = [
  http.get(p(ENDPOINTS.setupStatus), handle(({ db }) => ({ needsSetup: needsSetup(db) }))),
  http.post(p(ENDPOINTS.setup), handle(async ({ db, request }) => setup(db, await parseBody(request, SetupRequest)))),
  http.post(p(ENDPOINTS.login), handle(async ({ db, request }) => withCookie(login(db, await parseBody(request, LoginRequest))))),
  http.post(p(ENDPOINTS.refresh), handle(async (ctx) => withCookie(refresh(ctx.db, await refreshToken(ctx))))),
  http.post(p(ENDPOINTS.logout), handle(async (ctx) => {
    const { db, request } = ctx;
    db.sessions.delete(await refreshToken(ctx));
    const access = bearer(request);
    if (access) db.sessions.delete(access);
  })),
  http.get(p(ENDPOINTS.me), handle(({ db, request }) => toMe(db, requireUser(db, request, { allowMustChange: true })))),
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