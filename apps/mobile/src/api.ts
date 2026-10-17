import * as SecureStore from "expo-secure-store";
import { ApiError, ENDPOINTS, LoginResponse, Me, type ErrorCode } from "@bms/shared";
import type { ZodTypeAny, z } from "zod";

export class ApiFailure extends Error {
  constructor(public code: ErrorCode, message: string, public status: number) {
    super(message);
  }
}

export const REFRESH_KEY = "bms_refresh";
const BASE = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost").replace(/\/$/, "");

/** Access token lives in memory only; the refresh token lives in SecureStore. */
let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

export const apiEvents = { maintenance: () => {}, loggedOut: () => {} };

type Query = Record<string, string | undefined>;
interface Opts { body?: unknown; query?: Query }

/** Auth endpoints never trigger the refresh-and-retry path. */
const NO_RETRY: string[] = [ENDPOINTS.login, ENDPOINTS.refresh, ENDPOINTS.setup, ENDPOINTS.logout];

async function storedRefresh(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

function send(method: string, path: string, opts: Opts = {}): Promise<Response> {
  let url = `${BASE}${path}`;
  const q = Object.entries(opts.query ?? {}).filter(([, v]) => v);
  if (q.length) url += `?${new URLSearchParams(q as [string, string][]).toString()}`;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(url, { method, headers, body });
}

let refreshing: Promise<Me | null> | null = null;

/** POST {refreshToken} from SecureStore. Concurrent 401s share one refresh. Rotates: overwrites stored token. */
export function restoreSession(): Promise<Me | null> {
  refreshing ??= (async () => {
    const rt = await storedRefresh();
    if (!rt) return null;
    let r: Response;
    try {
      r = await send("POST", ENDPOINTS.refresh, { body: { refreshToken: rt } });
    } catch {
      return null;
    }
    if (!r.ok) {
      await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
      return null;
    }
    const out = LoginResponse.parse(await r.json());
    token = out.accessToken;
    if (out.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, out.refreshToken).catch(() => undefined);
    return out.user;
  })()
    .catch(() => null)
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function toFailure(res: Response): Promise<ApiFailure> {
  const parsed = ApiError.safeParse(await res.json().catch(() => null));
  return parsed.success
    ? new ApiFailure(parsed.data.code, parsed.data.message, res.status)
    : new ApiFailure("VALIDATION_ERROR", `Permintaan gagal (HTTP ${res.status}).`, res.status);
}

async function call(method: string, path: string, opts: Opts = {}): Promise<Response> {
  let res = await send(method, path, opts);
  const retryable = !NO_RETRY.includes(path);
  if (res.status === 401 && retryable && token && (await restoreSession())) res = await send(method, path, opts);
  if (res.ok) return res;
  const f = await toFailure(res);
  if (f.code === "MAINTENANCE") apiEvents.maintenance();
  if (f.status === 401 && retryable) {
    token = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
    apiEvents.loggedOut();
  }
  throw f;
}

async function request<T extends ZodTypeAny>(method: string, path: string, schema: T, opts?: Opts): Promise<z.output<T>> {
  const res = await call(method, path, opts);
  return schema.parse(res.status === 204 ? undefined : await res.json());
}

export const api = {
  get: <T extends ZodTypeAny>(path: string, schema: T, query?: Query) => request("GET", path, schema, { query }),
  post: <T extends ZodTypeAny>(path: string, schema: T, body?: unknown) => request("POST", path, schema, { body }),
  put: <T extends ZodTypeAny>(path: string, schema: T, body: unknown) => request("PUT", path, schema, { body }),
  delete: <T extends ZodTypeAny>(path: string, schema: T, body?: unknown) => request("DELETE", path, schema, { body }),
};

export async function login(nik: string, password: string): Promise<Me> {
  const out = await api.post(ENDPOINTS.login, LoginResponse, { nik, password });
  token = out.accessToken;
  if (out.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, out.refreshToken).catch(() => undefined);
  return out.user;
}

/** App start: reuse an in-memory token if present (tests log in first), else try SecureStore. */
export async function loadSession(): Promise<Me | null> {
  if (token) return api.get(ENDPOINTS.me, Me).catch(() => null);
  return restoreSession();
}

export async function logout(): Promise<void> {
  const rt = await storedRefresh();
  await send("POST", ENDPOINTS.logout, rt ? { body: { refreshToken: rt } } : {}).catch(() => undefined);
  token = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined);
}
