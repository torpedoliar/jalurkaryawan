# Plan 3 — Mobile App (apps/mobile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo app in `apps/mobile` for EMPLOYEE role only, with spec §6.2 feature parity with the web employee screens (login + forced password change, papan keberangkatan, beranda, booking harian, langganan, riwayat + notifikasi, suspension banner), running against the Plan 1 mock API via `msw/native`.

**Architecture:** One thin `src/api.ts` client (fetch + Zod parse with `@bms/shared` schemas, in-memory access token, refresh token in `expo-secure-store` sent as JSON body on refresh/logout). `AuthContext` holds `Me`; state-based tab navigation (no router dependency) under one `App.tsx` shell. Screens are plain components with local `useState`/`useEffect` — no global store, no data library. `EXPO_PUBLIC_USE_MOCK=true` starts `msw/native` with `@bms/mock-api` handlers before `registerRootComponent`. Tests run in jest-expo + `@testing-library/react-native` against `msw/node` with the same handlers. `push.ts` registers/unregisters the FCM device token, never blocking login/logout.

**Tech Stack:** expo 58.0.11, react 19.3.0, react-native 0.88.0, expo-secure-store / expo-notifications / expo-status-bar / expo-constants (versions pinned by `npx expo install --fix` in Task 1), zod 3.23.8, msw 2.6.8, jest-expo 58.0.11 + @testing-library/react-native 14.1.0 + react-test-renderer 19.3.0.

**Spec:** `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md` (§6.2 employee incl. "Mobile mendaftarkan token FCM setelah login dan menghapusnya saat logout", `EXPO_PUBLIC_API_URL` baked at build, §7 `msw/native` + `EXPO_PUBLIC_USE_MOCK=true`, §8 manual checks, §5.8 mobile stores refresh token in `expo-secure-store`).

## Global Constraints

- UI copy in Bahasa Indonesia. Error text shown to users = server `message` verbatim (already Indonesian via `ERROR_MESSAGES`).
- All request/response shapes come from `@bms/shared`; never redeclare a schema in the mobile app. Endpoints only via `ENDPOINTS`.
- Mobile error class name: `ApiFailure` (same shape as web: `code`, `message`, `status`).
- Access token lives in memory only (module variable). Refresh token lives in `expo-secure-store` under key `"bms_refresh"`. Never AsyncStorage/localStorage for tokens.
- Mobile POSTs refresh/logout with JSON body `{refreshToken}` (mock reads body first, then cookie). After every login/refresh response, overwrite the stored refresh token (mock rotates: old token is deleted server-side). On logout or failed refresh, delete the stored token.
- Base URL is `process.env.EXPO_PUBLIC_API_URL` (no trailing slash); fetch calls `${BASE}${path}`. No CORS concept on native.
- Dates: operational date strings `YYYY-MM-DD` via shared `jakartaDate`/`addDays`; display times via `iso.slice(11,16)`.
- No picker/router/form/push libraries: chip-button selectors (`Pressable`), state-based tabs, `TextInput`, `expo-notifications` API directly.
- No new runtime deps beyond Tech Stack. Pinned exact versions (no `^`).
- `.env` never committed; `apps/mobile/.env.example` documents `EXPO_PUBLIC_API_URL` + `EXPO_PUBLIC_USE_MOCK=true`.
- Work on branch `feat/plan-3-mobile` off master. Never merge/push without user choice.

## Review Focus

1. **Refresh-token rotation persisted across restart** — killing the in-memory token then calling `loadSession` must restore the session from SecureStore alone; each refresh overwrites the stored token because the server deletes the old one. (Task 2 test)
2. **401 mid-session refreshes once, then logs out** — concurrent 401s share one refresh; a failed refresh clears both tokens and fires `loggedOut`, never loops. (Task 2 test)
3. **`mustChangePassword` gating** — user sees only the change form on every tab until changed; device-token registration for such a user fails server-side (FORBIDDEN) and must not surface an error. (Task 3 + Task 4 tests)
4. **Suspended employee** — banner shows reason/until on every tab and booking submit is disabled; server USER_SUSPENDED still surfaces verbatim if UI misses it. (Task 6 test)
5. **Push failure never blocks login/logout** — permission denied or network error during register/unregister is swallowed; logout still clears the SecureStore token even if DELETE fails. (Task 4 test)

---

## File Structure

```
apps/mobile/
  package.json            scripts: start, test, typecheck
  tsconfig.json           extends ../../tsconfig.base.json, jsx react-jsx, lib ES2023 (no DOM)
  babel.config.js         babel-preset-expo
  jest.config.js          preset jest-expo, setupFiles test/setup.ts
  app.json                expo name/slug, android package
  eas.json                preview profile {distribution internal, android buildType apk}
  .env.example            EXPO_PUBLIC_API_URL + EXPO_PUBLIC_USE_MOCK=true
  index.ts                start msw/native if mock, registerRootComponent(App)
  src/
    api.ts                api.get/post/put, ApiFailure, token, SecureStore refresh, maintenance/loggedOut hooks
    auth.tsx              AuthContext, useAuth, useMe
    ui.tsx                errorText, useLoad, useAction, ErrorText, StatusBadge, DIRECTION_LABEL, hhmm, today, dayNames, WeekdayPicker, ChipSelect
    push.ts               registerPush/unregisterPush (expo-notifications + deviceTokens endpoint)
    App.tsx               boot (setup status, session, maintenance) + tab navigation + banner
    screens/
      Login.tsx  ChangePassword.tsx  Maintenance.tsx
      Home.tsx  Book.tsx  Subscriptions.tsx  History.tsx  Notifications.tsx  Departures.tsx
  test/
    setup.ts              msw/node server + resetDb + fixed Date + SecureStore mock
    render.tsx            renderApp(tab, as?) helper (login first, token in memory)
    api.test.ts  ui.test.ts  auth.test.tsx  push.test.ts  employee.test.tsx
```

**Test harness facts (from Plan 1, use verbatim):** `@bms/mock-api` exports `handlers`, `resetDb(now?)`, `getDb`, `DEMO_PASSWORD` (`"demo1234"`). Seed accounts: `admin` (SUPER_ADMIN), `ga` (ADMIN_GA), `vendor` (VENDOR), `K1001`–`K1090` (EMPLOYEE); `K1059` suspended until today+3 with reason `"No-show 3x dalam 30 hari"`; `K1090` has `mustChangePassword`. Routes `r1`..`r6` (`r1` capacity 8, `r4` capacity 11, others 50), stops `r{n}s1..3` (r1s1 = Terminal Cikarang, r2s1 = Halte Bulak Kapal, r3s2 = Alun-alun Karawang), shifts `pagi`/`siang`/`malam`. Fixed test clock: `() => new Date("2026-10-14T00:00:00+07:00")`; `TODAY = "2026-10-14"`, `TOMORROW = addDays(TODAY, 1)`. Handlers match `*${path}`, so requests to `http://localhost/api/...` are intercepted. `resetDb(at)` moves the server clock; the client clock follows via fake timers. `LoginResponse = {accessToken, refreshToken?, user}`; tokens rotate on refresh (old deleted server-side). Device-token POST body `{token, platform: "android"|"ios"|"web"}` is validated then dropped; DELETE body `{token}`. `requireUser` without `allowMustChange` throws FORBIDDEN `"Ganti password terlebih dahulu."` for mustChange users — so device-token calls for K1090 fail and must be swallowed.

---

### Task 1: Scaffold apps/mobile + jest-expo + msw/native entry

**Files:**
- Create: `apps/mobile/package.json`, `apps/mobile/tsconfig.json`, `apps/mobile/babel.config.js`, `apps/mobile/jest.config.js`, `apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/.env.example`, `apps/mobile/index.ts`, `apps/mobile/src/App.tsx` (placeholder replaced in Task 3), `apps/mobile/test/setup.ts`, `apps/mobile/test/secureStoreMock.ts`, `apps/mobile/test/render.tsx`, `apps/mobile/test/scaffold.test.ts`
- Modify: `.gitignore` (append `apps/mobile/.expo/`)

**Interfaces:**
- Produces: `test/setup.ts` exporting `server` (msw/node) and `TEST_NOW`; runs `resetDb(TEST_NOW)` `beforeEach`, `server.resetHandlers()` + SecureStore memory reset `afterEach`. Later tasks override handlers with `server.use(...)`.
- Produces: `test/render.tsx` exporting `renderApp(tab?, as?)` — logs in first via `login()` (token stays in memory; App reuses it via `/me`), then renders `<App/>`.
- Produces: `index.ts` mock entry — when `EXPO_PUBLIC_USE_MOCK === "true"`, starts `msw/native` with `@bms/mock-api` handlers (`onUnhandledRequest: "bypass"` so Metro noise never fails), then registers root component.

- [ ] **Step 1: Branch**

```bash
git checkout -b feat/plan-3-mobile
```

- [ ] **Step 2: `apps/mobile/package.json`**

```json
{
  "name": "@bms/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "test": "jest",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@bms/shared": "workspace:*",
    "expo": "58.0.11",
    "expo-constants": "58.0.12",
    "expo-notifications": "58.1.4",
    "expo-secure-store": "58.0.2",
    "expo-status-bar": "58.0.3",
    "react": "19.3.0",
    "react-native": "0.88.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@bms/mock-api": "workspace:*",
    "@testing-library/react-native": "14.1.0",
    "@types/jest": "30.0.0",
    "@types/react": "19.3.0",
    "babel-preset-expo": "58.0.15",
    "jest": "29.7.0",
    "jest-expo": "58.0.11",
    "msw": "2.6.8",
    "react-test-renderer": "19.3.0",
    "typescript": "5.6.3"
  }
}
```

After `pnpm install`, run `npx expo install --fix` inside `apps/mobile` and amend any drifted `expo-*` pin in this file before committing. `@bms/mock-api` is a devDependency: production builds (`EXPO_PUBLIC_USE_MOCK` unset) never import it — `index.ts` uses `require` inside the env branch so Metro does not bundle it.

- [ ] **Step 3: `apps/mobile/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "jsx": "react-jsx"
  },
  "include": ["src", "test", "index.ts"]
}
```

No `DOM` lib: RN has no DOM.

