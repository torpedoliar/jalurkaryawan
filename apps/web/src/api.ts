import { ApiError, ENDPOINTS, LoginResponse, Me, type ErrorCode, type SetupRequest } from "@bms/shared";
import type { ZodTypeAny, z } from "zod";

export class ApiFailure extends Error {
  constructor(public code: ErrorCode, message: string, public status: number) {
    super(message);
  }
}

/** Access token lives in memory only; the refresh token is the httpOnly bms_refresh cookie (spec 5.8). */
let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

export const apiEvents = { maintenance: () => {}, loggedOut: () => {} };

type Query = Record<string, string | undefined>;
interface Opts { body?: unknown; form?: FormData; query?: Query }

/** Auth endpoints never trigger the refresh-and-retry path. */
const NO_RETRY: string[] = [ENDPOINTS.login, ENDPOINTS.refresh, ENDPOINTS.setup, ENDPOINTS.logout];

function send(method: string, path: string, opts: Opts = {}): Promise<Response> {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined = opts.form;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  return fetch(url.toString(), { method, headers, body, credentials: "same-origin" });
}

let refreshing: Promise<Me | null> | null = null;

/** POST with no body: the server reads the cookie. Concurrent 401s share one refresh. */
export function restoreSession(): Promise<Me | null> {
  refreshing ??= send("POST", ENDPOINTS.refresh)
    .then(async (r) => {
      if (!r.ok) return null;
      const out = LoginResponse.parse(await r.json());
      token = out.accessToken;
      return out.user;
    })
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
    apiEvents.loggedOut();
  }
  throw f;
}

async function request<T extends ZodTypeAny>(method: string, path: string, schema: T, opts?: Opts): Promise<z.output<T>> {
  const res = await call(method, path, opts);
  return schema.parse(res.status === 204 ? undefined : await res.json());
}

/** Save a blob through a temporary <a download>. */
export function saveBlob(blob: Blob, fileName: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName;
  a.click();
  // Revoke in its own task: one-time initial passwords download through this and exist in exactly one API response,
  // so a revoke racing the queued download would destroy credentials instead of a re-downloadable report.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const api = {
  get: <T extends ZodTypeAny>(path: string, schema: T, query?: Query) => request("GET", path, schema, { query }),
  post: <T extends ZodTypeAny>(path: string, schema: T, body?: unknown) => request("POST", path, schema, { body }),
  put: <T extends ZodTypeAny>(path: string, schema: T, body: unknown) => request("PUT", path, schema, { body }),
  upload: <T extends ZodTypeAny>(path: string, schema: T, form: FormData) => request("POST", path, schema, { form }),
  /** Needs the bearer header, so a plain <a href> cannot do it. */
  async download(path: string, fileName: string): Promise<void> {
    saveBlob(await (await call("GET", path)).blob(), fileName);
  },
};

export async function login(nik: string, password: string): Promise<Me> {
  const out = await api.post(ENDPOINTS.login, LoginResponse, { nik, password });
  token = out.accessToken; // refreshToken in the body is ignored on web; the cookie carries it
  return out.user;
}

export async function setupFirstAdmin(input: SetupRequest): Promise<Me> {
  const out = await api.post(ENDPOINTS.setup, LoginResponse, input);
  token = out.accessToken;
  return out.user;
}

/** App start: reuse an in-memory token if present (tests log in first), else try the cookie. */
export async function loadSession(): Promise<Me | null> {
  if (token) return api.get(ENDPOINTS.me, Me).catch(() => null);
  return restoreSession();
}

export async function logout(): Promise<void> {
  await send("POST", ENDPOINTS.logout).catch(() => undefined);
  token = null;
}