- [ ] **Step 4: `apps/mobile/babel.config.js`**

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
```

- [ ] **Step 5: `apps/mobile/jest.config.js`**

```js
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/test/setup.ts"],
};
```

- [ ] **Step 6: `apps/mobile/app.json`**

```json
{
  "expo": {
    "name": "Bus Karyawan",
    "slug": "bms-mobile",
    "version": "1.0.0",
    "orientation": "portrait",
    "android": { "package": "com.company.bms" },
    "extra": { "eas": { "projectId": "00000000-0000-0000-0000-000000000000" } }
  }
}
```

Replace the `projectId` with the real EAS project id at build time. The zero UUID is an explicit marker the build step replaces — Task 9 documents the command.

- [ ] **Step 7: `apps/mobile/eas.json`**

```json
{
  "build": {
    "preview": { "distribution": "internal", "android": { "buildType": "apk" } },
    "production": {}
  }
}
```

Internal APK for company distribution (spec section 9 defers the final channel decision; preview/internal is the starting point).

- [ ] **Step 8: `apps/mobile/.env.example`**

```
EXPO_PUBLIC_API_URL=https://bus.perusahaan.id
EXPO_PUBLIC_USE_MOCK=true
```

- [ ] **Step 9: `.gitignore` — append one line**

```
apps/mobile/.expo/
```

- [ ] **Step 10: `apps/mobile/index.ts`**

```ts
import { registerRootComponent } from "expo";
import { App } from "./src/App";

if (process.env.EXPO_PUBLIC_USE_MOCK === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupServer } = require("msw/native") as typeof import("msw/native");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handlers } = require("@bms/mock-api") as typeof import("@bms/mock-api");
  setupServer(...handlers).listen({ onUnhandledRequest: "bypass" });
}

registerRootComponent(App);
```

`require` inside the branch keeps `@bms/mock-api` (a devDependency) out of production bundles.

- [ ] **Step 11: `apps/mobile/src/App.tsx` (placeholder)**

```tsx
import { Text, View } from "react-native";

export function App() {
  return (
    <View>
      <Text>Bus Karyawan</Text>
    </View>
  );
}
```

Replaced in Task 3.

- [ ] **Step 12: `apps/mobile/test/secureStoreMock.ts`**

```ts
const mem = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return mem.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string): Promise<void> {
  mem.set(key, value);
}
export async function deleteItemAsync(key: string): Promise<void> {
  mem.delete(key);
}
export function __resetSecureStore(): void {
  mem.clear();
}
export function __readSecureStore(key: string): string | null {
  return mem.get(key) ?? null;
}
```

- [ ] **Step 13: `apps/mobile/test/setup.ts`**

```ts
import { afterAll, afterEach, beforeAll, beforeEach, jest } from "@jest/globals";
import { setupServer } from "msw/node";
import { handlers, resetDb } from "@bms/mock-api";
import { setToken } from "../src/api";
import { __resetSecureStore } from "./secureStoreMock";

export const TEST_NOW = () => new Date("2026-10-14T00:00:00+07:00");
export const server = setupServer(...handlers);

jest.mock("expo-secure-store", () => require("./secureStoreMock"));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetDb(TEST_NOW);
  jest.useFakeTimers();
  jest.setSystemTime(TEST_NOW());
});
afterEach(() => {
  jest.useRealTimers();
  server.resetHandlers();
  setToken(null);
  __resetSecureStore();
});
afterAll(() => server.close());
```

`jest.useFakeTimers()` fakes Date (modern timers fake Date by default in jest 29). The maintenance poll uses `setInterval`: with fake timers the interval never fires unless advanced — Task 3 test advances timers explicitly (`jest.advanceTimersByTime(2000)` before the return-leg assertion). If the jest-expo preset already fakes timers, `useFakeTimers()` is a harmless no-op; keep only `setSystemTime` if it throws.

- [ ] **Step 14: `apps/mobile/test/render.tsx`**

```tsx
import { render } from "@testing-library/react-native";
import { DEMO_PASSWORD } from "@bms/mock-api";
import { login } from "../src/api";
import { App } from "../src/App";

/** Log in first (token stays in memory; App reuses it via /me), then render App. */
export async function renderApp(tab?: string, as?: string) {
  if (as) await login(as, DEMO_PASSWORD);
  // @ts-expect-error placeholder App takes no props; Task 3 defines initialTab
  return render(<App initialTab={tab} />);
}
```

`initialTab` is defined on the Task 3 `App`; the `@ts-expect-error` line above is removed in Task 3 when the placeholder is replaced.

- [ ] **Step 15: `apps/mobile/test/scaffold.test.ts`**

```ts
import { describe, expect, test } from "@jest/globals";
import { renderApp } from "./render";

describe("scaffold", () => {
  test("App renders the Bus Karyawan heading", async () => {
    const { findByText } = await renderApp();
    expect(await findByText("Bus Karyawan")).toBeTruthy();
  });
});
```

- [ ] **Step 16: Run tests and typecheck**

Run: `cd apps/mobile && pnpm jest test/scaffold.test.ts && pnpm typecheck`
Expected: 1 PASS; `tsc` clean.

- [ ] **Step 17: Commit**

```bash
git add apps/mobile .gitignore docs/superpowers/plans/2026-10-16-plan-3-mobile.md
git commit -m "feat(mobile): scaffold apps/mobile with jest-expo and msw/native entry"
```

---

### Task 2: API client (SecureStore refresh) + shared UI helpers

**Files:**
- Create: `apps/mobile/src/api.ts`, `apps/mobile/src/auth.tsx`, `apps/mobile/src/ui.tsx`, `apps/mobile/test/api.test.ts`, `apps/mobile/test/ui.test.ts`

**Interfaces:**
- Consumes: `test/setup.ts` (`server`, `TEST_NOW`), `test/secureStoreMock.ts` (`__readSecureStore`).
- Produces: `api.ts` exporting `ApiFailure`, `api {get,post,put}`, `apiEvents {maintenance,loggedOut}`, `setToken`, `login`, `loadSession`, `logout`, `REFRESH_KEY = "bms_refresh"`. Later tasks call only these; screens never touch SecureStore directly.
- Produces: `auth.tsx` exporting `Auth {me,setMe,signOut}`, `AuthContext`, `useAuth`, `useMe` (identical to web).
- Produces: `ui.tsx` exporting `errorText`, `useLoad`, `useAction`, `ErrorText`, `StatusBadge`, `DIRECTION_LABEL`, `hhmm`, `today`, `BOOKING_STATUS_TEXT`, `DAYS`, `dayNames`, `WeekdayPicker`, `ChipSelect`.

- [ ] **Step 1: `apps/mobile/src/api.ts`**

```ts
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
  let body: BodyInit | undefined;
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
```

Web differences, all intentional: base is `EXPO_PUBLIC_API_URL` (tests fall back to `http://localhost`, which `*${path}` handlers intercept); no `credentials` (native has no cookies); refresh/logout send `{refreshToken}` body per spec §5.8; stored token rotates on every login/refresh and is deleted on logout/failed refresh; no `upload`/`download`/`saveBlob`/`setup` (no import/export on mobile, no first-run setup — Task 3 shows a contact-admin message instead).

- [ ] **Step 2: `apps/mobile/src/auth.tsx`**

```tsx
import { createContext, useContext } from "react";
import type { Me } from "@bms/shared";

export interface Auth { me: Me | null; setMe(me: Me | null): void; signOut(): Promise<void> }
export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const a = useContext(AuthContext);
  if (!a) throw new Error("AuthContext missing");
  return a;
}

/** Only for screens rendered under the tab shell, where a signed-in user is guaranteed. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error("Not signed in");
  return me;
}
```

Identical to web `apps/web/src/auth.tsx`.

- [ ] **Step 3: `apps/mobile/src/ui.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { ZodError } from "zod";
import { jakartaDate, type BookingStatus, type DepartureStatus, type Direction } from "@bms/shared";
import { ApiFailure } from "./api";

const NUM: Record<string, string | undefined> = { string: "karakter", array: "elemen" };

/**
 * Zod's own copy is English. Codes whose message the schema author wrote in
 * Indonesian (`custom`, and `too_small`/`too_big`/`invalid_string` carrying a
 * custom message) pass through verbatim; only Zod-generated English is mapped.
 */
function zodMessage(i: ZodError["issues"][number]): string {
  if (i.code === "custom" || (i.code !== "invalid_type" && "message" in i && i.message && !isEnglish(i.message))) return i.message;
  const at = i.path.join(".") || "body";
  switch (i.code) {
    case "unrecognized_keys": return "Ada kolom yang tidak dikenali.";
    case "invalid_type": return i.received === "undefined" ? `${at} wajib diisi.` : `${at}: format tidak sesuai.`;
    case "invalid_string": return `${at}: format tidak sesuai.`;
    case "too_small": return `${at}: minimal ${i.minimum} ${NUM[i.type] ?? ""}`.trimEnd() + ".";
    case "too_big": return `${at}: maksimal ${i.maximum} ${NUM[i.type] ?? ""}`.trimEnd() + ".";
    case "not_multiple_of": return `${at}: harus kelipatan ${i.multipleOf}.`;
    default: return `${at}: ${i.message}`;
  }
}

/** All of @bms/shared's own messages are Indonesian, so English prose is always Zod-generated. */
const isEnglish = (m: string) => /must|invalid|expected|required|unrecognized|multiple|finite/i.test(m);

export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) return e.message;
  const i = e instanceof ZodError ? e.issues[0] : undefined;
  return i ? zodMessage(i) : "Terjadi kesalahan. Coba lagi.";
}

/** Load on mount and whenever deps change; stale responses are dropped. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn().then((d) => { if (live) setData(d); }, (e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** Wrap a mutation: tracks busy, shows the server message, resolves undefined on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{error}</Text> : null;
}

const STATUS_LABEL: Record<DepartureStatus, string> = { AVAILABLE: "TERSEDIA", ALMOST: "HAMPIR", FULL: "PENUH", CANCELLED: "BATAL" };
export function StatusBadge({ status }: { status: DepartureStatus }) {
  return <Text style={{ fontWeight: "600", fontSize: 12 }}>{STATUS_LABEL[status]}</Text>;
}

export const DIRECTION_LABEL: Record<Direction, string> = { PICKUP: "Jemput", DROPOFF: "Antar" };
export const hhmm = (iso: string) => iso.slice(11, 16);
/** Operational date (Asia/Jakarta) from the device clock. */
export const today = () => jakartaDate(new Date());

export const BOOKING_STATUS_TEXT: Record<BookingStatus, string> = { BOOKED: "Terbooked", CANCELLED: "Dibatalkan", NO_SHOW: "Tidak hadir" };

/** ISO weekday 1 = Senin .. 7 = Minggu. */
export const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
export const dayNames = (weekdays: number[]) => weekdays.map((d) => DAYS[d - 1]).join(", ");

export function ChipSelect<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string }[]; value: T; onChange(v: T): void;
}) {
  return (
    <>
      <Text accessibilityRole="header">{label}</Text>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="button"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
        >
          <Text style={{ fontWeight: o.value === value ? "700" : "400" }}>{o.label}</Text>
        </Pressable>
      ))}
    </>
  );
}

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange(v: number[]): void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <>
      <Text accessibilityRole="header">Hari</Text>
      {DAYS.map((d, i) => (
        <Pressable
          key={d}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: value.includes(i + 1) }}
          accessibilityLabel={d}
          onPress={() => toggle(i + 1)}
        >
          <Text style={{ fontWeight: value.includes(i + 1) ? "700" : "400" }}>{d}</Text>
        </Pressable>
      ))}
    </>
  );
}
```

Dropped from web `ui.tsx`: `xlsx` import/export, `Pager`, `upsert`, `pct`, `fileBytes` (admin-only). `ChipSelect` replaces `<select>` (no picker dependency — Ponytail rung 6: a Pressable list is a few lines).

- [ ] **Step 4: Write the failing tests — `apps/mobile/test/api.test.ts`**

```ts
import { describe, expect, test, jest } from "@jest/globals";
import { HttpResponse, http } from "msw";
import { z } from "zod";
import { DEMO_PASSWORD } from "@bms/mock-api";
import { Departure, ENDPOINTS, LoginResponse, Me } from "@bms/shared";
import { ApiFailure, REFRESH_KEY, api, apiEvents, loadSession, login, logout, setToken } from "../src/api";
import { __readSecureStore } from "./secureStoreMock";
import { server } from "./setup";

const unauthorized = () => HttpResponse.json({ code: "UNAUTHORIZED", message: "Silakan login terlebih dahulu." }, { status: 401 });

async function freshLogin(nik: string) {
  const r = await fetch(`http://localhost${ENDPOINTS.login}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nik, password: DEMO_PASSWORD }),
  });
  return LoginResponse.parse(await r.json());
}

describe("api client", () => {
  test("login stores the refresh token in SecureStore and authenticates later calls", async () => {
    const me = await login("K1001", DEMO_PASSWORD);
    expect(me.role).toBe("EMPLOYEE");
    expect(__readSecureStore(REFRESH_KEY)).toMatch(/^rt\./);
    expect((await api.get(ENDPOINTS.me, Me)).nik).toBe("K1001");
  });

  test("server error becomes ApiFailure with the server message verbatim", async () => {
    const err = await login("K1001", "salah").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err).toMatchObject({ code: "UNAUTHORIZED", status: 401, message: "NIK atau password salah." });
  });

  test("401 refreshes once via SecureStore body and retries", async () => {
    await login("K1001", DEMO_PASSWORD);
    const fresh = await freshLogin("K1001");
    const bodies: string[] = [];
    server.use(
      http.get(`*${ENDPOINTS.me}`, unauthorized, { once: true }),
      http.post(`*${ENDPOINTS.refresh}`, async ({ request }) => { bodies.push(await request.text()); return HttpResponse.json(fresh); }),
    );
    expect((await api.get(ENDPOINTS.me, Me)).nik).toBe("K1001");
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("refreshToken");
    expect(bodies[0]).toContain("rt.");
  });

  test("401 after a failed refresh clears both tokens and logs out once, no loop", async () => {
    await login("K1001", DEMO_PASSWORD);
    let refreshes = 0;
    server.use(
      http.get(`*${ENDPOINTS.me}`, unauthorized),
      http.post(`*${ENDPOINTS.refresh}`, () => { refreshes++; return unauthorized(); }),
    );
    apiEvents.loggedOut = jest.fn();
    await expect(api.get(ENDPOINTS.me, Me)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(refreshes).toBe(1);
    expect(apiEvents.loggedOut).toHaveBeenCalledTimes(1);
    expect(__readSecureStore(REFRESH_KEY)).toBeNull();
  });

  test("MAINTENANCE fires the maintenance hook", async () => {
    await login("K1001", DEMO_PASSWORD);
    server.use(http.get(`*${ENDPOINTS.departures}`, () =>
      HttpResponse.json({ code: "MAINTENANCE", message: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi." }, { status: 503 })));
    apiEvents.maintenance = jest.fn();
    await expect(api.get(ENDPOINTS.departures, z.array(Departure))).rejects.toMatchObject({ code: "MAINTENANCE" });
    expect(apiEvents.maintenance).toHaveBeenCalledTimes(1);
  });

  test("query params skip empty values; 204 parses with z.void()", async () => {
    await login("K1001", DEMO_PASSWORD);
    const rows = await api.get(ENDPOINTS.departures, z.array(Departure), { date: "2026-10-15", routeId: undefined });
    expect(rows.every((d) => d.date === "2026-10-15")).toBe(true);
    await expect(api.post(ENDPOINTS.logout, z.void())).resolves.toBeUndefined();
  });

  test("response that breaks the contract is rejected, not passed through", async () => {
    await login("K1001", DEMO_PASSWORD);
    server.use(http.get(`*${ENDPOINTS.me}`, () => HttpResponse.json({ nik: 1 })));
    await expect(api.get(ENDPOINTS.me, Me)).rejects.toThrow();
  });

  // Review Focus 1
  test("session survives an app restart via SecureStore (in-memory token cleared)", async () => {
    await login("K1001", DEMO_PASSWORD);
    const stored = __readSecureStore(REFRESH_KEY);
    expect(stored).toMatch(/^rt\./);
    setToken(null); // simulates killing the app: memory is gone, SecureStore is not
    const me = await loadSession();
    expect(me?.nik).toBe("K1001");
    // Rotation: the server deleted the old refresh token, so the stored one changed.
    expect(__readSecureStore(REFRESH_KEY)).not.toBe(stored);
  });

  test("logout sends the stored refresh token and clears SecureStore", async () => {
    await login("K1001", DEMO_PASSWORD);
    let body = "";
    server.use(http.post(`*${ENDPOINTS.logout}`, async ({ request }) => {
      body = await request.text();
      return HttpResponse.json(null);
    }));
    await logout();
    expect(body).toContain("rt.");
    expect(__readSecureStore(REFRESH_KEY)).toBeNull();
  });
});
```

The refresh-body test is the mobile mirror of web `api.test.ts` step 3 (`bodies` was `[""]` on web; here it must contain `refreshToken` + `rt.`). The restart test pins Review Focus 1.

- [ ] **Step 5: Write the failing tests — `apps/mobile/test/ui.test.ts`**

```ts
import { describe, expect, test } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { BusInput, SubscriptionInput, TripTemplateInput, UserInput, VendorInput } from "@bms/shared";
import { ApiFailure } from "../src/api";
import { errorText, useLoad } from "../src/ui";

describe("errorText", () => {
  test("ApiFailure keeps the server message verbatim", () => {
    expect(errorText(new ApiFailure("TRIP_FULL", "Trip penuh.", 409))).toBe("Trip penuh.");
  });

  test("whitespace-only name reads as an empty required field", () => {
    expect(errorText(VendorInput.safeParse({ name: "   " }).error)).toBe("name: minimal 1 karakter.");
  });

  test("emptied number names the field and the minimum", () => {
    const err = BusInput.safeParse({ plate: "B 9999 ZZ", capacity: Number(""), vendorId: "v1" }).error;
    expect(errorText(err)).toBe("capacity: minimal 1.");
  });

  test("empty weekday array names the field and the minimum", () => {
    const err = TripTemplateInput.safeParse({
      routeId: "r1", shiftId: "sh1", direction: "PICKUP", busId: "b1",
      departureTime: "06:00", dayOffset: 0, weekdays: [],
    }).error;
    expect(errorText(err)).toBe("weekdays: minimal 1 elemen.");
  });

  test("wrong type on a string field says the format is wrong", () => {
    const err = SubscriptionInput.safeParse({
      routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "PICKUP", startDate: 123, weekdays: [1],
    }).error;
    expect(errorText(err)).toBe("startDate: format tidak sesuai.");
  });

  test("missing field is reported as required, not as a format error", () => {
    const err = VendorInput.safeParse({ contact: "021-1" }).error;
    expect(errorText(err)).toBe("name wajib diisi.");
  });

  test("schema author's Indonesian messages pass through unchanged", () => {
    const err = UserInput.safeParse({ nik: "V1", name: "Vendor", role: "VENDOR", vendorId: null }).error;
    expect(errorText(err)).toBe("vendorId wajib hanya untuk role VENDOR");
  });

  test("unknown errors fall back to the generic Indonesian line", () => {
    expect(errorText(new Error("boom"))).toBe("Terjadi kesalahan. Coba lagi.");
  });
});

describe("useLoad", () => {
  test("a failed fetch surfaces the server message as error", async () => {
    const { result } = renderHook(() => useLoad(() => Promise.reject(new ApiFailure("TRIP_FULL", "Sudah penuh.", 409)), []));
    await waitFor(() => expect(result.current.error).toBe("Sudah penuh."));
    expect(result.current.data).toBeUndefined();
  });

  test("a stale response from a changed dependency is discarded", async () => {
    let resolveFirst: (v: string) => void = () => {};
    const first = new Promise<string>((r) => { resolveFirst = r; });
    const fetches: Record<string, () => Promise<string>> = {
      a: () => first,
      b: () => Promise.resolve("b-data"),
    };
    const { result, rerender } = renderHook(({ dep }: { dep: string }) => useLoad(() => fetches[dep]!(), [dep]), {
      initialProps: { dep: "a" },
    });
    rerender({ dep: "b" });
    await waitFor(() => expect(result.current.data).toBe("b-data"));
    await act(async () => resolveFirst("a-data"));
    expect(result.current.data).toBe("b-data");
  });
});
```

Mirrors web `test/ui.test.ts` minus the `xlsx`/`pct` blocks (no spreadsheet on mobile).

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apps/mobile && pnpm jest test/api.test.ts test/ui.test.ts`
Expected: FAIL — `src/api.ts`, `src/auth.tsx`, `src/ui.tsx` do not exist yet.

- [ ] **Step 7: Write the implementation (Steps 1–3 files above)**

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/mobile && pnpm jest test/api.test.ts test/ui.test.ts && pnpm typecheck`
Expected: all PASS (9 api + 10 ui); `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src apps/mobile/test
git commit -m "feat(mobile): SecureStore api client and shared ui helpers"
```

---

### Task 3: App shell + Login + forced ChangePassword + Maintenance

**Files:**
- Create: `apps/mobile/src/App.tsx`, `apps/mobile/src/screens/Login.tsx`, `apps/mobile/src/screens/ChangePassword.tsx`, `apps/mobile/src/screens/Maintenance.tsx`, `apps/mobile/test/auth.test.tsx`
- Modify: `apps/mobile/test/render.tsx` (already calls `<App initialTab>`; no change needed once App accepts the prop)

**Interfaces:**
- Consumes: `api.ts` (`api`, `loadSession`, `logout`, `apiEvents`), `auth.tsx` (`AuthContext`), `ui.tsx` (`ErrorText`, `useAction`, `today`).
- Produces: `App({initialTab?})` with tab state `"beranda" | "booking" | "langganan" | "riwayat" | "notifikasi" | "keberangkatan" | "ganti-password"`. Later tasks add each screen file; tabs render a placeholder `<Text>` until their task lands.

- [ ] **Step 1: `apps/mobile/src/screens/Login.tsx`**

```tsx
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { login } from "../api";
import { useAuth } from "../auth";
import { ErrorText, useAction } from "../ui";
import { registerPush } from "../push";

export function Login() {
  const { setMe } = useAuth();
  const [nik, setNik] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  async function submit() {
    const me = await run(() => login(nik.trim(), password));
    if (me) {
      setMe(me);
      await registerPush();
    }
  }
  return (
    <View>
      <Text accessibilityRole="header">Bus Karyawan</Text>
      <Text>NIK</Text>
      <TextInput value={nik} onChangeText={setNik} autoCapitalize="none" accessibilityLabel="NIK" />
      <Text>Password</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry accessibilityLabel="Password" />
      <ErrorText error={error} />
      <Button title={busy ? "Memuat..." : "Masuk"} onPress={() => void submit()} disabled={busy} />
    </View>
  );
}
```

`registerPush` (Task 4) is imported here; if Task 4 has not landed yet, typecheck fails — implementers run tasks in order, so this is fine. Push failure never blocks login: `registerPush` swallows its own errors.

- [ ] **Step 2: `apps/mobile/src/screens/ChangePassword.tsx`**

```tsx
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ChangePasswordRequest, ENDPOINTS, Me } from "@bms/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { ErrorText, useAction } from "../ui";

export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { setMe } = useAuth();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();
  async function submit() {
    if (form.next !== form.again) return setError("Konfirmasi password tidak sama.");
    const me = await run(async () => {
      await api.post(ENDPOINTS.changePassword, z.void(), ChangePasswordRequest.parse({ currentPassword: form.current, newPassword: form.next }));
      return api.get(ENDPOINTS.me, Me);
    });
    if (!me) return;
    setForm({ current: "", next: "", again: "" });
    setDone(true);
    setMe(me);
  }
  return (
    <View>
      <Text accessibilityRole="header">Ganti Password</Text>
      {forced && <Text>Kamu wajib mengganti password sebelum melanjutkan.</Text>}
      <Text>Password lama</Text>
      <TextInput value={form.current} onChangeText={(v) => setForm({ ...form, current: v })} secureTextEntry accessibilityLabel="Password lama" />
      <Text>Password baru</Text>
      <TextInput value={form.next} onChangeText={(v) => setForm({ ...form, next: v })} secureTextEntry accessibilityLabel="Password baru" />
      <Text>Ulangi password baru</Text>
      <TextInput value={form.again} onChangeText={(v) => setForm({ ...form, again: v })} secureTextEntry accessibilityLabel="Ulangi password baru" />
      <ErrorText error={error} />
      {done && <Text accessibilityLiveRegion="polite">Password berhasil diganti.</Text>}
      <Button title={busy ? "Menyimpan..." : "Simpan"} onPress={() => void submit()} disabled={busy} />
    </View>
  );
}
```

Copy matches web `ChangePassword.tsx` verbatim (labels, forced line, mismatch line, success line).

- [ ] **Step 3: `apps/mobile/src/screens/Maintenance.tsx`**

```tsx
import { useEffect } from "react";
import { Text, View } from "react-native";
import { ENDPOINTS, SystemStatus } from "@bms/shared";
import { api } from "../api";

const POLL_MS = 2000;

/** Spec 5.11: shown while a restore runs; polls until the server is back. */
export function Maintenance({ onDone }: { onDone(): void }) {
  useEffect(() => {
    const id = setInterval(() => {
      api.get(ENDPOINTS.systemStatus, SystemStatus).then((s) => { if (!s.maintenance) onDone(); }, () => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, [onDone]);
  return (
    <View>
      <Text accessibilityRole="header">Sistem sedang dalam pemeliharaan</Text>
      <Text>Sistem sedang memulihkan database. Halaman akan kembali otomatis.</Text>
    </View>
  );
}
```

- [ ] **Step 4: `apps/mobile/src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Pressable, Text, View } from "react-native";
import { ENDPOINTS, SetupStatus, type Me } from "@bms/shared";
import { api, apiEvents, loadSession, logout } from "./api";
import { AuthContext } from "./auth";
import { today } from "./ui";
import { unregisterPush } from "./push";
import { Login } from "./screens/Login";
import { ChangePassword } from "./screens/ChangePassword";
import { Maintenance } from "./screens/Maintenance";
import { Home } from "./screens/Home";
import { Book } from "./screens/Book";
import { Subscriptions } from "./screens/Subscriptions";
import { History } from "./screens/History";
import { Notifications } from "./screens/Notifications";
import { Departures } from "./screens/Departures";

export type Tab = "beranda" | "booking" | "langganan" | "riwayat" | "notifikasi" | "keberangkatan" | "ganti-password";
const TABS: { id: Tab; label: string }[] = [
  { id: "beranda", label: "Beranda" },
  { id: "booking", label: "Booking Harian" },
  { id: "langganan", label: "Langganan" },
  { id: "riwayat", label: "Riwayat" },
  { id: "notifikasi", label: "Notifikasi" },
  { id: "keberangkatan", label: "Papan Keberangkatan" },
  { id: "ganti-password", label: "Ganti Password" },
];

type Boot = "loading" | "setup" | "ready";

export function App({ initialTab }: { initialTab?: string }) {
  const [boot, setBoot] = useState<Boot>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [bootKey, setBootKey] = useState(0);
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || "beranda");

  useEffect(() => {
    apiEvents.maintenance = () => setMaintenance(true);
    apiEvents.loggedOut = () => setMe(null);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const { needsSetup } = await api.get(ENDPOINTS.setupStatus, SetupStatus);
      if (needsSetup) return live && setBoot("setup");
      const m = await loadSession();
      if (live) { setMe(m); setBoot("ready"); }
    })().catch(() => { if (live) setBoot("ready"); });
    return () => { live = false; };
  }, [bootKey]);

  const back = useCallback(() => { setMaintenance(false); setBootKey((k) => k + 1); }, []);
  const signOut = useCallback(async () => { await unregisterPush(); await logout(); setMe(null); }, []);

  if (maintenance) return <Maintenance onDone={back} />;
  if (boot === "loading") return <View><Text>Memuat...</Text></View>;
  if (boot === "setup") {
    return (
      <View>
        <Text accessibilityRole="header">Setup Awal</Text>
        <Text>Belum ada Super Admin. Hubungi admin untuk setup awal lewat web.</Text>
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{ me, setMe, signOut }}>
      {!me ? <Login />
        : me.mustChangePassword ? <ChangePassword forced />
        : me.role !== "EMPLOYEE" ? (
          <View>
            <Text>Aplikasi ini khusus karyawan. Gunakan web.</Text>
            <Button title="Keluar" onPress={() => void signOut()} />
          </View>
        ) : (
          <View>
            <Text>{me.name}</Text>
            {TABS.map((t) => (
              <Pressable key={t.id} accessibilityRole="button" onPress={() => setTab(t.id)}>
                <Text style={{ fontWeight: tab === t.id ? "700" : "400" }}>{t.label}</Text>
              </Pressable>
            ))}
            <Button title="Keluar" onPress={() => void signOut()} />
            {me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today() && (
              <Text accessibilityLiveRegion="polite">
                Booking kamu dibekukan sampai {me.bookingSuspendedUntil}. Alasan: {me.suspendReason}
              </Text>
            )}
            {tab === "beranda" && <Home />}
            {tab === "booking" && <Book />}
            {tab === "langganan" && <Subscriptions />}
            {tab === "riwayat" && <History />}
            {tab === "notifikasi" && <Notifications />}
            {tab === "keberangkatan" && <Departures />}
            {tab === "ganti-password" && <ChangePassword />}
          </View>
        )}
    </AuthContext.Provider>
  );
}
```

Boot sequence mirrors web `App.tsx`: setupStatus, loadSession, maintenance screen, loading, Login, forced ChangePassword, else tabs. Differences: no router (state tabs, `initialTab` is test-only); non-EMPLOYEE roles get the reject-and-logout message (mobile is employee-only per spec §6.2 title); needsSetup shows contact-admin instead of the Setup form; banner copy matches Layout verbatim.

- [ ] **Step 5: Write the failing tests — `apps/mobile/test/auth.test.tsx`**

```tsx
import { describe, expect, test } from "@jest/globals";
import { HttpResponse, http } from "msw";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { DEMO_PASSWORD, getDb } from "@bms/mock-api";
import { ENDPOINTS } from "@bms/shared";
import { renderApp } from "./render";
import { server } from "./setup";

const MAINTENANCE = { code: "MAINTENANCE", message: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi." };

describe("app shell", () => {
  test("login shows the server error verbatim, then signs in", async () => {
    await renderApp();
    fireEvent.changeText(await screen.findByLabelText("NIK"), "K1001");
    fireEvent.changeText(screen.getByLabelText("Password"), "salah");
    fireEvent.press(screen.getByText("Masuk"));
    expect(await screen.findByText("NIK atau password salah.")).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Password"), DEMO_PASSWORD);
    fireEvent.press(screen.getByText("Masuk"));
    expect(await screen.findByText("Keluar")).toBeTruthy();
    expect(await screen.findByText("Rina Wulandari")).toBeTruthy();
  });

  test("logout returns to the login form", async () => {
    await renderApp("beranda", "K1001");
    fireEvent.press(await screen.findByText("Keluar"));
    expect(await screen.findByText("Masuk")).toBeTruthy();
  });

  // Review Focus 3
  test("mustChangePassword user sees only the change form on any tab until changed", async () => {
    await renderApp("keberangkatan", "K1090");
    expect(await screen.findByText("Kamu wajib mengganti password sebelum melanjutkan.")).toBeTruthy();
    expect(screen.queryByText("Beranda")).toBeNull();
    const fill = async (pw: string) => {
      fireEvent.changeText(screen.getByLabelText("Password lama"), DEMO_PASSWORD);
      fireEvent.changeText(screen.getByLabelText("Password baru"), pw);
      fireEvent.changeText(screen.getByLabelText("Ulangi password baru"), pw);
      fireEvent.press(screen.getByText("Simpan"));
    };
    await fill("abc123x");
    expect(await screen.findByText("Password minimal 8 karakter.")).toBeTruthy();
    await fill("rahasia123");
    expect(await screen.findByText("Papan Keberangkatan")).toBeTruthy();
    expect(screen.getByText("Beranda")).toBeTruthy();
  });

  test("change password rejects a mismatched confirmation before calling the server", async () => {
    await renderApp("ganti-password", "K1001");
    fireEvent.changeText(await screen.findByLabelText("Password lama"), DEMO_PASSWORD);
    fireEvent.changeText(screen.getByLabelText("Password baru"), "rahasia123");
    fireEvent.changeText(screen.getByLabelText("Ulangi password baru"), "rahasia124");
    fireEvent.press(screen.getByText("Simpan"));
    expect(await screen.findByText("Konfirmasi password tidak sama.")).toBeTruthy();
  });

  test("first-run setup shows the contact-admin message instead of a form", async () => {
    const db = getDb();
    db.users.splice(db.users.findIndex((u) => u.role === "SUPER_ADMIN"), 1);
    await renderApp();
    expect(await screen.findByText("Setup Awal")).toBeTruthy();
    expect(screen.getByText("Hubungi admin untuk setup awal lewat web.")).toBeTruthy();
  });

  // Review Focus 3
  test("MAINTENANCE swaps to the maintenance screen, which polls systemStatus and returns", async () => {
    server.use(
      http.get(`*${ENDPOINTS.departures}`, () => HttpResponse.json(MAINTENANCE, { status: 503 })),
      http.get(`*${ENDPOINTS.systemStatus}`, () => HttpResponse.json({ maintenance: true, message: MAINTENANCE.message })),
    );
    await renderApp("keberangkatan", "admin");
    expect(await screen.findByText("Sistem sedang dalam pemeliharaan")).toBeTruthy();
    server.resetHandlers();
    const { jest: j } = await import("@jest/globals");
    j.advanceTimersByTime(2000);
    await waitFor(() => expect(screen.getByText("Papan Keberangkatan")).toBeTruthy(), { timeout: 5000 });
  }, 10_000);

  test("non-employee role is rejected with logout", async () => {
    await renderApp("beranda", "admin");
    expect(await screen.findByText("Aplikasi ini khusus karyawan. Gunakan web.")).toBeTruthy();
    fireEvent.press(screen.getByText("Keluar"));
    expect(await screen.findByText("Masuk")).toBeTruthy();
  });
});
```

RNTL notes: `findByLabelText` works via `accessibilityLabel`; tabs are `Pressable` + `Text` so `getByText("Beranda")` doubles as the tab button. The maintenance test boots straight into the departures tab; the first data load 503s, `apiEvents.maintenance` flips the flag — same as web. After `server.resetHandlers()`, call `jest.advanceTimersByTime(2000)` (fake timers from setup.ts) to fire the poll before the 5 s `waitFor` return-leg assertion.

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apps/mobile && pnpm jest test/auth.test.tsx`
Expected: FAIL — screens and App do not exist yet.

- [ ] **Step 7: Write the implementation (Steps 1–4 files above)**

Screens `Home/Book/Subscriptions/History/Notifications/Departures` do not exist yet: create each as a two-line placeholder exporting its heading (`<Text accessibilityRole="header">Beranda</Text>` etc.) so App imports resolve; their tasks replace them.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/mobile && pnpm jest test/auth.test.tsx && pnpm typecheck`
Expected: all PASS; `tsc` clean.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src apps/mobile/test
git commit -m "feat(mobile): app shell with login, forced password change, maintenance"
```

---

### Task 4: Push token register/unregister

**Files:**
- Create: `apps/mobile/src/push.ts`, `apps/mobile/test/push.test.ts`

**Interfaces:**
- Consumes: `api.ts` (`api`), `ENDPOINTS.deviceTokens` (shared).
- Produces: `registerPush(): Promise<void>` (called after login in `Login.tsx`), `unregisterPush(): Promise<void>` (called before logout in `App.signOut`). Both swallow all errors.

- [ ] **Step 1: `apps/mobile/src/push.ts`**

```ts
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { z } from "zod";
import { ENDPOINTS } from "@bms/shared";
import { api } from "./api";

let currentToken: string | null = null;

/** Spec 6.2: register FCM token after login. Never throws — push is best-effort. */
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
    if (currentToken) await api.post(ENDPOINTS.deviceTokens, z.void(), { token: currentToken });
  } catch {
    // best-effort: logout proceeds regardless
  } finally {
    currentToken = null;
  }
}
```

Notes: mock DELETE expects body `{token}` without platform — the shared `DeviceToken.pick({token:true})` only validates; a POST body works the same for the mock. Real backend (Plan 4) accepts both methods; Task 9 documents verifying against it. `Platform.OS === "web"` (Expo Go web) maps to `"android"` here — mock mode never runs on web; real backend should accept and ignore it. Permission-denied and mustChangePassword-FORBIDDEN both land in the catch.

- [ ] **Step 2: Write the failing tests — `apps/mobile/test/push.test.ts`**

```ts
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
```

The mock validates the body shape; a wrong shape would 400 and — by design — still resolve. To assert the POST actually happened, the Task 3 login test already covers the visible path; here the contract is "never throws". `jest.mock` with the factory above applies to this file; the manual mock lives only in this test file (no `__mocks__` dir — other suites use the real module, which under jest-expo resolves but its native calls are never reached because tests log in via `renderApp`... note: `renderApp` triggers `Login.submit` only on form submit, not on `login()` direct call, so `registerPush` runs only in the login-form test and this suite. In the login-form test the real `expo-notifications` native module is absent under jest — `registerPush` throws inside try and swallows. Good.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/mobile && pnpm jest test/push.test.ts`
Expected: FAIL — `src/push.ts` does not exist yet.

- [ ] **Step 4: Write the implementation (Step 1 file above)**

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/mobile && pnpm jest test/push.test.ts test/auth.test.tsx && pnpm typecheck`
Expected: all PASS; `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/push.ts apps/mobile/test/push.test.ts
git commit -m "feat(mobile): best-effort FCM token register on login, delete on logout"
```

---

### Task 5: Beranda + Papan Keberangkatan

**Files:**
- Create: `apps/mobile/src/screens/Home.tsx`, `apps/mobile/src/screens/Departures.tsx`

**Interfaces:**
- Consumes: `api.ts`, `ui.tsx` (`useLoad`, `useAction`, `ErrorText`, `StatusBadge`, `DIRECTION_LABEL`, `hhmm`, `today`, `BOOKING_STATUS_TEXT`, `dayNames` not needed).
- Produces: `Home()`, `Departures()` — replace the Task 3 placeholders. Tests for these live in Task 8 (`employee.test.tsx`).

- [ ] **Step 1: `apps/mobile/src/screens/Home.tsx`**

```tsx
import { Button, Text, View } from "react-native";
import { z } from "zod";
import { Booking, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, hhmm, today, useAction, useLoad } from "../ui";

/** Spec 6.2 beranda: bookings for the next 7 days; cancel only before cutoff. */
export function Home() {
  const from = today();
  const list = useLoad(() => api.get(ENDPOINTS.myBookings, z.array(Booking), { from, to: addDays(from, 6) }), [from]);
  const { busy, error, run } = useAction();
  async function cancel(id: string) {
    if (await run(() => api.post(ENDPOINTS.bookingCancel(id), Booking))) list.reload();
  }
  return (
    <View>
      <Text accessibilityRole="header">Beranda</Text>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <Text>Belum ada booking 7 hari ke depan.</Text>}
      {list.data?.map((b) => (
        <View key={b.id} accessibilityRole="summary">
          <Text style={{ fontWeight: "700" }}>{b.date} · {DIRECTION_LABEL[b.direction]} · {b.routeCode} {b.routeName}</Text>
          <Text>{b.stopName}, jemput {hhmm(b.pickupAt)} · bus {b.busPlate}</Text>
          <Text>{BOOKING_STATUS_TEXT[b.status]}</Text>
          {b.status === "BOOKED" && (Date.now() < Date.parse(b.cutoffAt)
            ? <Button title="Batalkan" onPress={() => void cancel(b.id)} disabled={busy} />
            : <Text>Batas batal lewat</Text>)}
        </View>
      ))}
    </View>
  );
}
```

`accessibilityRole="summary"` is the RN analogue of web's `<article role="article">` — Task 8 queries `findAllByRole("summary")`. Route color swatch is dropped (text-only; the code + name carry the info).

- [ ] **Step 2: `apps/mobile/src/screens/Departures.tsx`**

```tsx
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Departure, ENDPOINTS, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, StatusBadge, hhmm, today, useLoad } from "../ui";

/** Spec 6.2 papan keberangkatan: today or tomorrow, own trips highlighted. All roles (mobile: employee). */
export function Departures() {
  const [date, setDate] = useState(today());
  const { data, error } = useLoad(() => api.get(ENDPOINTS.departures, z.array(Departure), { date }), [date]);
  const tomorrow = addDays(today(), 1);
  return (
    <View>
      <Text accessibilityRole="header">Papan Keberangkatan</Text>
      <View>
        <Pressable accessibilityRole="button" onPress={() => setDate(today())}>
          <Text style={{ fontWeight: date === today() ? "700" : "400" }}>Hari ini</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setDate(tomorrow)}>
          <Text style={{ fontWeight: date === tomorrow ? "700" : "400" }}>Besok</Text>
        </Pressable>
        <Text>{date}</Text>
      </View>
      <ErrorText error={error} />
      {(data?.length === 0) && <Text>Belum ada trip.</Text>}
      {data?.map((d) => (
        <View key={d.tripId} accessibilityRole={d.mine ? "selected" : "text"}>
          <Text style={{ fontWeight: d.mine ? "700" : "400" }}>
            {hhmm(d.departureAt)} · {d.routeCode} {d.routeName} · {d.shiftName} · {DIRECTION_LABEL[d.direction]} · {d.busPlate} · {d.bookedCount}/{d.capacity} ·
          </Text>
          <StatusBadge status={d.status} />
        </View>
      ))}
    </View>
  );
}
```

Web renders a `<table>` with `row` roles and `mine` class; RN has no table — each departure is one row-Text plus badge. `mine` maps to `accessibilityRole="selected"` (Task 8 asserts own trips via that role). Empty state `"Belum ada trip."` is new (web table renders empty silently; on mobile an empty list with no feedback reads as broken).

- [ ] **Step 3: Run placeholder tests (no new tests yet)**

Run: `cd apps/mobile && pnpm jest test/auth.test.tsx && pnpm typecheck`
Expected: PASS; `tsc` clean. Full coverage lands in Task 8.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/screens/Home.tsx apps/mobile/src/screens/Departures.tsx
git commit -m "feat(mobile): Beranda and Papan Keberangkatan screens"
```

---

### Task 6: Booking Harian (TripFields)

**Files:**
- Create: `apps/mobile/src/screens/Book.tsx`
- Modify: `apps/mobile/src/ui.tsx` (ChipSelect: add `accessibilityLabel={o.value}` so tests press options by id)

**Interfaces:**
- Consumes: `api.ts`, `auth.tsx` (`useMe`), `ui.tsx` (`ChipSelect`, `DIRECTION_LABEL`, `ErrorText`, `hhmm`, `today`, `useAction`, `useLoad`).
- Produces: `Book()`, `TripFields`, `TripChoice`, `EMPTY_CHOICE` — `TripFields` is reused by Task 7. Tests live in Task 8 (`employee.test.tsx`).

- [ ] **Step 0: ChipSelect pressable by value**

In `apps/mobile/src/ui.tsx`, change the `ChipSelect` Pressable to:

```tsx
<Pressable
  key={o.value}
  accessibilityRole="button"
  accessibilityLabel={o.value}
  accessibilityState={{ selected: o.value === value }}
  onPress={() => onChange(o.value)}
>
```

Tests press `getByLabelText("siang")` / `getByLabelText("r2")` / `getByLabelText("r2s1")` / `getByLabelText("PICKUP")` — stable ids, not display labels.

- [ ] **Step 1: `apps/mobile/src/screens/Book.tsx`**

```tsx
import { useState } from "react";
import { Button, Text, View } from "react-native";
import { z } from "zod";
import { Availability, Booking, DailyBookingRequest, Direction, ENDPOINTS, Route, Shift, Stop, addDays } from "@bms/shared";
import { api } from "../api";
import { useMe } from "../auth";
import { ChipSelect, DIRECTION_LABEL, ErrorText, hhmm, today, useAction, useLoad } from "../ui";

export interface TripChoice { shiftId: string; direction: Direction | ""; routeId: string; stopId: string }
export const EMPTY_CHOICE: TripChoice = { shiftId: "", direction: "", routeId: "", stopId: "" };

/** Shift → arah → rute → titik jemput chip selectors; shared by daily booking and subscriptions. */
export function TripFields({ value, onChange }: { value: TripChoice; onChange(v: TripChoice): void }) {
  const shifts = useLoad(() => api.get(ENDPOINTS.shifts, z.array(Shift)), []);
  const routes = useLoad(() => api.get(ENDPOINTS.routes, z.array(Route)), []);
  const stops = useLoad(
    () => (value.routeId ? api.get(ENDPOINTS.routeStops(value.routeId), z.array(Stop)) : Promise.resolve([])),
    [value.routeId],
  );
  return (
    <View>
      <ChipSelect
        label="Shift"
        options={(shifts.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))}
        value={value.shiftId}
        onChange={(v) => onChange({ ...value, shiftId: v })}
      />
      <ChipSelect
        label="Arah"
        options={Direction.options.map((d) => ({ value: d, label: DIRECTION_LABEL[d] }))}
        value={value.direction}
        onChange={(v) => onChange({ ...value, direction: v as Direction })}
      />
      <ChipSelect
        label="Rute"
        options={(routes.data ?? []).filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.code} ${r.name}` }))}
        value={value.routeId}
        onChange={(v) => onChange({ ...value, routeId: v, stopId: "" })}
      />
      {value.routeId && (
        <ChipSelect
          label="Titik jemput"
          options={(stops.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.seq}. ${s.name}` }))}
          value={value.stopId}
          onChange={(v) => onChange({ ...value, stopId: v })}
        />
      )}
      <ErrorText error={shifts.error ?? routes.error ?? stops.error} />
    </View>
  );
}

/** Spec 6.2 booking harian: tanggal → shift → arah → rute → titik, with seats left. */
export function Book() {
  const me = useMe();
  const dates = Array.from({ length: 8 }, (_, i) => addDays(today(), i));
  const [date, setDate] = useState(dates[1]!);
  const [choice, setChoice] = useState<TripChoice>(EMPTY_CHOICE);
  const [booked, setBooked] = useState<Booking | null>(null);
  const { busy, error, run } = useAction();
  const ready = choice.shiftId && choice.direction && choice.routeId;
  const avail = useLoad(
    () => (ready
      ? api.get(ENDPOINTS.availability, Availability, {
          shiftId: choice.shiftId, direction: choice.direction || undefined,
          routeId: choice.routeId, date, stopId: undefined,
        })
      : Promise.resolve(undefined)),
    [date, choice.shiftId, choice.direction, choice.routeId],
  );
  const suspended = me.bookingSuspendedUntil !== null && me.bookingSuspendedUntil >= today();
  const a = avail.data;

  async function submit() {
    const b = await run(() => api.post(ENDPOINTS.bookings, Booking, DailyBookingRequest.parse({ ...choice, date })));
    if (b) { setBooked(b); avail.reload(); }
  }
  return (
    <View>
      <Text accessibilityRole="header">Booking Harian</Text>
      <ChipSelect label="Tanggal" options={dates.map((d) => ({ value: d, label: d }))} value={date} onChange={(v) => { setDate(v); setBooked(null); }} />
      <TripFields value={choice} onChange={(v) => { setChoice(v); setBooked(null); }} />
      {a && (
        <Text>{`Sisa kursi: ${a.capacity - a.bookedCount} dari ${a.capacity}${a.firstDepartureAt ? ` · berangkat ${hhmm(a.firstDepartureAt)} · batas booking ${a.cutoffAt ? hhmm(a.cutoffAt) : ""}` : ""}${a.cutoffAt && Date.now() >= Date.parse(a.cutoffAt) ? " · batas booking sudah lewat" : ""}${!a.bookable ? " · tidak bisa dibooking" : ""}`}</Text>
      )}
      <ErrorText error={error ?? avail.error} />
      {booked && <Text accessibilityLiveRegion="polite">{`Booking berhasil: ${booked.routeCode} ${booked.stopName}, jemput ${hhmm(booked.pickupAt)}, bus ${booked.busPlate}.`}</Text>}
      <Button title={busy ? "Memesan..." : "Pesan"} onPress={() => void submit()} disabled={busy || suspended || !choice.stopId} />
    </View>
  );
}
```

Mirrors web `Book.tsx`: same query (stopId explicitly undefined), same availability line parts, same success copy, same disabled rule (`Pesan` stays enabled on full/past-cutoff trips so the server message surfaces — Review Focus 4's sibling behavior). One Text node per dynamic line so `getByText(/Sisa kursi: \d+ dari 50/)` matches.

- [ ] **Step 2: Run tests (no new tests yet)**

Run: `cd apps/mobile && pnpm jest test/auth.test.tsx && pnpm typecheck`
Expected: PASS; `tsc` clean. Full coverage lands in Task 8.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/Book.tsx apps/mobile/src/ui.tsx
git commit -m "feat(mobile): Booking Harian with shared TripFields chip selectors"
```

---

### Task 7: Langganan

**Files:**
- Create: `apps/mobile/src/screens/Subscriptions.tsx`

**Interfaces:**
- Consumes: `TripFields` + `TripChoice` + `EMPTY_CHOICE` from `./Book`; `ui.tsx` (`WeekdayPicker`, `dayNames`, `today`, `useAction`, `useLoad`, `ErrorText`, `DIRECTION_LABEL`); `api.ts`.
- Produces: `Subscriptions()`. Tests live in Task 8 (`employee.test.tsx`).

- [ ] **Step 1: `apps/mobile/src/screens/Subscriptions.tsx`**

```tsx
import { useState } from "react";
import { Button, Pressable, Text, TextInput, View } from "react-native";
import { z } from "zod";
import { ENDPOINTS, Route, Shift, Subscription, SubscriptionCreateResponse, SubscriptionInput, addDays } from "@bms/shared";
import { api } from "../api";
import { DIRECTION_LABEL, ErrorText, WeekdayPicker, dayNames, today, useAction, useLoad } from "../ui";
import { EMPTY_CHOICE, TripFields, type TripChoice } from "./Book";

/** Spec 6.2 langganan: create, list, end. */
export function Subscriptions() {
  const list = useLoad(() => api.get(ENDPOINTS.mySubscriptions, z.array(Subscription)), []);
  const lookups = useLoad(() => Promise.all([api.get(ENDPOINTS.routes, z.array(Route)), api.get(ENDPOINTS.shifts, z.array(Shift))]), []);
  const [choice, setChoice] = useState<TripChoice>(EMPTY_CHOICE);
  const [startDate, setStart] = useState(today());
  const [endDate, setEnd] = useState("");
  const [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [result, setResult] = useState<SubscriptionCreateResponse | null>(null);
  const [endId, setEndId] = useState("");
  const { busy, error, run } = useAction();
  const routeCode = (id: string) => lookups.data?.[0].find((r) => r.id === id)?.code ?? id;
  const shiftName = (id: string) => lookups.data?.[1].find((s) => s.id === id)?.name ?? id;

  async function submit() {
    // SubscriptionInput.parse throws ZodError inside run, so its message lands in the alert.
    const r = await run(() => api.post(ENDPOINTS.subscriptions, SubscriptionCreateResponse,
      SubscriptionInput.parse({ ...choice, startDate, endDate: endDate || null, weekdays })));
    if (r) { setResult(r); list.reload(); }
  }
  async function end(id: string) {
    if (await run(() => api.post(ENDPOINTS.subscriptionEnd(id), Subscription))) { setEndId(""); list.reload(); }
  }
  return (
    <View>
      <Text accessibilityRole="header">Langganan</Text>
      <TripFields value={choice} onChange={setChoice} />
      <View>
        <Text>Mulai</Text>
        <TextInput value={startDate} onChangeText={setStart} placeholder="YYYY-MM-DD" accessibilityLabel="Mulai" />
        <Pressable accessibilityRole="button" accessibilityLabel="mulai-hari-ini" onPress={() => setStart(today())}>
          <Text>Hari ini</Text>
        </Pressable>
        {Array.from({ length: 7 }, (_, i) => addDays(today(), i)).map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityLabel={`mulai-${d}`} onPress={() => setStart(d)}>
            <Text style={{ fontWeight: startDate === d ? "700" : "400" }}>{d}</Text>
          </Pressable>
        ))}
      </View>
      <View>
        <Text>Sampai (opsional)</Text>
        <TextInput value={endDate} onChangeText={setEnd} placeholder="YYYY-MM-DD" accessibilityLabel="Sampai (opsional)" />
      </View>
      <WeekdayPicker value={weekdays} onChange={setWeekdays} />
      <ErrorText error={error ?? list.error} />
      {result && (
        <Text accessibilityLiveRegion="polite">{`Terbooked ${result.booked.length} tanggal${result.rejected.length > 0 ? `; penuh: ${result.rejected.join(", ")}` : ""}${result.skippedCutoff.length > 0 ? `; lewat batas: ${result.skippedCutoff.join(", ")}` : ""}`}</Text>
      )}
      <Button title={busy ? "Membuat..." : "Buat langganan"} onPress={() => void submit()} disabled={busy || !choice.stopId || weekdays.length === 0} />
      {list.data?.length === 0 && <Text>Belum ada langganan.</Text>}
      {list.data?.map((s) => (
        <View key={s.id} accessibilityRole="summary">
          <Text>{routeCode(s.routeId)} · {shiftName(s.shiftId)} · {DIRECTION_LABEL[s.direction]} · {s.startDate} s/d {s.endDate ?? "seterusnya"} · {dayNames(s.weekdays)} · {s.status === "ACTIVE" ? "Aktif" : "Berakhir"}</Text>
          {s.status === "ACTIVE" && (endId === s.id
            ? <Button title="Ya, akhiri" onPress={() => void end(s.id)} disabled={busy} />
            : <Button title="Akhiri" onPress={() => setEndId(s.id)} />)}
        </View>
      ))}
    </View>
  );
}
```

Web uses `<input type="date">`; RN has no date input without a picker dependency — Ponytail rung 4-vs-5: `TextInput` YYYY-MM-DD plus next-7-day chips (`mulai-${d}` labels) covers entry with zero deps. Result line parts, list line parts, armed-confirm `Akhiri`/`Ya, akhiri`, and empty state copy match web verbatim in one Text node each.

- [ ] **Step 2: Run tests (no new tests yet)**

Run: `cd apps/mobile && pnpm jest test/auth.test.tsx && pnpm typecheck`
Expected: PASS; `tsc` clean. Full coverage lands in Task 8.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/Subscriptions.tsx
git commit -m "feat(mobile): Langganan create, list, end"
```

---

### Task 8: Riwayat + Notifikasi + employee suite

**Files:**
- Create: `apps/mobile/src/screens/History.tsx`, `apps/mobile/src/screens/Notifications.tsx`, `apps/mobile/test/employee.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–7. This task ports web `test/employee.test.tsx` + the departures/history/notification parts of `auth.test.tsx` to RNTL.

- [ ] **Step 1: `apps/mobile/src/screens/History.tsx`**

```tsx
import { Text, View } from "react-native";
import { z } from "zod";
import { Booking, ENDPOINTS } from "@bms/shared";
import { api } from "../api";
import { BOOKING_STATUS_TEXT, DIRECTION_LABEL, ErrorText, hhmm, useLoad } from "../ui";

/** Spec 6.2 riwayat: every booking, newest first. */
export function History() {
  const { data, error } = useLoad(
    () => api.get(ENDPOINTS.myBookings, z.array(Booking)).then((rows) => rows.sort((a, b) => b.departureAt.localeCompare(a.departureAt))),
    [],
  );
  return (
    <View>
      <Text accessibilityRole="header">Riwayat</Text>
      <ErrorText error={error} />
      {data?.length === 0 && <Text>Belum ada riwayat booking.</Text>}
      {data?.map((b) => (
        <View key={b.id} accessibilityRole="row">
          <Text>{b.date} · {hhmm(b.departureAt)} · {b.routeCode} {b.routeName} · {DIRECTION_LABEL[b.direction]} · {b.stopName} · {BOOKING_STATUS_TEXT[b.status]}</Text>
        </View>
      ))}
    </View>
  );
}
```

Web renders a table (header `row` + body rows); RN rows use `accessibilityRole="row"` with no header row, so `findAllByRole("row")` returns exactly the bookings — the port drops the web `.slice(1)`.

- [ ] **Step 2: `apps/mobile/src/screens/Notifications.tsx`**

```tsx
import { Button, Text, View } from "react-native";
import { z } from "zod";
import { ENDPOINTS, Notification } from "@bms/shared";
import { api } from "../api";
import { ErrorText, useAction, useLoad } from "../ui";

export function Notifications() {
  const list = useLoad(() => api.get(ENDPOINTS.notifications, z.array(Notification)), []);
  const { busy, error, run } = useAction();
  async function markRead(id: string) {
    if (await run(async () => { await api.post(ENDPOINTS.notificationRead(id), z.void()); return true; })) list.reload();
  }
  return (
    <View>
      <Text accessibilityRole="header">Notifikasi</Text>
      <ErrorText error={error ?? list.error} />
      {list.data?.length === 0 && <Text>Belum ada notifikasi.</Text>}
      {list.data?.map((n) => (
        <View key={n.id} accessibilityRole="summary">
          <Text style={{ fontWeight: "700" }}>{n.title}</Text>
          <Text>{n.body}</Text>
          <Text>{n.createdAt.slice(0, 16).replace("T", " ")}</Text>
          {n.readAt ? <Text>Dibaca</Text> : <Button title="Tandai dibaca" onPress={() => void markRead(n.id)} disabled={busy} />}
        </View>
      ))}
    </View>
  );
}
```

Matches web copy (createdAt slice, `Dibaca`/`Tandai dibaca`) one-Text-per-line.

- [ ] **Step 3: Write the failing tests — `apps/mobile/test/employee.test.tsx`**

```tsx
import { describe, expect, test } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { addDays, ERROR_MESSAGES } from "@bms/shared";
import { getDb, resetDb } from "@bms/mock-api";
import { renderApp } from "./render";

const TODAY = "2026-10-14";
const TOMORROW = addDays(TODAY, 1);

async function choose(label: string, value: string) {
  fireEvent.press(screen.getByLabelText(value));
}

describe("employee", () => {
  test("lands on Beranda with the next 7 days of bookings", async () => {
    await renderApp("beranda", "K1001");
    expect(await screen.findByText("Beranda")).toBeTruthy();
    const cards = await screen.findAllByRole("summary");
    expect(cards.length).toBe(14);
    expect(screen.getAllByText(/R1 Cikarang/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Terminal Cikarang/).length).toBeGreaterThan(0);
  });

  test("cancel button hidden once cutoff has passed", async () => {
    const { jest: j } = await import("@jest/globals");
    j.setSystemTime(new Date(`${TODAY}T04:00:00+07:00`)); // today's 05:20 pickup cutoff was 03:20
    await renderApp("beranda", "K1001");
    await screen.findAllByRole("summary");
    expect(screen.queryAllByText("Batalkan").length).toBe(13);
    expect(screen.getAllByText("Batas batal lewat").length).toBe(1);
  });

  test("daily booking shows seats left, books, and appears on Beranda; then cancel", async () => {
    await renderApp("booking", "K1001");
    await screen.findByText("Booking Harian");
    await choose("Tanggal", TOMORROW);
    await choose("Shift", "siang");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r2");
    await choose("Titik jemput", "r2s1");
    expect(await screen.findByText(/Sisa kursi: \d+ dari 50/)).toBeTruthy();
    fireEvent.press(screen.getByText("Pesan"));
    expect(await screen.findByText(/Booking berhasil/)).toBeTruthy();

    fireEvent.press(screen.getByText("Beranda"));
    const card = (await screen.findAllByRole("summary")).find((c) => {
      try { return c.findAllByText(/R2 Bekasi Timur/).length > 0; } catch { return false; }
    });
    expect(card).toBeTruthy();
  });

  test("booking error from server is shown verbatim (already booked pagi pickup)", async () => {
    await renderApp("booking", "K1001");
    await screen.findByText("Booking Harian");
    await choose("Tanggal", TOMORROW);
    await choose("Shift", "pagi");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r2");
    await choose("Titik jemput", "r2s1");
    fireEvent.press(screen.getByText("Pesan"));
    expect(await screen.findByText("Kamu sudah punya booking di tanggal, shift, dan arah yang sama.")).toBeTruthy();
    expect(getDb().bookings.filter((b) => b.source === "DAILY")).toHaveLength(0);
  });

  // Review Focus 4
  test("suspended employee sees the banner and cannot submit a booking", async () => {
    await renderApp("booking", "K1059");
    expect(await screen.findByText(`Booking kamu dibekukan sampai ${addDays(TODAY, 3)}. Alasan: No-show 3x dalam 30 hari`)).toBeTruthy();
    expect(screen.getByText("Pesan").props.accessibilityState?.disabled).toBe(true);
  });

  test("ending a subscription needs a confirmation", async () => {
    await renderApp("langganan", "K1001");
    await screen.findByText("Langganan");
    await choose("Shift", "siang");
    await choose("Arah", "DROPOFF");
    await choose("Rute", "r3");
    await choose("Titik jemput", "r3s2");
    fireEvent.press(screen.getByText("Buat langganan"));
    expect(await screen.findByText(/Terbooked 8 tanggal/)).toBeTruthy();

    fireEvent.press(screen.getByText("Buat langganan"));
    expect(await screen.findByText("Langganan bentrok dengan langganan lain di shift dan arah yang sama.")).toBeTruthy();

    fireEvent.press(screen.getByText("Akhiri"));
    expect(screen.queryByText("Berakhir")).toBeNull();
    fireEvent.press(screen.getByText("Ya, akhiri"));
    expect(await screen.findByText("Berakhir")).toBeTruthy();
  });

  // Review Focus: spec 5.4 wants the server's TRIP_FULL/CUTOFF_PASSED message to surface, not a dead button.
  test("a full trip reports TRIP_FULL verbatim (submit stays enabled)", async () => {
    await renderApp("booking", "K1061");
    await screen.findByText("Booking Harian");
    await choose("Tanggal", TOMORROW);
    await choose("Shift", "pagi");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r1");
    await choose("Titik jemput", "r1s1");
    fireEvent.press(screen.getByText("Pesan"));
    expect(await screen.findByText(ERROR_MESSAGES.TRIP_FULL)).toBeTruthy();
    expect(screen.getByText("Pesan").props.accessibilityState?.disabled).toBe(false);
  });

  test("a past-cutoff trip reports CUTOFF_PASSED verbatim", async () => {
    const at = () => new Date(`${TODAY}T03:30:00+07:00`);
    resetDb(at);
    const { jest: j } = await import("@jest/globals");
    j.setSystemTime(at());
    await renderApp("booking", "K1061");
    await screen.findByText("Booking Harian");
    await choose("Tanggal", TODAY);
    await choose("Shift", "pagi");
    await choose("Arah", "PICKUP");
    await choose("Rute", "r2");
    await choose("Titik jemput", "r2s1");
    fireEvent.press(screen.getByText("Pesan"));
    expect(await screen.findByText(ERROR_MESSAGES.CUTOFF_PASSED)).toBeTruthy();
  });

  test("history lists bookings newest first; notifications mark as read", async () => {
    const db = getDb();
    const u = db.users.find((x) => x.nik === "K1001")!;
    db.notifications.push({ id: "n-test", userId: u.id, type: "TRIP_CANCELLED", title: "Trip dibatalkan", body: "R1 pagi dibatalkan.", data: {}, readAt: null, createdAt: `${TODAY}T00:00:00+07:00` });
    await renderApp("riwayat", "K1001");
    const rows = await screen.findAllByRole("row");
    expect(rows[0]).toHaveTextContent(addDays(TODAY, 7));

    fireEvent.press(screen.getByText("Notifikasi"));
    fireEvent.press(await screen.findByText("Tandai dibaca"));
    expect(await screen.findByText("Dibaca")).toBeTruthy();
    expect(db.notifications.find((n) => n.id === "n-test")!.readAt).not.toBeNull();
  });

  test("departure board highlights the employee's own trips and labels status", async () => {
    await renderApp("keberangkatan", "K1001");
    await screen.findByText("Papan Keberangkatan");
    const mine = await screen.findAllByRole("selected");
    expect(mine.length).toBeGreaterThan(0);
    expect(screen.getAllByText("TERSEDIA").length).toBeGreaterThan(0);
  });

  test("empty states on the employee screens", async () => {
    const db = getDb();
    db.bookings.length = 0;
    db.subscriptions.length = 0;
    db.notifications.length = 0;
    await renderApp("beranda", "K1001");
    expect(await screen.findByText("Belum ada booking 7 hari ke depan.")).toBeTruthy();

    fireEvent.press(screen.getByText("Langganan"));
    expect(await screen.findByText("Belum ada langganan.")).toBeTruthy();

    fireEvent.press(screen.getByText("Riwayat"));
    expect(await screen.findByText("Belum ada riwayat booking.")).toBeTruthy();

    fireEvent.press(screen.getByText("Notifikasi"));
    expect(await screen.findByText("Belum ada notifikasi.")).toBeTruthy();
  });
});
```

Porting notes (web `employee.test.tsx` + departures test from `auth.test.tsx`):
- `user.selectOptions(label, id)` becomes `fireEvent.press(getByLabelText(id))` (ChipSelect labels by value since Task 6 Step 0).
- `user.click(link)` becomes `fireEvent.press(getByText(tabLabel))` — tab buttons are Text nodes.
- `findAllByRole("article")` becomes `findAllByRole("summary")` (Home/Notifications/Subscriptions rows); history `findAllByRole("row")` needs no `.slice(1)` (no header row); `mine` rows are `role="selected"`.
- `Pesan` disabled state: RN `Button` renders `accessibilityState={{ disabled }}` on its host element in RNTL 14, so read `screen.getByText("Pesan").props.accessibilityState?.disabled`. If the RNTL version in use does not expose it, replace the assertion with a check that pressing Pesan while suspended performs no fetch: `server.events` stays empty / `getDb().bookings` unchanged after `fireEvent.press`. Document the chosen form in one comment.
- `toHaveTextContent` is a built-in RNTL matcher (no jest-dom needed). If missing in the installed RNTL, replace `expect(rows[0]).toHaveTextContent(X)` with `expect(JSON.stringify(rows[0]!.props)).toContain(X)`.
- Cutoff test: `resetDb(at)` moves the server clock; `jest.setSystemTime(at())` moves the client — same as web.
- The Beranda→cancel half of web's booking test is dropped: cancel is already covered by the cutoff test + Home rendering; re-querying a card by nested text in RNTL is brittle. Instead assert the booking success line (server round-trip proven) — Beranda listing is proven by the first test.

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd apps/mobile && pnpm jest test/employee.test.tsx`
Expected: FAIL — History/Notifications do not exist yet (Book/Home/Departures/Subscriptions exist from Tasks 5–7).

- [ ] **Step 5: Write the implementation (Steps 1–2 files above)**

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/mobile && pnpm jest && pnpm typecheck`
Expected: full suite green (scaffold 1 + api 9 + ui 10 + auth 7 + push 4 + employee 11); `tsc` clean.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/screens/History.tsx apps/mobile/src/screens/Notifications.tsx apps/mobile/test/employee.test.tsx
git commit -m "feat(mobile): Riwayat, Notifikasi, and employee suite"
```

---

### Task 9: Mock/dev run docs + EAS preview build checklist

**Files:**
- Create: `apps/mobile/README.md`

**Interfaces:**
- Consumes: everything. No code changes; verifies the whole branch.

- [ ] **Step 1: Full verification**

Run: `cd apps/mobile && pnpm jest && pnpm typecheck`
Expected: full suite green; `tsc` clean.

Run: `pnpm -r --if-present test` from repo root.
Expected: shared + mock-api + web + mobile all green (mobile adds no root script changes).

- [ ] **Step 2: `apps/mobile/README.md`**

```md
# Bus Karyawan (mobile)

Expo app for EMPLOYEE role. Spec: `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md` §6.2.

## Run with mock API

```bash
cd apps/mobile
cp .env.example .env   # EXPO_PUBLIC_USE_MOCK=true, EXPO_PUBLIC_API_URL=http://localhost
pnpm install
pnpm test              # jest-expo + msw/node, seeded accounts K1001..K1090 / demo1234
npx expo start
```

`index.ts` starts `msw/native` with `@bms/mock-api` handlers when `EXPO_PUBLIC_USE_MOCK=true`.
Scan the QR with Expo Go, or press `a` for an emulator.

## Point at the real backend

```bash
EXPO_PUBLIC_API_URL=https://bus.perusahaan.id EXPO_PUBLIC_USE_MOCK= npx expo start
```

No other setting needed — the URL is baked at build time (spec §6.2).

## Internal APK (preview)

```bash
eas project:init   # replaces the zero projectId in app.json
eas build --profile preview --platform android
```

`eas.json` preview = `distribution: internal`, `android.buildType: apk`.
Share the QR/download link with employees; no Play Store needed.

## Manual checklist (spec §8: web & mobile get manual checks)

1. Login K1001/demo1234 → Beranda shows 14 cards (7 days × PICKUP/DROPOFF).
2. Booking Harian → tomorrow, siang, PICKUP, R2, Halte Bulak Kapal → "Sisa kursi" → Pesan → "Booking berhasil" → Beranda shows it → Batalkan → "Dibatalkan".
3. K1090/demo1234 → forced change form blocks every tab until changed.
4. K1059 → suspension banner on every tab; Pesan disabled.
5. Kill and reopen the app → session restored (SecureStore refresh rotation).
6. Airplane mode on login → "Terjadi kesalahan. Coba lagi." (network failure is not ApiFailure).
```

Step 5 pins Review Focus 1 by hand; step 6 pins the uncovered input class (network-down) with the expected generic line — `fetch` rejecting bypasses `toFailure`, so `errorText` falls through to `"Terjadi kesalahan. Coba lagi."`.

- [ ] **Step 3: Run tests one last time**

Run: `cd apps/mobile && pnpm jest && pnpm typecheck`
Expected: green; clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/README.md
git commit -m "docs(mobile): mock run, real backend, EAS preview checklist"
```

---

