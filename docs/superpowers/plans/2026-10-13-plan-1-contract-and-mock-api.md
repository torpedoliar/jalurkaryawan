# Plan 1: Shared API Contract + Mock API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pnpm monorepo, the `@bms/shared` package (Zod schemas, enums, error codes, settings schema, time helpers, endpoint list), and the `@bms/mock-api` package (MSW handlers + in-memory DB) that emulates the spec's business rules so the web and mobile frontends can be built before the backend.

**Architecture:** `packages/shared` is the single source of truth for the API contract; frontends and (later) the NestJS backend import it. `packages/mock-api` holds an in-memory store, a seed generator, pure domain functions (seat allocation, cutoff, conflict, suspend), and MSW `http` handlers that call those functions. Domain functions are tested with Vitest directly; handlers are tested end-to-end with `msw/node` + `fetch`.

**Tech Stack:** Node 25, pnpm 10 workspaces, TypeScript 5.6, Zod 3.23, MSW 2.6, Vitest 2.1.

**Spec:** `docs/superpowers/specs/2026-10-13-bus-booking-subproject-a-design.md`

**Follow-up plans:** Plan 2 (web app), Plan 3 (mobile app), Plan 4+ (backend, integration, deploy).

## Global Constraints

- Business timezone: `Asia/Jakarta` (UTC+7, no DST). All instants are ISO-8601 strings with offset; operational dates are `YYYY-MM-DD`.
- Roles: `SUPER_ADMIN`, `ADMIN_GA`, `EMPLOYEE`, `VENDOR`.
- Direction: `PICKUP`, `DROPOFF`. Trip status: `SCHEDULED`, `CANCELLED`. Booking status: `BOOKED`, `CANCELLED`, `NO_SHOW`. Booking source: `SUBSCRIPTION`, `DAILY`. Subscription status: `ACTIVE`, `ENDED`.
- Cancel reasons: `USER`, `ADMIN_TRIP`, `SUSPENDED`, `SUBSCRIPTION_ENDED`, `USER_DEACTIVATED`.
- Error body is exactly `{ "code": string, "message": string }`, Indonesian message. Codes: `TRIP_FULL`, `CUTOFF_PASSED`, `SCHEDULE_CONFLICT`, `USER_SUSPENDED`, `CAPACITY_BELOW_BOOKED`, `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `ACCOUNT_LOCKED`, `MAINTENANCE`, `NOT_FOUND`.
- All API paths are prefixed `/api`.
- Settings defaults and bounds exactly as spec 5.12.
- Secret settings are never returned by the API; return `{ isSet: boolean }` instead.
- Mock rules only emulate behavior written in the spec; no invented features.

## Review Focus

1. Concurrent last-seat booking: two simultaneous bookings for one remaining seat → exactly one `BOOKED`, one `TRIP_FULL` + one `rejected_requests` row. (Task 5)
2. All trips of a combo past cutoff but seats free → `CUTOFF_PASSED`, no rejected row. (Task 5)
3. Night shift drop-off crossing midnight (`day_offset = 1`) → `departureAt` is next calendar day, cutoff computed from that instant. (Task 3)
4. Suspended user booking → `USER_SUSPENDED`; existing future bookings cancelled with reason `SUSPENDED`. (Task 6)
5. Settings PUT with secret value → response never echoes the secret; out-of-range number → `VALIDATION_ERROR`; audit log shows `***`. (Task 4, Task 9)

---

## File Structure

```
package.json                     root scripts, pnpm workspace
pnpm-workspace.yaml
tsconfig.base.json
.gitignore
packages/shared/
  package.json
  src/index.ts                   re-exports
  src/enums.ts                   enum schemas
  src/errors.ts                  ErrorCode, ApiError schema, messages
  src/time.ts                    Jakarta time helpers
  src/settings.ts                settings schema, defaults, secret keys
  src/schemas/common.ts          Id, dates, HexColor, Paginated
  src/schemas/auth.ts
  src/schemas/master.ts          vendor, bus, shift, route, stop, user, import
  src/schemas/trips.ts           template, trip, passenger, departure
  src/schemas/bookings.ts        booking, subscription, rejected request
  src/schemas/reports.ts         occupancy, notifications, audit, backup
  src/endpoints.ts               endpoint path constants
  test/smoke.test.ts
  test/schemas.test.ts
  test/time.test.ts
  test/settings.test.ts
packages/mock-api/
  package.json
  src/index.ts                   exports handlers, getDb, resetDb, createSeededDb, DEMO_PASSWORD
  src/db.ts                      in-memory store types, ids, audit, notify
  src/state.ts                   current db + resetDb
  src/seed.ts                    deterministic seed
  src/domain/allocate.ts         seat allocation, cancel
  src/domain/generate.ts         trip + subscription generation
  src/domain/admin.ts            suspend, change bus, cancel trip, deactivate
  src/auth.ts                    mock token, lockout, role guard
  src/http.ts                    json/error helpers, maintenance gate
  src/handlers/util.ts           path helper, mappers, pagination
  src/handlers/{auth,master,users,trips,bookings,reports,system}.ts
  test/fixture.ts
  test/auth.test.ts
  test/seed.test.ts
  test/allocate.test.ts
  test/generate.test.ts
  test/admin.test.ts
  test/handlers.test.ts
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`
- Create: `packages/shared/{package.json,tsconfig.json,src/index.ts}`
- Create: `packages/mock-api/{package.json,tsconfig.json,src/index.ts}`
- Test: `packages/shared/test/smoke.test.ts`

**Interfaces:**
- Produces: workspace packages `@bms/shared` and `@bms/mock-api`, consumed as TypeScript source (`"main": "src/index.ts"`, no build step). Root scripts `pnpm test`, `pnpm typecheck`.

- [ ] **Step 1: Write root files**

`package.json`:
```json
{
  "name": "bus-management-system",
  "private": true,
  "packageManager": "pnpm@10.33.2",
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2023", "DOM"]
  }
}
```

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
*.log
```

`.npmrc`:
```
auto-install-peers=true
```

- [ ] **Step 2: Write package files**

`packages/shared/package.json`:
```json
{
  "name": "@bms/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "zod": "3.23.8" }
}
```

`packages/mock-api/package.json`:
```json
{
  "name": "@bms/mock-api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "@bms/shared": "workspace:*", "msw": "2.6.8", "zod": "3.23.8" }
}
```

Both `tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/shared/src/index.ts`:
```ts
export const CONTRACT_VERSION = 1;
```

`packages/mock-api/src/index.ts`:
```ts
export {};
```

- [ ] **Step 3: Write smoke test**

`packages/shared/test/smoke.test.ts`:
```ts
import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "../src/index";

test("shared package loads", () => {
  expect(CONTRACT_VERSION).toBe(1);
});
```

- [ ] **Step 4: Install and run**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: install OK, 1 test PASS, typecheck exit 0.

`@bms/mock-api` has no test file yet, and `vitest run` exits 1 when it finds none, which would fail the root `pnpm test`. Add `packages/mock-api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

// ponytail: this package has no tests until Task 5; drop this file once test/ exists.
export default defineConfig({ test: { passWithNoTests: true } });
```
Delete this file in Task 5, when `test/fixture.ts` lands.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: pnpm monorepo with shared and mock-api packages"
```

### Task 2: Enums, error codes, contract schemas, endpoints

**Files:**
- Create: `packages/shared/src/enums.ts`, `src/errors.ts`, `src/endpoints.ts`
- Create: `packages/shared/src/schemas/{common,auth,master,trips,bookings,reports}.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/schemas.test.ts`

**Interfaces:**
- Produces (all exported from `@bms/shared`; every schema `X` also exports `type X = z.infer<typeof X>`):
  - Enums: `Role`, `Direction`, `TripStatus`, `BookingStatus`, `BookingSource`, `SubscriptionStatus`, `CancelReason`, `AuthProvider`, `DepartureStatus` (`AVAILABLE|ALMOST|FULL|CANCELLED`), constant `ADMIN_ROLES`.
  - Errors: `ErrorCode`, `ApiError`, `ERROR_MESSAGES`, `ERROR_HTTP_STATUS`.
  - Common: `Id`, `IsoDate`, `HhMm`, `IsoDateTime`, `HexColor`, `Weekdays`, `Paginated(item)`.
  - Auth: `LoginRequest`, `LoginResponse`, `RefreshResponse`, `ChangePasswordRequest`, `Me`, `SetupStatus`, `SetupRequest`.
  - Master: `Vendor(Input)`, `Bus(Input)`, `Shift(Input)`, `Route(Input)`, `Stop(Input)`, `UserSummary`, `UserInput`, `TempPassword`, `ImportRow`, `ImportPreview`, `ImportCommitResponse`, `SuspendRequest`.
  - Trips: `TripTemplate(Input)`, `Trip`, `ChangeBusRequest`, `CancelDateRequest`, `Passenger`, `Departure`, `Availability`.
  - Bookings: `DailyBookingRequest`, `Booking`, `SubscriptionInput`, `Subscription`, `SubscriptionCreateResponse`, `RejectedRequest`.
  - Reports: `OccupancyRow`, `DashboardSummary`, `NoShowCandidate`, `Notification`, `AuditLog`, `BackupFile`, `RestoreRequest`, `SystemStatus`.
  - `ENDPOINTS`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/schemas.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import {
  ApiError, DailyBookingRequest, Departure, ENDPOINTS, ERROR_HTTP_STATUS, ERROR_MESSAGES,
  ErrorCode, LoginRequest, RestoreRequest, RouteInput, SubscriptionInput, UserInput,
} from "../src/index";

describe("contract", () => {
  test("every error code has a message and HTTP status", () => {
    for (const code of ErrorCode.options) {
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(5);
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(ERROR_HTTP_STATUS.MAINTENANCE).toBe(503);
    expect(ApiError.parse({ code: "TRIP_FULL", message: "x" }).code).toBe("TRIP_FULL");
  });

  test("route color must be #RRGGBB", () => {
    expect(RouteInput.safeParse({ code: "R1", name: "Cikarang", color: "#D6322B" }).success).toBe(true);
    expect(RouteInput.safeParse({ code: "R1", name: "Cikarang", color: "red" }).success).toBe(false);
  });

  test("daily booking date is YYYY-MM-DD", () => {
    const base = { routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "PICKUP" };
    expect(DailyBookingRequest.safeParse({ ...base, date: "2026-10-14" }).success).toBe(true);
    expect(DailyBookingRequest.safeParse({ ...base, date: "14/10/2026" }).success).toBe(false);
  });

  test("subscription weekdays 1..7 non-empty, end >= start", () => {
    const base = { routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "DROPOFF", startDate: "2026-10-14" };
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [1, 2, 3] }).success).toBe(true);
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [] }).success).toBe(false);
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [8] }).success).toBe(false);
    expect(SubscriptionInput.safeParse({ ...base, weekdays: [1], endDate: "2026-10-01" }).success).toBe(false);
  });

  test("vendor role requires vendorId, other roles forbid it", () => {
    const u = { nik: "V1", name: "Vendor", role: "VENDOR" };
    expect(UserInput.safeParse({ ...u, vendorId: "v1" }).success).toBe(true);
    expect(UserInput.safeParse(u).success).toBe(false);
    expect(UserInput.safeParse({ ...u, role: "ADMIN_GA", vendorId: "v1" }).success).toBe(false);
  });

  test("departure board row carries no passenger data", () => {
    const keys = Object.keys(Departure.shape);
    expect(keys).not.toContain("passengers");
    expect(keys).not.toContain("name");
  });

  test("restore requires typed RESTORE", () => {
    expect(RestoreRequest.safeParse({ fileName: "a.dump", password: "p", confirm: "restore" }).success).toBe(false);
  });

  test("login requires nik", () => {
    expect(LoginRequest.safeParse({ nik: " ", password: "x" }).success).toBe(false);
  });

  test("endpoint builders", () => {
    expect(ENDPOINTS.tripPassengers("t1")).toBe("/api/trips/t1/passengers");
    expect(ENDPOINTS.departures).toBe("/api/departures");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bms/shared test`
Expected: FAIL, named exports missing.

- [ ] **Step 3: Write enums and errors**

`packages/shared/src/enums.ts`:
```ts
import { z } from "zod";

export const Role = z.enum(["SUPER_ADMIN", "ADMIN_GA", "EMPLOYEE", "VENDOR"]);
export type Role = z.infer<typeof Role>;
export const Direction = z.enum(["PICKUP", "DROPOFF"]);
export type Direction = z.infer<typeof Direction>;
export const TripStatus = z.enum(["SCHEDULED", "CANCELLED"]);
export type TripStatus = z.infer<typeof TripStatus>;
export const BookingStatus = z.enum(["BOOKED", "CANCELLED", "NO_SHOW"]);
export type BookingStatus = z.infer<typeof BookingStatus>;
export const BookingSource = z.enum(["SUBSCRIPTION", "DAILY"]);
export type BookingSource = z.infer<typeof BookingSource>;
export const SubscriptionStatus = z.enum(["ACTIVE", "ENDED"]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;
export const CancelReason = z.enum(["USER", "ADMIN_TRIP", "SUSPENDED", "SUBSCRIPTION_ENDED", "USER_DEACTIVATED"]);
export type CancelReason = z.infer<typeof CancelReason>;
export const AuthProvider = z.enum(["LOCAL", "SSO"]);
export type AuthProvider = z.infer<typeof AuthProvider>;
/** Departure board status. ALMOST = booked >= 90% of capacity. UI labels: TERSEDIA/HAMPIR/PENUH/BATAL. */
export const DepartureStatus = z.enum(["AVAILABLE", "ALMOST", "FULL", "CANCELLED"]);
export type DepartureStatus = z.infer<typeof DepartureStatus>;

export const ADMIN_ROLES: readonly Role[] = ["SUPER_ADMIN", "ADMIN_GA"];
```

`packages/shared/src/errors.ts`:
```ts
import { z } from "zod";

export const ErrorCode = z.enum([
  "TRIP_FULL", "CUTOFF_PASSED", "SCHEDULE_CONFLICT", "USER_SUSPENDED",
  "CAPACITY_BELOW_BOOKED", "VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN",
  "ACCOUNT_LOCKED", "MAINTENANCE", "NOT_FOUND",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({ code: ErrorCode, message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  TRIP_FULL: "Semua bus untuk rute, shift, dan arah ini sudah penuh.",
  CUTOFF_PASSED: "Batas waktu booking atau pembatalan sudah lewat.",
  SCHEDULE_CONFLICT: "Kamu sudah punya booking di tanggal, shift, dan arah yang sama.",
  USER_SUSPENDED: "Booking kamu sedang dibekukan oleh admin.",
  CAPACITY_BELOW_BOOKED: "Kapasitas baru lebih kecil dari jumlah kursi yang sudah dibooking.",
  VALIDATION_ERROR: "Data yang dikirim tidak valid.",
  UNAUTHORIZED: "Silakan login terlebih dahulu.",
  FORBIDDEN: "Kamu tidak punya akses ke fitur ini.",
  ACCOUNT_LOCKED: "Akun terkunci sementara karena terlalu banyak gagal login.",
  MAINTENANCE: "Sistem sedang memulihkan database. Coba lagi beberapa menit lagi.",
  NOT_FOUND: "Data tidak ditemukan.",
};

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  TRIP_FULL: 409, CUTOFF_PASSED: 409, SCHEDULE_CONFLICT: 409, USER_SUSPENDED: 403,
  CAPACITY_BELOW_BOOKED: 409, VALIDATION_ERROR: 400, UNAUTHORIZED: 401, FORBIDDEN: 403,
  ACCOUNT_LOCKED: 423, MAINTENANCE: 503, NOT_FOUND: 404,
};
```

- [ ] **Step 4: Write common, auth, master schemas**

`packages/shared/src/schemas/common.ts`:
```ts
import { z } from "zod";

export const Id = z.string().min(1);
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal YYYY-MM-DD");
export const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam HH:mm");
export const IsoDateTime = z.string().datetime({ offset: true });
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Warna #RRGGBB");
/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export const Weekdays = z.array(z.number().int().min(1).max(7)).min(1).max(7);

export const Paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
```

`packages/shared/src/schemas/auth.ts`:
```ts
import { z } from "zod";
import { Role } from "../enums";
import { Id, IsoDate } from "./common";

export const LoginRequest = z.object({ nik: z.string().trim().min(1), password: z.string().min(1) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const Me = z.object({
  id: Id, nik: z.string(), name: z.string(), role: Role, vendorId: Id.nullable(),
  mustChangePassword: z.boolean(),
  bookingSuspendedUntil: IsoDate.nullable(), suspendReason: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

/** Web gets refresh token as httpOnly cookie; mobile gets it in the body (`refreshToken`). */
export const LoginResponse = z.object({ accessToken: z.string(), refreshToken: z.string().optional(), user: Me });
export type LoginResponse = z.infer<typeof LoginResponse>;
export const RefreshResponse = LoginResponse;
export type RefreshResponse = LoginResponse;

/** newPassword min length is enforced server-side from setting `password_min_length`. */
export const ChangePasswordRequest = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(128) });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

export const SetupStatus = z.object({ needsSetup: z.boolean() });
export type SetupStatus = z.infer<typeof SetupStatus>;
export const SetupRequest = z.object({ nik: z.string().trim().min(1), name: z.string().trim().min(1), password: z.string().min(8).max(128) });
export type SetupRequest = z.infer<typeof SetupRequest>;
```

`packages/shared/src/schemas/master.ts`:
```ts
import { z } from "zod";
import { AuthProvider, Role } from "../enums";
import { HexColor, HhMm, Id, IsoDate } from "./common";

export const VendorInput = z.object({ name: z.string().trim().min(1), contact: z.string().trim().default(""), active: z.boolean().default(true) });
export type VendorInput = z.infer<typeof VendorInput>;
export const Vendor = VendorInput.extend({ id: Id });
export type Vendor = z.infer<typeof Vendor>;

export const BusInput = z.object({
  plate: z.string().trim().min(3).transform((s) => s.toUpperCase()),
  capacity: z.number().int().min(1).max(100),
  vendorId: Id, active: z.boolean().default(true),
});
export type BusInput = z.infer<typeof BusInput>;
export const Bus = z.object({ id: Id, plate: z.string(), capacity: z.number().int(), vendorId: Id, active: z.boolean() });
export type Bus = z.infer<typeof Bus>;

export const ShiftInput = z.object({ name: z.string().trim().min(1), startTime: HhMm, endTime: HhMm });
export type ShiftInput = z.infer<typeof ShiftInput>;
export const Shift = ShiftInput.extend({ id: Id });
export type Shift = z.infer<typeof Shift>;

export const RouteInput = z.object({
  code: z.string().trim().min(1).max(10), name: z.string().trim().min(1),
  color: HexColor, active: z.boolean().default(true),
});
export type RouteInput = z.infer<typeof RouteInput>;
export const Route = RouteInput.extend({ id: Id });
export type Route = z.infer<typeof Route>;

/** offsetMinutes: minutes after trip departure that the bus reaches this stop. */
export const StopInput = z.object({
  name: z.string().trim().min(1), seq: z.number().int().min(1),
  offsetMinutes: z.number().int().min(0).max(300),
  lat: z.number().nullable().default(null), lng: z.number().nullable().default(null),
  active: z.boolean().default(true),
});
export type StopInput = z.infer<typeof StopInput>;
export const Stop = StopInput.extend({ id: Id, routeId: Id });
export type Stop = z.infer<typeof Stop>;

export const UserSummary = z.object({
  id: Id, nik: z.string(), name: z.string(), department: z.string(), phone: z.string(),
  role: Role, authProvider: AuthProvider, active: z.boolean(), vendorId: Id.nullable(),
  bookingSuspendedUntil: IsoDate.nullable(), suspendReason: z.string().nullable(),
  lockedUntil: z.string().nullable(),
});
export type UserSummary = z.infer<typeof UserSummary>;

/** Manual create/update (admins, vendor accounts, single employee). Bulk employees come from import. */
export const UserInput = z.object({
  nik: z.string().trim().min(1), name: z.string().trim().min(1),
  department: z.string().trim().default(""), phone: z.string().trim().default(""),
  role: Role, vendorId: Id.nullable().default(null),
}).refine((u) => (u.role === "VENDOR") === (u.vendorId !== null), { message: "vendorId wajib hanya untuk role VENDOR", path: ["vendorId"] });
export type UserInput = z.infer<typeof UserInput>;

/** Shown once after create / reset / import. */
export const TempPassword = z.object({ userId: Id, nik: z.string(), tempPassword: z.string() });
export type TempPassword = z.infer<typeof TempPassword>;

/** Rows produced by SheetJS in the browser, sent as JSON. */
export const ImportRow = z.object({
  nik: z.string().trim().min(1, "NIK kosong"), name: z.string().trim().min(1, "Nama kosong"),
  department: z.string().trim().default(""), phone: z.string().trim().default(""),
});
export type ImportRow = z.infer<typeof ImportRow>;
export const ImportRequest = z.object({ rows: z.array(z.unknown()).max(10000) });
export type ImportRequest = z.infer<typeof ImportRequest>;
export const ImportPreview = z.object({
  created: z.array(ImportRow), updated: z.array(ImportRow),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
});
export type ImportPreview = z.infer<typeof ImportPreview>;
export const ImportCommitResponse = z.object({ passwords: z.array(TempPassword) });
export type ImportCommitResponse = z.infer<typeof ImportCommitResponse>;

export const SuspendRequest = z.object({ until: IsoDate, reason: z.string().trim().min(1) });
export type SuspendRequest = z.infer<typeof SuspendRequest>;
```

- [ ] **Step 5: Write trips, bookings, reports schemas**

`packages/shared/src/schemas/trips.ts`:
```ts
import { z } from "zod";
import { DepartureStatus, Direction, TripStatus } from "../enums";
import { HexColor, HhMm, Id, IsoDate, IsoDateTime, Weekdays } from "./common";

/** dayOffset 1 = departs the calendar day after the operational date (e.g. night-shift drop-off). */
export const TripTemplateInput = z.object({
  routeId: Id, shiftId: Id, direction: Direction, busId: Id,
  departureTime: HhMm, dayOffset: z.union([z.literal(0), z.literal(1)]),
  weekdays: Weekdays, active: z.boolean().default(true),
});
export type TripTemplateInput = z.infer<typeof TripTemplateInput>;
export const TripTemplate = TripTemplateInput.extend({ id: Id });
export type TripTemplate = z.infer<typeof TripTemplate>;

export const Trip = z.object({
  id: Id, templateId: Id, routeId: Id, shiftId: Id, direction: Direction,
  date: IsoDate, departureAt: IsoDateTime, busId: Id,
  capacity: z.number().int(), bookedCount: z.number().int(), status: TripStatus,
});
export type Trip = z.infer<typeof Trip>;

export const ChangeBusRequest = z.object({ busId: Id });
export type ChangeBusRequest = z.infer<typeof ChangeBusRequest>;
export const CancelDateRequest = z.object({ date: IsoDate });
export type CancelDateRequest = z.infer<typeof CancelDateRequest>;

/** Admin/vendor manifest row. pickupAt = departureAt + stop offset (PICKUP) or ETA (DROPOFF). */
export const Passenger = z.object({
  bookingId: Id, nik: z.string(), name: z.string(), department: z.string(), phone: z.string(),
  stopName: z.string(), stopSeq: z.number().int(), pickupAt: IsoDateTime,
});
export type Passenger = z.infer<typeof Passenger>;

/** Departure board row, readable by every role. No passenger data. */
export const Departure = z.object({
  tripId: Id, date: IsoDate, departureAt: IsoDateTime, direction: Direction,
  routeId: Id, routeCode: z.string(), routeName: z.string(), routeColor: HexColor,
  shiftId: Id, shiftName: z.string(), busPlate: z.string(),
  capacity: z.number().int(), bookedCount: z.number().int(),
  status: DepartureStatus, mine: z.boolean(),
});
export type Departure = z.infer<typeof Departure>;

/** Seats for one route+shift+direction+date combo (daily booking screen, spec 5.4). */
export const Availability = z.object({
  routeId: Id, shiftId: Id, direction: Direction, date: IsoDate,
  capacity: z.number().int(), bookedCount: z.number().int(),
  firstDepartureAt: IsoDateTime.nullable(), cutoffAt: IsoDateTime.nullable(), bookable: z.boolean(),
});
export type Availability = z.infer<typeof Availability>;
```

`packages/shared/src/schemas/bookings.ts`:
```ts
import { z } from "zod";
import { BookingSource, BookingStatus, CancelReason, Direction, SubscriptionStatus } from "../enums";
import { HexColor, Id, IsoDate, IsoDateTime, Weekdays } from "./common";

export const DailyBookingRequest = z.object({ routeId: Id, stopId: Id, shiftId: Id, direction: Direction, date: IsoDate });
export type DailyBookingRequest = z.infer<typeof DailyBookingRequest>;

/** Booking plus denormalized fields the ticket card needs. */
export const Booking = z.object({
  id: Id, userId: Id, tripId: Id, stopId: Id, subscriptionId: Id.nullable(),
  date: IsoDate, shiftId: Id, direction: Direction,
  source: BookingSource, status: BookingStatus,
  cancelReason: CancelReason.nullable(), cancelledAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
  routeCode: z.string(), routeName: z.string(), routeColor: HexColor, stopName: z.string(),
  busPlate: z.string(), departureAt: IsoDateTime, pickupAt: IsoDateTime, cutoffAt: IsoDateTime,
  seatsLeft: z.number().int(), capacity: z.number().int(),
});
export type Booking = z.infer<typeof Booking>;

export const SubscriptionInput = z.object({
  routeId: Id, stopId: Id, shiftId: Id, direction: Direction,
  startDate: IsoDate, endDate: IsoDate.nullable().default(null), weekdays: Weekdays,
}).refine((s) => s.endDate === null || s.endDate >= s.startDate, { message: "Tanggal akhir sebelum tanggal mulai", path: ["endDate"] });
export type SubscriptionInput = z.infer<typeof SubscriptionInput>;

export const Subscription = z.object({
  id: Id, userId: Id, routeId: Id, stopId: Id, shiftId: Id, direction: Direction,
  startDate: IsoDate, endDate: IsoDate.nullable(), weekdays: Weekdays,
  status: SubscriptionStatus, createdAt: IsoDateTime,
});
export type Subscription = z.infer<typeof Subscription>;

/** Outcome per already-generated date when a subscription is created (spec 5.3). */
export const SubscriptionCreateResponse = z.object({
  subscription: Subscription,
  booked: z.array(IsoDate), rejected: z.array(IsoDate), skippedCutoff: z.array(IsoDate),
});
export type SubscriptionCreateResponse = z.infer<typeof SubscriptionCreateResponse>;

export const RejectedRequest = z.object({
  id: Id, userId: Id, routeId: Id, shiftId: Id, direction: Direction, date: IsoDate,
  source: BookingSource, subscriptionId: Id.nullable(), createdAt: IsoDateTime,
});
export type RejectedRequest = z.infer<typeof RejectedRequest>;
```

`packages/shared/src/schemas/reports.ts`:
```ts
import { z } from "zod";
import { Direction } from "../enums";
import { HexColor, Id, IsoDate, IsoDateTime } from "./common";

export const OccupancyRow = z.object({
  date: IsoDate, routeId: Id, routeCode: z.string(), routeName: z.string(), routeColor: HexColor,
  shiftId: Id, shiftName: z.string(), direction: Direction,
  trips: z.number().int(), capacity: z.number().int(), booked: z.number().int(), rejected: z.number().int(),
});
export type OccupancyRow = z.infer<typeof OccupancyRow>;

export const DashboardSummary = z.object({
  date: IsoDate, trips: z.number().int(), capacity: z.number().int(), booked: z.number().int(),
  fullTrips: z.number().int(), rejectedToday: z.number().int(), rejectedYesterday: z.number().int(),
  rejectedLast7: z.array(z.object({ date: IsoDate, count: z.number().int() })),
  backupWarning: z.string().nullable(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

export const NoShowCandidate = z.object({ userId: Id, nik: z.string(), name: z.string(), noShows30d: z.number().int() });
export type NoShowCandidate = z.infer<typeof NoShowCandidate>;

export const Notification = z.object({
  id: Id, type: z.string(), title: z.string(), body: z.string(),
  data: z.record(z.unknown()), readAt: IsoDateTime.nullable(), createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof Notification>;

export const AuditLog = z.object({
  id: Id, actorId: Id, actorName: z.string(), action: z.string(), entity: z.string(), entityId: z.string(),
  before: z.unknown(), after: z.unknown(), createdAt: IsoDateTime,
});
export type AuditLog = z.infer<typeof AuditLog>;

export const BackupFile = z.object({ name: z.string(), sizeBytes: z.number().int(), createdAt: IsoDateTime, copiedToShare: z.boolean() });
export type BackupFile = z.infer<typeof BackupFile>;
export const RestoreRequest = z.object({ fileName: z.string().min(1), password: z.string().min(1), confirm: z.literal("RESTORE") });
export type RestoreRequest = z.infer<typeof RestoreRequest>;
export const SystemStatus = z.object({ maintenance: z.boolean(), message: z.string().nullable() });
export type SystemStatus = z.infer<typeof SystemStatus>;
```

- [ ] **Step 6: Write endpoints and index**

`packages/shared/src/endpoints.ts`:
```ts
/** Single list of API paths. MSW handlers and API clients both use these. */
export const ENDPOINTS = {
  setupStatus: "/api/setup/status",
  setup: "/api/setup",
  login: "/api/auth/login",
  refresh: "/api/auth/refresh",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  changePassword: "/api/auth/change-password",
  deviceTokens: "/api/device-tokens",

  vendors: "/api/vendors", vendor: (id: string) => `/api/vendors/${id}`,
  buses: "/api/buses", bus: (id: string) => `/api/buses/${id}`,
  shifts: "/api/shifts", shift: (id: string) => `/api/shifts/${id}`,
  routes: "/api/routes", route: (id: string) => `/api/routes/${id}`,
  routeStops: (routeId: string) => `/api/routes/${routeId}/stops`,
  stop: (routeId: string, stopId: string) => `/api/routes/${routeId}/stops/${stopId}`,

  users: "/api/users", user: (id: string) => `/api/users/${id}`,
  userResetPassword: (id: string) => `/api/users/${id}/reset-password`,
  userSuspend: (id: string) => `/api/users/${id}/suspend`,
  userUnsuspend: (id: string) => `/api/users/${id}/unsuspend`,
  userDeactivate: (id: string) => `/api/users/${id}/deactivate`,
  userBookings: (id: string) => `/api/users/${id}/bookings`,
  importPreview: "/api/users/import/preview",
  importCommit: "/api/users/import/commit",

  templates: "/api/trip-templates", template: (id: string) => `/api/trip-templates/${id}`,
  trips: "/api/trips",
  tripBus: (id: string) => `/api/trips/${id}/bus`,
  tripCancel: (id: string) => `/api/trips/${id}/cancel`,
  tripsCancelDate: "/api/trips/cancel-date",
  tripPassengers: (id: string) => `/api/trips/${id}/passengers`,
  departures: "/api/departures",
  availability: "/api/availability",

  myBookings: "/api/me/bookings",
  bookings: "/api/bookings",
  bookingCancel: (id: string) => `/api/bookings/${id}/cancel`,
  mySubscriptions: "/api/me/subscriptions",
  subscriptions: "/api/subscriptions",
  subscriptionEnd: (id: string) => `/api/subscriptions/${id}/end`,

  dashboard: "/api/reports/dashboard",
  occupancy: "/api/reports/occupancy",
  rejected: "/api/reports/rejected",
  noShowCandidates: "/api/reports/no-show-candidates",

  notifications: "/api/me/notifications",
  notificationRead: (id: string) => `/api/me/notifications/${id}/read`,
  audit: "/api/audit-logs",

  settings: "/api/settings",
  settingsTestPush: "/api/settings/test-push",
  settingsTestShare: "/api/settings/test-share",
  backups: "/api/backups",
  backupRun: "/api/backups/run",
  backupDownload: (name: string) => `/api/backups/${encodeURIComponent(name)}/download`,
  backupUpload: "/api/backups/upload",
  restore: "/api/backups/restore",
  systemStatus: "/api/system/status",
} as const;
```

Replace `packages/shared/src/index.ts`:
```ts
export const CONTRACT_VERSION = 1;
export * from "./enums";
export * from "./errors";
export * from "./endpoints";
export * from "./schemas/common";
export * from "./schemas/auth";
export * from "./schemas/master";
export * from "./schemas/trips";
export * from "./schemas/bookings";
export * from "./schemas/reports";
```

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm --filter @bms/shared test && pnpm --filter @bms/shared typecheck`
Expected: all PASS, typecheck exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): API contract schemas, enums, error codes, endpoints"
```

### Task 3: Jakarta time helpers

**Files:**
- Create: `packages/shared/src/time.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./time";`)
- Test: `packages/shared/test/time.test.ts`

**Interfaces:**
- Produces (exported from `@bms/shared`):
  - `toJakartaIso(ms: number): string` → `"YYYY-MM-DDTHH:mm:ss+07:00"`
  - `jakartaDate(now: Date): string` → operational `YYYY-MM-DD` in Jakarta
  - `addDays(date: string, n: number): string`
  - `isoWeekday(date: string): number` (1 = Mon … 7 = Sun)
  - `departureAt(date: string, time: string, dayOffset: 0 | 1): string`
  - `cutoffAt(departureAt: string, cutoffMinutes: number): string`
  - `isPastCutoff(departureAt: string, cutoffMinutes: number, now: Date): boolean` (true when `now >= departureAt − cutoff`)
  - `stopTime(departureAt: string, direction: Direction, offsetMinutes: number, lastOffsetMinutes: number): string`
  - `departureStatus(tripStatus: TripStatus, capacity: number, booked: number): DepartureStatus`

Jakarta is fixed UTC+7 (no DST), so plain millisecond arithmetic is exact; no timezone library.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/time.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import {
  addDays, cutoffAt, departureAt, departureStatus, isPastCutoff, isoWeekday, jakartaDate, stopTime, toJakartaIso,
} from "../src/index";

describe("time", () => {
  test("jakartaDate rolls over at 17:00 UTC", () => {
    expect(jakartaDate(new Date("2026-10-13T16:59:00Z"))).toBe("2026-10-13");
    expect(jakartaDate(new Date("2026-10-13T17:00:00Z"))).toBe("2026-10-14");
  });

  test("addDays crosses month and year", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("isoWeekday", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // Monday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
  });

  test("departureAt same day", () => {
    expect(departureAt("2026-10-14", "05:20", 0)).toBe("2026-10-14T05:20:00+07:00");
  });

  test("night shift drop-off with dayOffset 1 crosses midnight and month", () => {
    expect(departureAt("2026-10-31", "00:15", 1)).toBe("2026-11-01T00:15:00+07:00");
  });

  test("cutoff computed from the next-day instant", () => {
    const dep = departureAt("2026-10-14", "00:15", 1); // 15 Oct 00:15 WIB
    expect(cutoffAt(dep, 120)).toBe("2026-10-14T22:15:00+07:00");
    expect(isPastCutoff(dep, 120, new Date("2026-10-14T22:14:59+07:00"))).toBe(false);
    expect(isPastCutoff(dep, 120, new Date("2026-10-14T22:15:00+07:00"))).toBe(true);
  });

  test("cutoff 0 means up to departure", () => {
    const dep = "2026-10-14T05:20:00+07:00";
    expect(isPastCutoff(dep, 0, new Date("2026-10-14T05:19:00+07:00"))).toBe(false);
  });

  test("stopTime pickup adds offset, dropoff uses reversed order ETA", () => {
    const dep = "2026-10-14T05:00:00+07:00";
    expect(stopTime(dep, "PICKUP", 25, 60)).toBe("2026-10-14T05:25:00+07:00");
    // drop-off: first stop dropped is the last one on the pickup order
    expect(stopTime("2026-10-14T15:00:00+07:00", "DROPOFF", 0, 60)).toBe("2026-10-14T16:00:00+07:00");
    expect(stopTime("2026-10-14T15:00:00+07:00", "DROPOFF", 60, 60)).toBe("2026-10-14T15:00:00+07:00");
  });

  test("toJakartaIso", () => {
    expect(toJakartaIso(Date.parse("2026-10-13T22:30:00Z"))).toBe("2026-10-14T05:30:00+07:00");
  });

  test("departureStatus thresholds", () => {
    expect(departureStatus("SCHEDULED", 50, 44)).toBe("AVAILABLE");
    expect(departureStatus("SCHEDULED", 50, 45)).toBe("ALMOST"); // 90%
    expect(departureStatus("SCHEDULED", 50, 50)).toBe("FULL");
    expect(departureStatus("CANCELLED", 50, 0)).toBe("CANCELLED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bms/shared test -- time`
Expected: FAIL, exports missing.

- [ ] **Step 3: Implement**

`packages/shared/src/time.ts`:
```ts
import type { DepartureStatus, Direction, TripStatus } from "./enums";

const OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Jakarta, fixed UTC+7, no DST
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

export function toJakartaIso(ms: number): string {
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 19) + "+07:00";
}

export function jakartaDate(now: Date): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function departureAt(date: string, time: string, dayOffset: 0 | 1): string {
  return `${addDays(date, dayOffset)}T${time}:00+07:00`;
}

export function cutoffAt(departureAt: string, cutoffMinutes: number): string {
  return toJakartaIso(Date.parse(departureAt) - cutoffMinutes * MIN);
}

export function isPastCutoff(departureAt: string, cutoffMinutes: number, now: Date): boolean {
  return now.getTime() >= Date.parse(departureAt) - cutoffMinutes * MIN;
}

/** PICKUP: departure + offset. DROPOFF: stops visited in reverse, ETA = departure + (last − offset). */
export function stopTime(departureAt: string, direction: Direction, offsetMinutes: number, lastOffsetMinutes: number): string {
  const delta = direction === "PICKUP" ? offsetMinutes : lastOffsetMinutes - offsetMinutes;
  return toJakartaIso(Date.parse(departureAt) + delta * MIN);
}

export function departureStatus(tripStatus: TripStatus, capacity: number, booked: number): DepartureStatus {
  if (tripStatus === "CANCELLED") return "CANCELLED";
  if (booked >= capacity) return "FULL";
  return booked >= capacity * 0.9 ? "ALMOST" : "AVAILABLE";
}
```

Add to `packages/shared/src/index.ts`:
```ts
export * from "./time";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bms/shared test && pnpm --filter @bms/shared typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): Jakarta time helpers for departure, cutoff, stop ETA"
```

### Task 4: Settings schema

**Files:**
- Create: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./settings";`)
- Test: `packages/shared/test/settings.test.ts`

**Interfaces:**
- Produces (exported from `@bms/shared`):
  - `Settings` (Zod object, every key has its default, so `Settings.parse({})` returns all defaults) and `type Settings`.
  - `SettingsUpdate = Settings.partial()` with the same bounds; `type SettingsUpdate`.
  - `SECRET_SETTING_KEYS: readonly ("fcm_service_account" | "backup_share_password")[]`.
  - `SETTING_GROUPS: Record<"booking"|"notification"|"security"|"backup", (keyof Settings)[]>` for the tabbed screen.
  - `SettingsView`: what `GET /api/settings` returns, non-secret values as-is, each secret replaced by `{ isSet: boolean }`. `type SettingsView`.
  - `toSettingsView(s: Settings): SettingsView`.
  - Secret write rule: in a PUT body, a secret key with `""` clears it, a string sets it, an absent key leaves it unchanged.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/settings.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bms/shared test -- settings`
Expected: FAIL, exports missing.

- [ ] **Step 3: Implement**

`packages/shared/src/settings.ts`:
```ts
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
```

Add to `packages/shared/src/index.ts`:
```ts
export * from "./settings";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bms/shared test && pnpm --filter @bms/shared typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): centralized settings schema with defaults, bounds, secret view"
```

### Task 5: Mock DB, trip generation, seat allocation, cancel

**Files:**
- Create: `packages/mock-api/src/db.ts`, `src/domain/allocate.ts`
- Create: `packages/mock-api/test/fixture.ts`, `test/allocate.test.ts`

**Interfaces:**
- Consumes: `@bms/shared` schemas/types, `departureAt`, `isPastCutoff`, `jakartaDate`, `isoWeekday`, `addDays`, `toJakartaIso`, `Settings`, `ERROR_MESSAGES`, `ErrorCode`.
- Produces (`packages/mock-api/src/db.ts`):
  - `interface UserRow extends UserSummary { password: string; mustChangePassword: boolean; failedLogins: number }`
  - `interface BookingRow { id; userId; tripId; stopId; subscriptionId: string|null; date; shiftId; direction; source; status; cancelReason: CancelReason|null; cancelledAt: string|null; createdAt }`
  - `interface NotificationRow extends Notification { userId: string }`
  - `interface Db { now: () => Date; seq: number; users; vendors; buses; shifts; routes; stops; templates; trips; subscriptions; bookings; rejected; notifications; audit; settings: Settings; backups: BackupFile[]; maintenance: boolean; sessions: Map<string, string> }` (sessions: access token → userId)
  - `createDb(now?: () => Date): Db`, `nextId(db, prefix): string`, `nowIso(db): string`, `today(db): string`
  - `class DomainError extends Error { code: ErrorCode }` — `new DomainError(code, message?)`
  - `notify(db, userId, type, title, body, data?)`, `audit(db, actorId, action, entity, entityId, before, after)`
- Produces (`src/domain/allocate.ts`):
  - `generateTrips(db, date): Trip[]` — idempotent per `(templateId, date)`, returns newly created trips.
  - `allocateSeat(db, input: AllocateInput): BookingRow` with `AllocateInput = { userId; routeId; stopId; shiftId; direction; date; source; subscriptionId: string|null; fromCron?: boolean }`. Throws `DomainError`.
  - `cancelBooking(db, booking: BookingRow, reason: CancelReason, opts: { checkCutoff: boolean }): void`
  - `isSuspendedOn(user: UserRow, date: string): boolean` (`until !== null && date <= until`)

Rule notes for the implementer:
- Mock is single-threaded JS; each domain call is synchronous, so the conditional increment is atomic just like the SQL `UPDATE ... WHERE booked_count < capacity`.
- Order of checks in `allocateSeat`: user active → suspended (skipped when `fromCron`; generate checks per date) → stop valid → conflict → trips exist → cutoff (skipped when `fromCron`) → seat. Conflict is checked before seats so a duplicate request never writes a `rejected_requests` row.
- A combo with no generated trip returns `NOT_FOUND` with message "Belum ada trip untuk pilihan ini.".

- [ ] **Step 1: Write the test fixture**

`packages/mock-api/test/fixture.ts`:
```ts
import { createDb, type Db, type UserRow } from "../src/db";

export function user(id: string, extra: Partial<UserRow> = {}): UserRow {
  return {
    id, nik: id.toUpperCase(), name: `User ${id}`, department: "Produksi", phone: "0812",
    role: "EMPLOYEE", authProvider: "LOCAL", active: true, vendorId: null,
    bookingSuspendedUntil: null, suspendReason: null, lockedUntil: null,
    password: "password", mustChangePassword: false, failedLogins: 0, ...extra,
  };
}

/** One route, one shift, two 1-seat buses on two PICKUP templates (05:00, 05:10). Now = Wed 14 Oct 2026 00:00 WIB. */
export function world(now = "2026-10-14T00:00:00+07:00"): Db {
  const db = createDb(() => new Date(now));
  db.vendors.push({ id: "v1", name: "PT Trans", contact: "", active: true });
  db.buses.push(
    { id: "b1", plate: "B 1 AA", capacity: 1, vendorId: "v1", active: true },
    { id: "b2", plate: "B 2 BB", capacity: 1, vendorId: "v1", active: true },
    { id: "b3", plate: "B 3 CC", capacity: 40, vendorId: "v1", active: true },
  );
  db.shifts.push({ id: "sh1", name: "Pagi", startTime: "06:00", endTime: "14:00" });
  db.routes.push({ id: "r1", code: "R1", name: "Cikarang", color: "#D6322B", active: true });
  db.stops.push(
    { id: "s1", routeId: "r1", name: "Halte A", seq: 1, offsetMinutes: 0, lat: null, lng: null, active: true },
    { id: "s2", routeId: "r1", name: "Halte B", seq: 2, offsetMinutes: 20, lat: null, lng: null, active: true },
    { id: "s9", routeId: "r1", name: "Halte Tutup", seq: 3, offsetMinutes: 30, lat: null, lng: null, active: false },
  );
  const all = [1, 2, 3, 4, 5, 6, 7];
  db.templates.push(
    { id: "tp1", routeId: "r1", shiftId: "sh1", direction: "PICKUP", busId: "b1", departureTime: "05:00", dayOffset: 0, weekdays: all, active: true },
    { id: "tp2", routeId: "r1", shiftId: "sh1", direction: "PICKUP", busId: "b2", departureTime: "05:10", dayOffset: 0, weekdays: all, active: true },
  );
  db.users.push(user("u1"), user("u2"), user("u3"), user("adm", { role: "SUPER_ADMIN" }));
  return db;
}

export const pick = { routeId: "r1", stopId: "s1", shiftId: "sh1", direction: "PICKUP" as const };
```

- [ ] **Step 2: Write the failing test**

`packages/mock-api/test/allocate.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { allocateSeat, cancelBooking, generateTrips } from "../src/domain/allocate";
import { DomainError } from "../src/db";
import { pick, world } from "./fixture";

const D = "2026-10-14";
const req = (userId: string, extra = {}) => ({ ...pick, userId, date: D, source: "DAILY" as const, subscriptionId: null, ...extra });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("generateTrips", () => {
  test("idempotent, capacity from bus, departure from template", () => {
    const db = world();
    expect(generateTrips(db, D)).toHaveLength(2);
    expect(generateTrips(db, D)).toHaveLength(0);
    expect(db.trips[0]).toMatchObject({ date: D, capacity: 1, bookedCount: 0, status: "SCHEDULED", departureAt: "2026-10-14T05:00:00+07:00" });
  });

  test("skips inactive templates and weekdays not listed", () => {
    const db = world();
    db.templates[0]!.active = false;
    db.templates[1]!.weekdays = [1]; // Monday only; D is Wednesday
    expect(generateTrips(db, D)).toHaveLength(0);
  });
});

describe("allocateSeat", () => {
  test("fills earliest trip first, then next bus", () => {
    const db = world(); generateTrips(db, D);
    const a = allocateSeat(db, req("u1"));
    const b = allocateSeat(db, req("u2"));
    expect(db.trips.find((t) => t.id === a.tripId)!.departureAt).toContain("05:00");
    expect(db.trips.find((t) => t.id === b.tripId)!.departureAt).toContain("05:10");
  });

  test("all buses full -> TRIP_FULL and one rejected row", () => {
    const db = world(); generateTrips(db, D);
    allocateSeat(db, req("u1")); allocateSeat(db, req("u2"));
    expect(code(() => allocateSeat(db, req("u3")))).toBe("TRIP_FULL");
    expect(db.rejected).toHaveLength(1);
    expect(db.rejected[0]).toMatchObject({ userId: "u3", source: "DAILY", date: D });
    expect(db.trips.every((t) => t.bookedCount <= t.capacity)).toBe(true);
  });

  test("seats free but every trip past cutoff -> CUTOFF_PASSED, no rejected row", () => {
    const db = world("2026-10-14T03:30:00+07:00"); generateTrips(db, D); // cutoff 03:00 / 03:10
    expect(code(() => allocateSeat(db, req("u1")))).toBe("CUTOFF_PASSED");
    expect(db.rejected).toHaveLength(0);
  });

  test("only the later trip still open -> books it", () => {
    const db = world("2026-10-14T03:05:00+07:00"); generateTrips(db, D);
    const b = allocateSeat(db, req("u1"));
    expect(db.trips.find((t) => t.id === b.tripId)!.departureAt).toContain("05:10");
  });

  test("fromCron ignores cutoff", () => {
    const db = world("2026-10-14T04:00:00+07:00"); generateTrips(db, D);
    expect(allocateSeat(db, req("u1", { fromCron: true, source: "SUBSCRIPTION" })).status).toBe("BOOKED");
  });

  test("same user, date, shift, direction twice -> SCHEDULE_CONFLICT, no rejected row", () => {
    const db = world(); generateTrips(db, D);
    allocateSeat(db, req("u1"));
    expect(code(() => allocateSeat(db, req("u1", { stopId: "s2" })))).toBe("SCHEDULE_CONFLICT");
    expect(db.rejected).toHaveLength(0);
  });

  test("suspended user -> USER_SUSPENDED", () => {
    const db = world(); generateTrips(db, D);
    db.users[0]!.bookingSuspendedUntil = "2026-10-20";
    expect(code(() => allocateSeat(db, req("u1")))).toBe("USER_SUSPENDED");
  });

  test("suspension ended yesterday -> allowed", () => {
    const db = world(); generateTrips(db, D);
    db.users[0]!.bookingSuspendedUntil = "2026-10-13";
    expect(allocateSeat(db, req("u1")).status).toBe("BOOKED");
  });

  test("inactive stop or stop of another route -> VALIDATION_ERROR", () => {
    const db = world(); generateTrips(db, D);
    expect(code(() => allocateSeat(db, req("u1", { stopId: "s9" })))).toBe("VALIDATION_ERROR");
    expect(code(() => allocateSeat(db, req("u1", { stopId: "nope" })))).toBe("VALIDATION_ERROR");
  });

  test("no generated trip -> NOT_FOUND", () => {
    const db = world();
    expect(code(() => allocateSeat(db, req("u1")))).toBe("NOT_FOUND");
  });

  test("cancelled trip is never booked", () => {
    const db = world(); generateTrips(db, D);
    db.trips.forEach((t) => (t.status = "CANCELLED"));
    expect(code(() => allocateSeat(db, req("u1")))).toBe("NOT_FOUND");
  });
});

describe("cancelBooking", () => {
  test("frees the seat immediately", () => {
    const db = world(); generateTrips(db, D);
    const a = allocateSeat(db, req("u1")); allocateSeat(db, req("u2"));
    cancelBooking(db, a, "USER", { checkCutoff: true });
    expect(a).toMatchObject({ status: "CANCELLED", cancelReason: "USER" });
    expect(allocateSeat(db, req("u3")).tripId).toBe(a.tripId);
  });

  test("after cutoff -> CUTOFF_PASSED unless checkCutoff false", () => {
    const db = world(); generateTrips(db, D);
    const a = allocateSeat(db, req("u1"));
    db.now = () => new Date("2026-10-14T03:00:00+07:00");
    expect(code(() => cancelBooking(db, a, "USER", { checkCutoff: true }))).toBe("CUTOFF_PASSED");
    cancelBooking(db, a, "USER_DEACTIVATED", { checkCutoff: false });
    expect(a.status).toBe("CANCELLED");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @bms/mock-api test -- allocate`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement db.ts**

`packages/mock-api/src/db.ts`:
```ts
import {
  ERROR_MESSAGES, Settings, jakartaDate, toJakartaIso,
  type AuditLog, type BackupFile, type BookingSource, type BookingStatus, type Bus, type CancelReason,
  type Direction, type ErrorCode, type Notification, type RejectedRequest, type Route, type Shift, type Stop,
  type Subscription, type Trip, type TripTemplate, type UserSummary, type Vendor,
} from "@bms/shared";

export interface UserRow extends UserSummary { password: string; mustChangePassword: boolean; failedLogins: number }

export interface BookingRow {
  id: string; userId: string; tripId: string; stopId: string; subscriptionId: string | null;
  date: string; shiftId: string; direction: Direction; source: BookingSource; status: BookingStatus;
  cancelReason: CancelReason | null; cancelledAt: string | null; createdAt: string;
}

export interface NotificationRow extends Notification { userId: string }

export interface Db {
  now: () => Date;
  seq: number;
  users: UserRow[]; vendors: Vendor[]; buses: Bus[]; shifts: Shift[]; routes: Route[]; stops: Stop[];
  templates: TripTemplate[]; trips: Trip[]; subscriptions: Subscription[]; bookings: BookingRow[];
  rejected: RejectedRequest[]; notifications: NotificationRow[]; audit: AuditLog[];
  settings: Settings; backups: BackupFile[]; maintenance: boolean;
  /** access token -> userId */
  sessions: Map<string, string>;
}

export function createDb(now: () => Date = () => new Date()): Db {
  return {
    now, seq: 0,
    users: [], vendors: [], buses: [], shifts: [], routes: [], stops: [], templates: [], trips: [],
    subscriptions: [], bookings: [], rejected: [], notifications: [], audit: [],
    settings: Settings.parse({}), backups: [], maintenance: false, sessions: new Map(),
  };
}

export const nextId = (db: Db, prefix: string) => `${prefix}${++db.seq}`;
export const nowIso = (db: Db) => toJakartaIso(db.now().getTime());
export const today = (db: Db) => jakartaDate(db.now());

export class DomainError extends Error {
  constructor(public code: ErrorCode, message = ERROR_MESSAGES[code]) {
    super(message);
  }
}

export function notify(db: Db, userId: string, type: string, title: string, body: string, data: Record<string, unknown> = {}) {
  db.notifications.push({ id: nextId(db, "n"), userId, type, title, body, data, readAt: null, createdAt: nowIso(db) });
}

export function audit(db: Db, actorId: string, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  const actorName = db.users.find((u) => u.id === actorId)?.name ?? actorId;
  db.audit.push({ id: nextId(db, "a"), actorId, actorName, action, entity, entityId, before, after, createdAt: nowIso(db) });
}
```

- [ ] **Step 5: Implement allocate.ts**

`packages/mock-api/src/domain/allocate.ts`:
```ts
import { departureAt, isPastCutoff, isoWeekday, type BookingSource, type CancelReason, type Direction, type Trip } from "@bms/shared";
import { DomainError, nextId, nowIso, type BookingRow, type Db, type UserRow } from "../db";

export function isSuspendedOn(user: UserRow, date: string): boolean {
  return user.bookingSuspendedUntil !== null && date <= user.bookingSuspendedUntil;
}

/** Spec 5.2 step 1. Idempotent per (templateId, date). */
export function generateTrips(db: Db, date: string): Trip[] {
  const created: Trip[] = [];
  for (const t of db.templates) {
    if (!t.active || !t.weekdays.includes(isoWeekday(date))) continue;
    if (db.trips.some((x) => x.templateId === t.id && x.date === date)) continue;
    const bus = db.buses.find((b) => b.id === t.busId)!;
    const trip: Trip = {
      id: nextId(db, "t"), templateId: t.id, routeId: t.routeId, shiftId: t.shiftId, direction: t.direction,
      date, departureAt: departureAt(date, t.departureTime, t.dayOffset), busId: bus.id,
      capacity: bus.capacity, bookedCount: 0, status: "SCHEDULED",
    };
    db.trips.push(trip);
    created.push(trip);
  }
  return created;
}

export interface AllocateInput {
  userId: string; routeId: string; stopId: string; shiftId: string; direction: Direction; date: string;
  source: BookingSource; subscriptionId: string | null; fromCron?: boolean;
}

/** Spec 5.1. Synchronous, so the conditional increment is atomic like the SQL version. */
export function allocateSeat(db: Db, i: AllocateInput): BookingRow {
  const user = db.users.find((u) => u.id === i.userId);
  if (!user || !user.active) throw new DomainError("FORBIDDEN");
  if (!i.fromCron && isSuspendedOn(user, i.date)) throw new DomainError("USER_SUSPENDED");
  const stop = db.stops.find((s) => s.id === i.stopId);
  if (!stop || stop.routeId !== i.routeId || !stop.active) throw new DomainError("VALIDATION_ERROR", "Titik jemput tidak valid untuk rute ini.");
  if (db.bookings.some((b) => b.userId === i.userId && b.date === i.date && b.shiftId === i.shiftId && b.direction === i.direction && b.status === "BOOKED")) {
    throw new DomainError("SCHEDULE_CONFLICT");
  }

  const trips = db.trips
    .filter((t) => t.routeId === i.routeId && t.shiftId === i.shiftId && t.direction === i.direction && t.date === i.date && t.status === "SCHEDULED")
    .sort((a, b) => a.departureAt.localeCompare(b.departureAt) || a.id.localeCompare(b.id));
  if (trips.length === 0) throw new DomainError("NOT_FOUND", "Belum ada trip untuk pilihan ini.");
  const open = i.fromCron ? trips : trips.filter((t) => !isPastCutoff(t.departureAt, db.settings.booking_cutoff_minutes, db.now()));
  if (open.length === 0) throw new DomainError("CUTOFF_PASSED");

  const trip = open.find((t) => t.bookedCount < t.capacity);
  if (!trip) {
    db.rejected.push({
      id: nextId(db, "rj"), userId: i.userId, routeId: i.routeId, shiftId: i.shiftId, direction: i.direction,
      date: i.date, source: i.source, subscriptionId: i.subscriptionId, createdAt: nowIso(db),
    });
    throw new DomainError("TRIP_FULL");
  }
  trip.bookedCount++;
  const booking: BookingRow = {
    id: nextId(db, "bk"), userId: i.userId, tripId: trip.id, stopId: i.stopId, subscriptionId: i.subscriptionId,
    date: i.date, shiftId: i.shiftId, direction: i.direction, source: i.source, status: "BOOKED",
    cancelReason: null, cancelledAt: null, createdAt: nowIso(db),
  };
  db.bookings.push(booking);
  return booking;
}

/** Spec 5.5. checkCutoff false is for admin paths that ignore cutoff (deactivate, cancel trip). */
export function cancelBooking(db: Db, booking: BookingRow, reason: CancelReason, opts: { checkCutoff: boolean }): void {
  if (booking.status !== "BOOKED") return;
  const trip = db.trips.find((t) => t.id === booking.tripId)!;
  if (opts.checkCutoff && isPastCutoff(trip.departureAt, db.settings.booking_cutoff_minutes, db.now())) {
    throw new DomainError("CUTOFF_PASSED");
  }
  booking.status = "CANCELLED";
  booking.cancelReason = reason;
  booking.cancelledAt = nowIso(db);
  trip.bookedCount--;
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @bms/mock-api test -- allocate && pnpm --filter @bms/mock-api typecheck`
Expected: all PASS.

The package now has real test files, so delete the placeholder `packages/mock-api/vitest.config.ts` added in Task 1 Step 4, then re-run `pnpm --filter @bms/mock-api test` to confirm the suite still passes without it.

- [ ] **Step 7: Commit**

```bash
git add packages/mock-api
git commit -m "feat(mock-api): in-memory db, trip generation, seat allocation and cancel"
```

### Task 6: Subscriptions, nightly generation, admin actions

**Files:**
- Create: `packages/mock-api/src/domain/generate.ts`, `src/domain/admin.ts`
- Test: `packages/mock-api/test/generate.test.ts`, `test/admin.test.ts`

**Interfaces:**
- Consumes: Task 5 `generateTrips`, `allocateSeat`, `cancelBooking`, `isSuspendedOn`, `Db`, `DomainError`, `notify`, `audit`, `today`, `nextId`, `nowIso`; shared `addDays`, `isoWeekday`, `isPastCutoff`, `SubscriptionInput`, `SubscriptionCreateResponse`.
- Produces (`src/domain/generate.ts`):
  - `subscriptionCovers(s: Subscription, date: string): boolean`
  - `generateSubscriptionBookings(db, date): void` — spec 5.2 step 2 (cron, no cutoff).
  - `runGenerate(db): void` — for `today .. today + generate_days_ahead`: `generateTrips` then `generateSubscriptionBookings`, per date.
  - `createSubscription(db, userId, input: SubscriptionInput): SubscriptionCreateResponse` — spec 5.3, overlap → `SCHEDULE_CONFLICT`.
  - `endSubscription(db, userId, subscriptionId): Subscription` — spec 5.3.
- Produces (`src/domain/admin.ts`), each takes `actorId` first after `db` and writes `audit`:
  - `suspendUser(db, actorId, userId, until, reason)`, `unsuspendUser(db, actorId, userId)`
  - `deactivateUser(db, actorId, userId)`
  - `changeTripBus(db, actorId, tripId, busId)`, `setBusCapacity(db, actorId, busId, capacity)`
  - `cancelTrip(db, actorId, tripId)`, `cancelDate(db, actorId, date): number` (count cancelled)

Mock simplification: template edits are not propagated to already-generated trips (backend Plan 4 does that per spec 5.6). Marked with a `ponytail:` comment.

- [ ] **Step 1: Write the failing generate test**

`packages/mock-api/test/generate.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { allocateSeat, cancelBooking, generateTrips } from "../src/domain/allocate";
import { createSubscription, endSubscription, generateSubscriptionBookings, runGenerate } from "../src/domain/generate";
import { DomainError } from "../src/db";
import { pick, world } from "./fixture";

const D = "2026-10-14"; // Wednesday
const sub = (extra = {}) => ({ ...pick, startDate: D, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7], ...extra });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("generation", () => {
  test("runGenerate builds today..today+N, idempotent", () => {
    const db = world();
    db.settings.generate_days_ahead = 2;
    runGenerate(db); runGenerate(db);
    expect(db.trips).toHaveLength(6); // 2 templates x 3 days
  });

  test("subscriptions get seats before daily, ordered by created_at, full -> rejected + notification once", () => {
    const db = world();
    for (const u of ["u1", "u2", "u3"]) createSubscription(db, u, sub({ startDate: "2026-10-15" }));
    generateTrips(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings.filter((b) => b.status === "BOOKED").map((b) => b.userId)).toEqual(["u1", "u2"]);
    expect(db.rejected).toHaveLength(1);
    expect(db.notifications.filter((n) => n.userId === "u3")).toHaveLength(1);
  });

  test("user-cancelled day is not re-created; suspended-cancelled day is", () => {
    const db = world();
    const { subscription } = createSubscription(db, "u1", sub({ startDate: "2026-10-15" }));
    generateTrips(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    const b = db.bookings[0]!;
    cancelBooking(db, b, "USER", { checkCutoff: true });
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings.filter((x) => x.status === "BOOKED")).toHaveLength(0);
    b.cancelReason = "SUSPENDED";
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings.filter((x) => x.status === "BOOKED" && x.subscriptionId === subscription.id)).toHaveLength(1);
  });

  test("weekday filter and suspended user skipped", () => {
    const db = world();
    createSubscription(db, "u1", sub({ startDate: "2026-10-15", weekdays: [1] })); // 15th is Thursday
    createSubscription(db, "u2", sub({ startDate: "2026-10-15" }));
    db.users[1]!.bookingSuspendedUntil = "2026-10-15";
    generateTrips(db, "2026-10-15");
    generateSubscriptionBookings(db, "2026-10-15");
    expect(db.bookings).toHaveLength(0);
  });
});

describe("createSubscription", () => {
  test("books already-generated dates, skips past-cutoff dates", () => {
    const db = world("2026-10-14T03:30:00+07:00");
    generateTrips(db, D); generateTrips(db, "2026-10-15");
    const r = createSubscription(db, "u1", sub());
    expect(r.skippedCutoff).toEqual([D]);
    expect(r.booked).toEqual(["2026-10-15"]);
  });

  test("overlapping subscription -> SCHEDULE_CONFLICT; other direction OK", () => {
    const db = world();
    createSubscription(db, "u1", sub({ weekdays: [1, 2] }));
    expect(code(() => createSubscription(db, "u1", sub({ weekdays: [2, 3] })))).toBe("SCHEDULE_CONFLICT");
    expect(code(() => createSubscription(db, "u1", sub({ weekdays: [3] })))).toBe("OK");
    expect(code(() => createSubscription(db, "u1", sub({ direction: "DROPOFF", weekdays: [1] })))).toBe("OK");
  });

  test("end cancels future bookings before cutoff and sets ENDED", () => {
    const db = world();
    generateTrips(db, "2026-10-15");
    const { subscription } = createSubscription(db, "u1", sub({ startDate: "2026-10-15" }));
    const s = endSubscription(db, "u1", subscription.id);
    expect(s).toMatchObject({ status: "ENDED", endDate: D });
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "SUBSCRIPTION_ENDED" });
  });

  test("a daily booking blocks the subscription date silently", () => {
    const db = world();
    generateTrips(db, "2026-10-15");
    allocateSeat(db, { ...pick, userId: "u1", date: "2026-10-15", source: "DAILY", subscriptionId: null });
    const r = createSubscription(db, "u1", sub({ startDate: "2026-10-15" }));
    expect(r.booked).toEqual([]);
    expect(db.bookings).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write the failing admin test**

`packages/mock-api/test/admin.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { allocateSeat, generateTrips } from "../src/domain/allocate";
import { createSubscription } from "../src/domain/generate";
import { cancelDate, cancelTrip, changeTripBus, deactivateUser, setBusCapacity, suspendUser, unsuspendUser } from "../src/domain/admin";
import { DomainError } from "../src/db";
import { pick, world } from "./fixture";

const D = "2026-10-15";
const daily = (userId: string) => ({ ...pick, userId, date: D, source: "DAILY" as const, subscriptionId: null });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };

describe("admin actions", () => {
  test("suspend cancels future bookings with SUSPENDED, blocks daily, notifies; unsuspend re-creates subscription seats", () => {
    const db = world();
    generateTrips(db, D);
    createSubscription(db, "u1", { ...pick, startDate: D, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    suspendUser(db, "adm", "u1", "2026-10-20", "No-show 3x");
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "SUSPENDED" });
    expect(code(() => allocateSeat(db, daily("u1")))).toBe("USER_SUSPENDED");
    expect(db.notifications.some((n) => n.userId === "u1" && n.type === "SUSPENDED")).toBe(true);
    expect(db.subscriptions[0]!.status).toBe("ACTIVE");

    unsuspendUser(db, "adm", "u1");
    expect(db.bookings.filter((b) => b.userId === "u1" && b.status === "BOOKED")).toHaveLength(1);
    expect(db.audit.map((a) => a.action)).toEqual(["USER_SUSPEND", "USER_UNSUSPEND"]);
  });

  test("change bus below booked -> CAPACITY_BELOW_BOOKED, otherwise capacity follows bus and passengers notified", () => {
    const db = world();
    db.buses[0]!.capacity = 40; generateTrips(db, D);
    const trip = db.trips[0]!;
    allocateSeat(db, daily("u1")); allocateSeat(db, daily("u2"));
    expect(code(() => changeTripBus(db, "adm", trip.id, "b2"))).toBe("CAPACITY_BELOW_BOOKED"); // b2 cap 1 < 2
    changeTripBus(db, "adm", trip.id, "b3");
    expect(trip).toMatchObject({ busId: "b3", capacity: 40 });
    expect(db.notifications.filter((n) => n.type === "BUS_CHANGED")).toHaveLength(2);
  });

  test("bus capacity change applies to future scheduled trips, rejects when a trip would overflow", () => {
    const db = world();
    db.buses[0]!.capacity = 5; generateTrips(db, D);
    allocateSeat(db, daily("u1")); allocateSeat(db, daily("u2"));
    expect(code(() => setBusCapacity(db, "adm", "b1", 1))).toBe("CAPACITY_BELOW_BOOKED");
    setBusCapacity(db, "adm", "b1", 3);
    expect(db.trips.find((t) => t.busId === "b1")!.capacity).toBe(3);
  });

  test("cancel trip cancels bookings with ADMIN_TRIP ignoring cutoff; cancel date cancels all trips", () => {
    const db = world();
    generateTrips(db, D);
    allocateSeat(db, daily("u1"));
    db.now = () => new Date("2026-10-15T04:59:00+07:00"); // past cutoff
    cancelTrip(db, "adm", db.trips[0]!.id);
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "ADMIN_TRIP" });
    expect(db.notifications.some((n) => n.type === "TRIP_CANCELLED")).toBe(true);
    expect(cancelDate(db, "adm", D)).toBe(1); // only the remaining scheduled trip
    expect(db.trips.every((t) => t.status === "CANCELLED")).toBe(true);
  });

  test("deactivate cancels all future bookings, ends subscriptions, kills sessions", () => {
    const db = world();
    generateTrips(db, D);
    createSubscription(db, "u1", { ...pick, startDate: D, endDate: null, weekdays: [4] });
    db.sessions.set("tok", "u1");
    deactivateUser(db, "adm", "u1");
    expect(db.users[0]!.active).toBe(false);
    expect(db.bookings[0]).toMatchObject({ status: "CANCELLED", cancelReason: "USER_DEACTIVATED" });
    expect(db.subscriptions[0]!.status).toBe("ENDED");
    expect(db.sessions.has("tok")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @bms/mock-api test -- generate admin`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement generate.ts**

`packages/mock-api/src/domain/generate.ts`:
```ts
import { addDays, isPastCutoff, isoWeekday, type Subscription, type SubscriptionCreateResponse, type SubscriptionInput } from "@bms/shared";
import { DomainError, nextId, notify, nowIso, today, type Db } from "../db";
import { allocateSeat, cancelBooking, generateTrips, isSuspendedOn } from "./allocate";

export function subscriptionCovers(s: Subscription, date: string): boolean {
  return s.status === "ACTIVE" && date >= s.startDate && (s.endDate === null || date <= s.endDate) && s.weekdays.includes(isoWeekday(date));
}

const hasBooked = (db: Db, s: Subscription, date: string) =>
  db.bookings.some((b) => b.userId === s.userId && b.date === date && b.shiftId === s.shiftId && b.direction === s.direction && b.status === "BOOKED");

const cancelledOnPurpose = (db: Db, s: Subscription, date: string) =>
  db.bookings.some((b) => b.subscriptionId === s.id && b.date === date && (b.cancelReason === "USER" || b.cancelReason === "ADMIN_TRIP"));

/** Spec 5.2 step 2. Cron path: no cutoff check. */
export function generateSubscriptionBookings(db: Db, date: string): void {
  const subs = db.subscriptions.filter((s) => subscriptionCovers(s, date)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const s of subs) {
    const user = db.users.find((u) => u.id === s.userId)!;
    if (isSuspendedOn(user, date) || hasBooked(db, s, date) || cancelledOnPurpose(db, s, date)) continue;
    if (db.rejected.some((r) => r.subscriptionId === s.id && r.date === date)) continue;
    try {
      allocateSeat(db, { ...s, userId: s.userId, date, source: "SUBSCRIPTION", subscriptionId: s.id, fromCron: true });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      if (e.code === "TRIP_FULL") notify(db, s.userId, "SUBSCRIPTION_REJECTED", "Langganan tidak kebagian kursi", `Langganan tanggal ${date} tidak kebagian kursi. Coba booking harian.`, { date });
    }
  }
}

export function runGenerate(db: Db): void {
  for (let i = 0; i <= db.settings.generate_days_ahead; i++) {
    const date = addDays(today(db), i);
    generateTrips(db, date);
    generateSubscriptionBookings(db, date);
  }
}

const overlaps = (a: Subscription, b: SubscriptionInput) =>
  a.shiftId === b.shiftId && a.direction === b.direction &&
  (a.endDate === null || a.endDate >= b.startDate) && (b.endDate === null || b.endDate >= a.startDate) &&
  a.weekdays.some((d) => b.weekdays.includes(d));

/** Spec 5.3 create: book already-generated dates with cutoff check; later dates come from cron. */
export function createSubscription(db: Db, userId: string, input: SubscriptionInput): SubscriptionCreateResponse {
  if (db.subscriptions.some((s) => s.userId === userId && s.status === "ACTIVE" && overlaps(s, input))) {
    throw new DomainError("SCHEDULE_CONFLICT", "Langganan bentrok dengan langganan lain di shift dan arah yang sama.");
  }
  const subscription: Subscription = { id: nextId(db, "sub"), userId, ...input, status: "ACTIVE", createdAt: nowIso(db) };
  db.subscriptions.push(subscription);

  const res: SubscriptionCreateResponse = { subscription, booked: [], rejected: [], skippedCutoff: [] };
  const dates = [...new Set(db.trips
    .filter((t) => t.routeId === input.routeId && t.shiftId === input.shiftId && t.direction === input.direction)
    .map((t) => t.date))].filter((d) => subscriptionCovers(subscription, d)).sort();
  for (const date of dates) {
    try {
      allocateSeat(db, { ...input, userId, date, source: "SUBSCRIPTION", subscriptionId: subscription.id });
      res.booked.push(date);
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      if (e.code === "CUTOFF_PASSED") res.skippedCutoff.push(date);
      else if (e.code === "TRIP_FULL") res.rejected.push(date);
      else if (e.code === "USER_SUSPENDED") break;
      // SCHEDULE_CONFLICT (daily booking exists) and NOT_FOUND: skip silently
    }
  }
  return res;
}

/** Spec 5.3 end. */
export function endSubscription(db: Db, userId: string, subscriptionId: string): Subscription {
  const s = db.subscriptions.find((x) => x.id === subscriptionId && x.userId === userId);
  if (!s) throw new DomainError("NOT_FOUND");
  s.status = "ENDED";
  s.endDate = today(db);
  for (const b of db.bookings.filter((x) => x.subscriptionId === s.id && x.status === "BOOKED")) {
    const trip = db.trips.find((t) => t.id === b.tripId)!;
    if (!isPastCutoff(trip.departureAt, db.settings.booking_cutoff_minutes, db.now())) cancelBooking(db, b, "SUBSCRIPTION_ENDED", { checkCutoff: false });
  }
  return s;
}
```

- [ ] **Step 5: Implement admin.ts**

`packages/mock-api/src/domain/admin.ts`:
```ts
import { isPastCutoff } from "@bms/shared";
import { DomainError, audit, notify, today, type Db } from "../db";
import { allocateSeat, cancelBooking } from "./allocate";
import { subscriptionCovers } from "./generate";

const notDeparted = (db: Db, departureAt: string) => Date.parse(departureAt) > db.now().getTime();
const user = (db: Db, id: string) => {
  const u = db.users.find((x) => x.id === id);
  if (!u) throw new DomainError("NOT_FOUND");
  return u;
};
const futureBooked = (db: Db, userId: string) => db.bookings.filter((b) => {
  const t = db.trips.find((x) => x.id === b.tripId)!;
  return b.userId === userId && b.status === "BOOKED" && notDeparted(db, t.departureAt);
});
const passengersOf = (db: Db, tripId: string) => db.bookings.filter((b) => b.tripId === tripId && b.status === "BOOKED");

export function suspendUser(db: Db, actorId: string, userId: string, until: string, reason: string): void {
  const u = user(db, userId);
  const before = { bookingSuspendedUntil: u.bookingSuspendedUntil, suspendReason: u.suspendReason };
  u.bookingSuspendedUntil = until;
  u.suspendReason = reason;
  // Spec 5.6: every booking not past cutoff is cancelled; nightly runGenerate re-creates subscription seats after `until`.
  for (const b of futureBooked(db, userId)) {
    const t = db.trips.find((x) => x.id === b.tripId)!;
    if (!isPastCutoff(t.departureAt, db.settings.booking_cutoff_minutes, db.now())) cancelBooking(db, b, "SUSPENDED", { checkCutoff: false });
  }
  notify(db, userId, "SUSPENDED", "Booking dibekukan", `Booking kamu dibekukan sampai ${until}. Alasan: ${reason}`, { until });
  audit(db, actorId, "USER_SUSPEND", "user", userId, before, { bookingSuspendedUntil: until, suspendReason: reason });
}

/** Re-create subscription seats on already-generated dates, with cutoff check (spec 5.6). */
export function unsuspendUser(db: Db, actorId: string, userId: string): void {
  const u = user(db, userId);
  const before = { bookingSuspendedUntil: u.bookingSuspendedUntil, suspendReason: u.suspendReason };
  u.bookingSuspendedUntil = null;
  u.suspendReason = null;
  const dates = [...new Set(db.trips.map((t) => t.date))].filter((d) => d >= today(db)).sort();
  for (const s of db.subscriptions.filter((x) => x.userId === userId)) {
    for (const date of dates.filter((d) => subscriptionCovers(s, d))) {
      const purposely = db.bookings.some((b) => b.subscriptionId === s.id && b.date === date && (b.cancelReason === "USER" || b.cancelReason === "ADMIN_TRIP"));
      if (purposely) continue;
      try {
        allocateSeat(db, { ...s, userId, date, source: "SUBSCRIPTION", subscriptionId: s.id });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
      }
    }
  }
  notify(db, userId, "UNSUSPENDED", "Pembekuan dicabut", "Booking kamu aktif kembali.");
  audit(db, actorId, "USER_UNSUSPEND", "user", userId, before, { bookingSuspendedUntil: null, suspendReason: null });
}

export function deactivateUser(db: Db, actorId: string, userId: string): void {
  const u = user(db, userId);
  u.active = false;
  for (const b of futureBooked(db, userId)) cancelBooking(db, b, "USER_DEACTIVATED", { checkCutoff: false });
  for (const s of db.subscriptions.filter((x) => x.userId === userId && x.status === "ACTIVE")) {
    s.status = "ENDED";
    s.endDate = today(db);
  }
  for (const [tok, uid] of db.sessions) if (uid === userId) db.sessions.delete(tok);
  audit(db, actorId, "USER_DEACTIVATE", "user", userId, { active: true }, { active: false });
}

export function changeTripBus(db: Db, actorId: string, tripId: string, busId: string): void {
  const trip = db.trips.find((t) => t.id === tripId);
  const bus = db.buses.find((b) => b.id === busId && b.active);
  if (!trip || !bus) throw new DomainError("NOT_FOUND");
  if (bus.capacity < trip.bookedCount) throw new DomainError("CAPACITY_BELOW_BOOKED", `Bus ${bus.plate} hanya ${bus.capacity} kursi, sudah ${trip.bookedCount} booking.`);
  const before = { busId: trip.busId, capacity: trip.capacity };
  trip.busId = bus.id;
  trip.capacity = bus.capacity;
  for (const b of passengersOf(db, tripId)) notify(db, b.userId, "BUS_CHANGED", "Bus diganti", `Trip ${trip.date} sekarang memakai bus ${bus.plate}.`, { tripId });
  audit(db, actorId, "TRIP_CHANGE_BUS", "trip", tripId, before, { busId: bus.id, capacity: bus.capacity });
}

export function setBusCapacity(db: Db, actorId: string, busId: string, capacity: number): void {
  const bus = db.buses.find((b) => b.id === busId);
  if (!bus) throw new DomainError("NOT_FOUND");
  const affected = db.trips.filter((t) => t.busId === busId && t.status === "SCHEDULED" && notDeparted(db, t.departureAt));
  const bad = affected.find((t) => t.bookedCount > capacity);
  if (bad) throw new DomainError("CAPACITY_BELOW_BOOKED", `Trip ${bad.date} ${bad.departureAt.slice(11, 16)} sudah ${bad.bookedCount} booking.`);
  const before = { capacity: bus.capacity };
  bus.capacity = capacity;
  for (const t of affected) t.capacity = capacity;
  audit(db, actorId, "BUS_CAPACITY", "bus", busId, before, { capacity });
}

export function cancelTrip(db: Db, actorId: string, tripId: string): void {
  const trip = db.trips.find((t) => t.id === tripId);
  if (!trip) throw new DomainError("NOT_FOUND");
  if (trip.status === "CANCELLED") return;
  for (const b of passengersOf(db, tripId)) {
    cancelBooking(db, b, "ADMIN_TRIP", { checkCutoff: false });
    notify(db, b.userId, "TRIP_CANCELLED", "Trip dibatalkan", `Trip ${trip.date} jam ${trip.departureAt.slice(11, 16)} dibatalkan admin.`, { tripId });
  }
  trip.status = "CANCELLED";
  audit(db, actorId, "TRIP_CANCEL", "trip", tripId, { status: "SCHEDULED" }, { status: "CANCELLED" });
}

export function cancelDate(db: Db, actorId: string, date: string): number {
  const trips = db.trips.filter((t) => t.date === date && t.status === "SCHEDULED");
  for (const t of trips) cancelTrip(db, actorId, t.id);
  return trips.length;
}

// ponytail: template edits are not propagated to generated trips in the mock; backend (Plan 4) implements spec 5.6.
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @bms/mock-api test && pnpm --filter @bms/mock-api typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/mock-api
git commit -m "feat(mock-api): subscriptions, nightly generation, admin actions"
```

### Task 7: HTTP helpers, mock auth, deterministic seed

**Files:**
- Create: `packages/mock-api/src/http.ts`, `src/auth.ts`, `src/seed.ts`, `src/state.ts`
- Test: `packages/mock-api/test/auth.test.ts`, `test/seed.test.ts`

**Interfaces:**
- Consumes: Task 5 `Db`, `UserRow`, `createDb`, `DomainError`, `nextId`, `nowIso`, `today`, `audit`; Task 6 `runGenerate`; shared `ERROR_HTTP_STATUS`, `ERROR_MESSAGES`, `toJakartaIso`, `addDays`, auth schemas.
- Produces (`src/http.ts`):
  - `fail(code: ErrorCode, message?): Response` — body `{ code, message }`, status from `ERROR_HTTP_STATUS`.
  - `toErrorResponse(e: unknown): Response` — `DomainError` → its code; `ZodError` → `VALIDATION_ERROR` 400 with first issue as message; anything else rethrown.
  - `parseBody(request, schema): Promise<z.output<schema>>` — non-JSON body → `VALIDATION_ERROR`.
  - `interface Ctx { db: Db; request: Request; params: Record<string, string>; url: URL }`
  - `handle(fn: (ctx: Ctx) => unknown, opts?: { duringMaintenance?: boolean })` — MSW resolver. Returns 503 `MAINTENANCE` while `db.maintenance` unless `duringMaintenance`. `fn` returning a `Response` passes through, `undefined` → 204, anything else → JSON 200.
- Produces (`src/auth.ts`):
  - `toMe(u: UserRow): Me`, `bearer(request): string | null`, `revokeAll(db, userId): void`
  - `login(db, input: LoginRequest): LoginResponse` — both tokens in the body (mock).
  - `refresh(db, refreshToken: string): LoginResponse` — rotates (old refresh token deleted).
  - `requireUser(db, request, opts?: { roles?: readonly Role[]; allowMustChange?: boolean }): UserRow`
  - `changePassword(db, u: UserRow, input: ChangePasswordRequest): void`
  - `tempPassword(): string`, `resetPassword(db, actorId, userId): TempPassword`
  - `needsSetup(db): boolean`, `setup(db, input: SetupRequest): LoginResponse`
- Produces (`src/seed.ts`): `DEMO_PASSWORD = "demo1234"`, `createSeededDb(now?: () => Date): Db`.
- Produces (`src/state.ts`): `getDb(): Db`, `resetDb(now?: () => Date): Db`.

Rule notes for the implementer:
- Tokens: access tokens start with `at.`, refresh tokens with `rt.`. Both live in `db.sessions` (token → userId). `requireUser` accepts only `at.` tokens.
- Error precedence in `requireUser`: `UNAUTHORIZED` (no/unknown token, inactive user) → `FORBIDDEN` "Ganti password terlebih dahulu." (mustChangePassword and not `allowMustChange`) → `FORBIDDEN` (role).
- Unknown NIK, wrong password, inactive and SSO users all return the same `UNAUTHORIZED` "NIK atau password salah." so the response does not reveal which NIKs exist.
- Lockout (spec 5.8): the `login_max_failed`-th consecutive failure sets `lockedUntil = now + login_lockout_minutes` and returns `ACCOUNT_LOCKED`. While locked, even the right password returns `ACCOUNT_LOCKED`. Success resets `failedLogins` and `lockedUntil`.
- Seed demo data, used by Plan 2 screenshots and the Task 9 handler tests:
  - Routes `r1..r6` with the mockup colors. Each route has 3 stops at offsets 0/15/30.
  - Shifts `pagi` 07:00–15:00, `siang` 15:00–23:00, `malam` 23:00–07:00.
  - Each route has 2 buses: bus A runs PICKUP, bus B runs DROPOFF. R1 buses have 8 seats, R4 buses 11, every other route 50.
  - Templates per route are below, where `i` is the route index 0..5:

    | Shift | PICKUP | DROPOFF |
    |---|---|---|
    | pagi | 05:20+5i | 15:10+5i |
    | siang | 13:20+5i | 23:10+5i |
    | malam | 21:20+5i | 07:10+5i with `dayOffset 1` |

    Templates run every weekday.
  - Employees `K1001..K1090`. Employee `i` (0-based) rides route `i % 6`. Shift is pagi when `i < 60`, siang when `i < 75`, otherwise malam. Each has an ACTIVE subscription for both directions starting today.
  - Resulting states:
    - R1 pagi is full: 10 subscribers for 8 seats, so 2 rejected per direction per day.
    - R4 pagi is almost full: 10 of 11 seats.
    - `K1059` is suspended for 3 days.
    - `K1090` has `mustChangePassword`.
  - Staff accounts:
    - `admin` is SUPER_ADMIN.
    - `ga` is ADMIN_GA.
    - `vendor` is VENDOR of `v1`.
  - Every account uses `DEMO_PASSWORD`.

- [ ] **Step 1: Write the failing auth test**

`packages/mock-api/test/auth.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { changePassword, login, needsSetup, refresh, requireUser, resetPassword, setup } from "../src/auth";
import { DomainError } from "../src/db";
import { world } from "./fixture";

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as DomainError).code; } return "OK"; };
const req = (token?: string) => new Request("http://localhost/api/x", { headers: token ? { authorization: `Bearer ${token}` } : {} });
const U1 = { nik: "U1", password: "password" };

describe("login", () => {
  test("returns access + refresh token and me", () => {
    const db = world();
    const r = login(db, U1);
    expect(r.accessToken.startsWith("at.")).toBe(true);
    expect(r.refreshToken?.startsWith("rt.")).toBe(true);
    expect(r.user).toMatchObject({ id: "u1", role: "EMPLOYEE", mustChangePassword: false });
    expect(requireUser(db, req(r.accessToken)).id).toBe("u1");
  });

  test("unknown nik, wrong password, inactive, SSO -> same UNAUTHORIZED message", () => {
    const db = world();
    db.users[1]!.active = false;
    db.users[2]!.authProvider = "SSO";
    const msgs = [
      { nik: "NOPE", password: "password" }, { nik: "U1", password: "wrong" },
      { nik: "U2", password: "password" }, { nik: "U3", password: "password" },
    ].map((i) => { try { login(db, i); return "OK"; } catch (e) { return `${(e as DomainError).code}:${(e as Error).message}`; } });
    expect(new Set(msgs)).toEqual(new Set(["UNAUTHORIZED:NIK atau password salah."]));
  });

  test("locks after login_max_failed failures, unlocks after login_lockout_minutes", () => {
    const db = world();
    db.settings.login_max_failed = 3;
    const bad = { nik: "U1", password: "x" };
    expect([code(() => login(db, bad)), code(() => login(db, bad)), code(() => login(db, bad))]).toEqual(["UNAUTHORIZED", "UNAUTHORIZED", "ACCOUNT_LOCKED"]);
    expect(code(() => login(db, U1))).toBe("ACCOUNT_LOCKED");
    db.now = () => new Date("2026-10-14T00:16:00+07:00"); // default lockout 15 min
    expect(login(db, U1).user.id).toBe("u1");
    expect(db.users[0]).toMatchObject({ failedLogins: 0, lockedUntil: null });
  });

  test("refresh rotates the refresh token", () => {
    const db = world();
    const r = login(db, U1);
    const r2 = refresh(db, r.refreshToken!);
    expect(r2.refreshToken).not.toBe(r.refreshToken);
    expect(code(() => refresh(db, r.refreshToken!))).toBe("UNAUTHORIZED");
    expect(code(() => refresh(db, r.accessToken))).toBe("UNAUTHORIZED");
  });
});

describe("requireUser", () => {
  test("no token or refresh token -> UNAUTHORIZED; wrong role -> FORBIDDEN", () => {
    const db = world();
    const r = login(db, U1);
    expect(code(() => requireUser(db, req()))).toBe("UNAUTHORIZED");
    expect(code(() => requireUser(db, req(r.refreshToken)))).toBe("UNAUTHORIZED");
    expect(code(() => requireUser(db, req(r.accessToken), { roles: ["ADMIN_GA", "SUPER_ADMIN"] }))).toBe("FORBIDDEN");
  });

  test("mustChangePassword blocks everything except allowMustChange until changed", () => {
    const db = world();
    db.users[0]!.mustChangePassword = true;
    const r = login(db, U1);
    expect(code(() => requireUser(db, req(r.accessToken)))).toBe("FORBIDDEN");
    const u = requireUser(db, req(r.accessToken), { allowMustChange: true });
    changePassword(db, u, { currentPassword: "password", newPassword: "newpass99" });
    expect(requireUser(db, req(r.accessToken)).id).toBe("u1");
  });
});

describe("password management", () => {
  test("change password checks current password and password_min_length", () => {
    const db = world();
    const u = db.users[0]!;
    db.settings.password_min_length = 10;
    expect(code(() => changePassword(db, u, { currentPassword: "nope", newPassword: "longenough1" }))).toBe("VALIDATION_ERROR");
    expect(code(() => changePassword(db, u, { currentPassword: "password", newPassword: "short99" }))).toBe("VALIDATION_ERROR");
    changePassword(db, u, { currentPassword: "password", newPassword: "longenough1" });
    expect(login(db, { nik: "U1", password: "longenough1" }).user.id).toBe("u1");
  });

  test("admin reset: one-time temp password, mustChangePassword, all sessions revoked, audited", () => {
    const db = world();
    const old = login(db, U1);
    const t = resetPassword(db, "adm", "u1");
    expect(t).toMatchObject({ userId: "u1", nik: "U1" });
    expect(t.tempPassword).toHaveLength(10);
    expect(code(() => requireUser(db, req(old.accessToken)))).toBe("UNAUTHORIZED");
    expect(login(db, { nik: "U1", password: t.tempPassword }).user.mustChangePassword).toBe(true);
    expect(db.audit.at(-1)).toMatchObject({ action: "USER_RESET_PASSWORD", entityId: "u1" });
  });
});

describe("setup", () => {
  test("only while no SUPER_ADMIN exists", () => {
    const db = world();
    db.users = db.users.filter((u) => u.role !== "SUPER_ADMIN");
    expect(needsSetup(db)).toBe(true);
    const r = setup(db, { nik: "root", name: "Root", password: "rootpass1" });
    expect(r.user.role).toBe("SUPER_ADMIN");
    expect(needsSetup(db)).toBe(false);
    expect(code(() => setup(db, { nik: "root2", name: "Root 2", password: "rootpass1" }))).toBe("FORBIDDEN");
  });
});
```

- [ ] **Step 2: Write the failing seed test**

`packages/mock-api/test/seed.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { login } from "../src/auth";
import { DEMO_PASSWORD, createSeededDb } from "../src/seed";

const NOW = () => new Date("2026-10-14T00:00:00+07:00");

describe("seed", () => {
  const db = createSeededDb(NOW);
  const trip = (routeId: string, shiftId: string, direction: string, date = "2026-10-14") =>
    db.trips.find((t) => t.routeId === routeId && t.shiftId === shiftId && t.direction === direction && t.date === date)!;

  test("six colored routes, three shifts, night drop-off next day", () => {
    expect(db.routes.map((r) => [r.code, r.name, r.color])).toEqual([
      ["R1", "Cikarang", "#D6322B"], ["R2", "Bekasi Timur", "#1F6FD1"], ["R3", "Karawang", "#169B62"],
      ["R4", "Tambun", "#E07A00"], ["R5", "Cibitung", "#7A3FC2"], ["R6", "Jababeka", "#0E9AA7"],
    ]);
    expect(db.shifts.map((s) => s.name)).toEqual(["Pagi", "Siang", "Malam"]);
    expect(db.stops.filter((s) => s.routeId === "r1").map((s) => s.offsetMinutes)).toEqual([0, 15, 30]);
    expect(trip("r1", "malam", "DROPOFF").departureAt).toBe("2026-10-15T07:10:00+07:00");
    expect(trip("r2", "pagi", "PICKUP").departureAt).toBe("2026-10-14T05:25:00+07:00");
  });

  test("trips for today..today+generate_days_ahead with subscription bookings", () => {
    expect([...new Set(db.trips.map((t) => t.date))].sort()).toEqual([
      "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21",
    ]);
    expect(db.trips).toHaveLength(8 * 6 * 6);
    expect(trip("r1", "pagi", "PICKUP")).toMatchObject({ capacity: 8, bookedCount: 8 });
    expect(db.rejected.filter((r) => r.routeId === "r1" && r.date === "2026-10-14" && r.direction === "PICKUP")).toHaveLength(2);
    expect(trip("r4", "pagi", "PICKUP")).toMatchObject({ capacity: 11, bookedCount: 10 });
    expect(trip("r2", "siang", "DROPOFF").bookedCount).toBeGreaterThan(0);
  });

  test("suspended employee has no bookings during suspension", () => {
    const u = db.users.find((x) => x.nik === "K1059")!;
    expect(u.bookingSuspendedUntil).toBe("2026-10-17");
    expect(db.bookings.some((b) => b.userId === u.id && b.date <= "2026-10-17")).toBe(false);
    expect(db.bookings.some((b) => b.userId === u.id && b.date === "2026-10-18")).toBe(true);
  });

  test("demo accounts log in with DEMO_PASSWORD", () => {
    const d = createSeededDb(NOW);
    expect(["admin", "ga", "vendor", "K1001"].map((nik) => login(d, { nik, password: DEMO_PASSWORD }).user.role))
      .toEqual(["SUPER_ADMIN", "ADMIN_GA", "VENDOR", "EMPLOYEE"]);
    expect(login(d, { nik: "vendor", password: DEMO_PASSWORD }).user.vendorId).toBe("v1");
    expect(login(d, { nik: "K1090", password: DEMO_PASSWORD }).user.mustChangePassword).toBe(true);
  });

  test("deterministic", () => {
    expect(JSON.stringify(createSeededDb(NOW))).toBe(JSON.stringify(createSeededDb(NOW)));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @bms/mock-api test -- auth seed`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement http.ts and state.ts**

`packages/mock-api/src/http.ts`:
```ts
import { ERROR_HTTP_STATUS, ERROR_MESSAGES, type ErrorCode } from "@bms/shared";
import { HttpResponse, type HttpResponseResolver, type JsonBodyType } from "msw";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { DomainError, type Db } from "./db";
import { getDb } from "./state";

export const fail = (code: ErrorCode, message = ERROR_MESSAGES[code]): Response =>
  HttpResponse.json({ code, message }, { status: ERROR_HTTP_STATUS[code] });

export function toErrorResponse(e: unknown): Response {
  if (e instanceof DomainError) return fail(e.code, e.message);
  if (e instanceof ZodError) {
    const i = e.issues[0];
    return fail("VALIDATION_ERROR", i ? `${i.path.join(".") || "body"}: ${i.message}` : undefined);
  }
  throw e;
}

export async function parseBody<T extends ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new DomainError("VALIDATION_ERROR", "Body harus JSON.");
  }
  return schema.parse(raw);
}

export interface Ctx { db: Db; request: Request; params: Record<string, string>; url: URL }

/** MSW resolver wrapper: maintenance gate (spec 5.11), error mapping, JSON / 204 response. */
export function handle(fn: (ctx: Ctx) => unknown, opts: { duringMaintenance?: boolean } = {}): HttpResponseResolver {
  // Cast: MSW types resolvers as returning StrictResponse<Body>; we return plain Response for JSON, 204 and errors alike.
  return (async ({ request, params }: { request: Request; params: Record<string, unknown> }): Promise<Response> => {
    const db = getDb();
    if (db.maintenance && !opts.duringMaintenance) return fail("MAINTENANCE");
    try {
      const out = await fn({ db, request, params: params as Record<string, string>, url: new URL(request.url) });
      if (out instanceof Response) return out;
      return out === undefined ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(out as JsonBodyType);
    } catch (e) {
      return toErrorResponse(e);
    }
  }) as HttpResponseResolver;
}
```

`packages/mock-api/src/state.ts`:
```ts
import type { Db } from "./db";
import { createSeededDb } from "./seed";

let current: Db = createSeededDb();

export const getDb = (): Db => current;

/** Fresh seeded DB. Tests pass a fixed clock; the browser uses the real one. */
export function resetDb(now?: () => Date): Db {
  current = createSeededDb(now);
  return current;
}
```

- [ ] **Step 5: Implement auth.ts**

`packages/mock-api/src/auth.ts`:
```ts
import {
  toJakartaIso,
  type ChangePasswordRequest, type LoginRequest, type LoginResponse, type Me, type Role, type SetupRequest, type TempPassword,
} from "@bms/shared";
import { DomainError, audit, nextId, type Db, type UserRow } from "./db";

const BAD_LOGIN = "NIK atau password salah.";

export const toMe = (u: UserRow): Me => ({
  id: u.id, nik: u.nik, name: u.name, role: u.role, vendorId: u.vendorId, mustChangePassword: u.mustChangePassword,
  bookingSuspendedUntil: u.bookingSuspendedUntil, suspendReason: u.suspendReason,
});

export const bearer = (request: Request): string | null =>
  request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;

export function revokeAll(db: Db, userId: string): void {
  for (const [token, id] of db.sessions) if (id === userId) db.sessions.delete(token);
}

// ponytail: mock tokens never expire; access_token_minutes / refresh_token_days expiry is backend work (Plan 4).
function issue(db: Db, u: UserRow): LoginResponse {
  const accessToken = nextId(db, "at.");
  const refreshToken = nextId(db, "rt.");
  db.sessions.set(accessToken, u.id);
  db.sessions.set(refreshToken, u.id);
  return { accessToken, refreshToken, user: toMe(u) };
}

/** Spec 5.8: lockout after login_max_failed failures; SSO users cannot use a password. */
export function login(db: Db, input: LoginRequest): LoginResponse {
  const u = db.users.find((x) => x.nik === input.nik);
  if (!u || !u.active || u.authProvider === "SSO") throw new DomainError("UNAUTHORIZED", BAD_LOGIN);
  const now = db.now().getTime();
  if (u.lockedUntil && Date.parse(u.lockedUntil) > now) throw new DomainError("ACCOUNT_LOCKED");
  if (u.password !== input.password) {
    if (++u.failedLogins >= db.settings.login_max_failed) {
      u.failedLogins = 0;
      u.lockedUntil = toJakartaIso(now + db.settings.login_lockout_minutes * 60_000);
      throw new DomainError("ACCOUNT_LOCKED");
    }
    throw new DomainError("UNAUTHORIZED", BAD_LOGIN);
  }
  u.failedLogins = 0;
  u.lockedUntil = null;
  return issue(db, u);
}

export function refresh(db: Db, refreshToken: string): LoginResponse {
  const userId = refreshToken.startsWith("rt.") ? db.sessions.get(refreshToken) : undefined;
  const u = db.users.find((x) => x.id === userId && x.active);
  if (!u) throw new DomainError("UNAUTHORIZED");
  db.sessions.delete(refreshToken);
  return issue(db, u);
}

export function requireUser(db: Db, request: Request, opts: { roles?: readonly Role[]; allowMustChange?: boolean } = {}): UserRow {
  const token = bearer(request);
  const userId = token?.startsWith("at.") ? db.sessions.get(token) : undefined;
  const u = db.users.find((x) => x.id === userId);
  if (!u || !u.active) throw new DomainError("UNAUTHORIZED");
  if (u.mustChangePassword && !opts.allowMustChange) throw new DomainError("FORBIDDEN", "Ganti password terlebih dahulu.");
  if (opts.roles && !opts.roles.includes(u.role)) throw new DomainError("FORBIDDEN");
  return u;
}

export function changePassword(db: Db, u: UserRow, input: ChangePasswordRequest): void {
  if (u.password !== input.currentPassword) throw new DomainError("VALIDATION_ERROR", "Password lama salah.");
  const min = db.settings.password_min_length;
  if (input.newPassword.length < min) throw new DomainError("VALIDATION_ERROR", `Password minimal ${min} karakter.`);
  if (input.newPassword === input.currentPassword) throw new DomainError("VALIDATION_ERROR", "Password baru harus berbeda.");
  u.password = input.newPassword;
  u.mustChangePassword = false;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (i, l, o, 0, 1)
export const tempPassword = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHABET.charAt(b % ALPHABET.length)).join("");

/** Spec 5.8: temp password shown once, must change on next login, every token revoked. */
export function resetPassword(db: Db, actorId: string, userId: string): TempPassword {
  const u = db.users.find((x) => x.id === userId);
  if (!u) throw new DomainError("NOT_FOUND");
  if (u.authProvider === "SSO") throw new DomainError("VALIDATION_ERROR", "User SSO tidak memakai password.");
  const pw = tempPassword();
  u.password = pw;
  u.mustChangePassword = true;
  u.failedLogins = 0;
  u.lockedUntil = null;
  revokeAll(db, userId);
  audit(db, actorId, "USER_RESET_PASSWORD", "user", userId, null, { mustChangePassword: true });
  return { userId, nik: u.nik, tempPassword: pw };
}

export const needsSetup = (db: Db): boolean => !db.users.some((u) => u.role === "SUPER_ADMIN");

/** Spec 5.12: first SUPER_ADMIN; locked permanently once one exists. */
export function setup(db: Db, input: SetupRequest): LoginResponse {
  if (!needsSetup(db)) throw new DomainError("FORBIDDEN", "Setup awal sudah dilakukan.");
  if (db.users.some((u) => u.nik === input.nik)) throw new DomainError("VALIDATION_ERROR", "NIK sudah dipakai.");
  if (input.password.length < db.settings.password_min_length) {
    throw new DomainError("VALIDATION_ERROR", `Password minimal ${db.settings.password_min_length} karakter.`);
  }
  const u: UserRow = {
    id: nextId(db, "usr"), nik: input.nik, name: input.name, department: "", phone: "",
    role: "SUPER_ADMIN", authProvider: "LOCAL", active: true, vendorId: null,
    bookingSuspendedUntil: null, suspendReason: null, lockedUntil: null,
    password: input.password, mustChangePassword: false, failedLogins: 0,
  };
  db.users.push(u);
  audit(db, u.id, "SETUP_SUPER_ADMIN", "user", u.id, null, { nik: u.nik });
  return issue(db, u);
}
```

- [ ] **Step 6: Implement seed.ts**

`packages/mock-api/src/seed.ts`:
```ts
import { addDays, type Direction, type Role } from "@bms/shared";
import { createDb, nextId, nowIso, today, type Db, type UserRow } from "./db";
import { runGenerate } from "./domain/generate";

export const DEMO_PASSWORD = "demo1234";

const ROUTES = [
  ["R1", "Cikarang", "#D6322B", ["Terminal Cikarang", "Pasar Lemahabang", "Simpang Cibarusah"], 8],
  ["R2", "Bekasi Timur", "#1F6FD1", ["Halte Bulak Kapal", "Stasiun Bekasi Timur", "Pasar Rawalumbu"], 50],
  ["R3", "Karawang", "#169B62", ["Terminal Klari", "Alun-alun Karawang", "Galuh Mas"], 50],
  ["R4", "Tambun", "#E07A00", ["Stasiun Tambun", "Pasar Tambun", "Mangunjaya"], 11],
  ["R5", "Cibitung", "#7A3FC2", ["Stasiun Cibitung", "Pasar Cibitung", "Wanasari"], 50],
  ["R6", "Jababeka", "#0E9AA7", ["Terminal Jababeka", "Kawasan Jababeka 2", "Pasir Gombong"], 50],
] as const;

/** [shiftId, direction, hour, minute, dayOffset]; minute + 5 per route index. */
const TEMPLATES: [string, Direction, number, number, 0 | 1][] = [
  ["pagi", "PICKUP", 5, 20, 0], ["pagi", "DROPOFF", 15, 10, 0],
  ["siang", "PICKUP", 13, 20, 0], ["siang", "DROPOFF", 23, 10, 0],
  ["malam", "PICKUP", 21, 20, 0], ["malam", "DROPOFF", 7, 10, 1],
];

const NAMES = ["Rina Wulandari", "Budi Santoso", "Siti Aminah", "Agus Prasetyo", "Dewi Lestari", "Eko Saputra"];
const DEPARTMENTS = ["Produksi", "Gudang", "QC", "Maintenance"];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

function account(id: string, nik: string, name: string, role: Role, extra: Partial<UserRow> = {}): UserRow {
  return {
    id, nik, name, department: "", phone: "", role, authProvider: "LOCAL", active: true, vendorId: null,
    bookingSuspendedUntil: null, suspendReason: null, lockedUntil: null,
    password: DEMO_PASSWORD, mustChangePassword: false, failedLogins: 0, ...extra,
  };
}

/** Deterministic demo data for the mock API (same `now` gives identical output). */
export function createSeededDb(now: () => Date = () => new Date()): Db {
  const db = createDb(now);
  const day0 = today(db);
  db.vendors.push({ id: "v1", name: "PT Trans Jaya", contact: "021-555-0101", active: true }, { id: "v2", name: "CV Mitra Armada", contact: "021-555-0202", active: true });
  db.shifts.push(
    { id: "pagi", name: "Pagi", startTime: "07:00", endTime: "15:00" },
    { id: "siang", name: "Siang", startTime: "15:00", endTime: "23:00" },
    { id: "malam", name: "Malam", startTime: "23:00", endTime: "07:00" },
  );

  ROUTES.forEach(([code, name, color, stops, capacity], i) => {
    const routeId = `r${i + 1}`;
    db.routes.push({ id: routeId, code, name, color, active: true });
    stops.forEach((stop, s) => db.stops.push({ id: `${routeId}s${s + 1}`, routeId, name: stop, seq: s + 1, offsetMinutes: s * 15, lat: null, lng: null, active: true }));
    const vendorId = i < 3 ? "v1" : "v2";
    const [busA, busB] = [`b${i * 2 + 1}`, `b${i * 2 + 2}`];
    db.buses.push(
      { id: busA, plate: `B 7${i + 1}01 FX`, capacity, vendorId, active: true },
      { id: busB, plate: `B 7${i + 1}02 KR`, capacity, vendorId, active: true },
    );
    for (const [shiftId, direction, h, m, dayOffset] of TEMPLATES) {
      db.templates.push({
        id: nextId(db, "tp"), routeId, shiftId, direction, busId: direction === "PICKUP" ? busA : busB,
        departureTime: hhmm(h, m + i * 5), dayOffset, weekdays: [1, 2, 3, 4, 5, 6, 7], active: true,
      });
    }
  });

  db.users.push(
    account("admin", "admin", "Super Admin", "SUPER_ADMIN"),
    account("ga", "ga", "Admin GA", "ADMIN_GA"),
    account("vendor", "vendor", "Operator PT Trans Jaya", "VENDOR", { vendorId: "v1" }),
  );
  for (let i = 0; i < 90; i++) {
    const nik = `K${1001 + i}`;
    const u = account(nik.toLowerCase(), nik, NAMES[i] ?? `Karyawan ${nik}`, "EMPLOYEE", {
      department: DEPARTMENTS[i % DEPARTMENTS.length]!, phone: `0812000${1001 + i}`,
    });
    db.users.push(u);
    const routeId = `r${(i % 6) + 1}`;
    const shiftId = i < 60 ? "pagi" : i < 75 ? "siang" : "malam";
    for (const direction of ["PICKUP", "DROPOFF"] as const) {
      db.subscriptions.push({
        id: nextId(db, "sub"), userId: u.id, routeId, stopId: `${routeId}s${(i % 3) + 1}`, shiftId, direction,
        startDate: day0, endDate: null, weekdays: [1, 2, 3, 4, 5, 6, 7], status: "ACTIVE", createdAt: nowIso(db),
      });
    }
  }
  const suspended = db.users.find((u) => u.nik === "K1059")!;
  suspended.bookingSuspendedUntil = addDays(day0, 3);
  suspended.suspendReason = "No-show 3x dalam 30 hari";
  db.users.find((u) => u.nik === "K1090")!.mustChangePassword = true;

  runGenerate(db);
  return db;
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @bms/mock-api test && pnpm --filter @bms/mock-api typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mock-api
git commit -m "feat(mock-api): http helpers, mock auth with lockout, deterministic seed"
```

### Task 8: MSW handlers for every endpoint

**Files:**
- Create: `packages/mock-api/src/handlers/util.ts` (path helper, row-to-response mappers, query parsing, pagination, audited create/update)
- Create: `packages/mock-api/src/handlers/auth.ts`, `master.ts`, `users.ts`, `trips.ts`, `bookings.ts`, `reports.ts`, `system.ts`
- Modify: `packages/mock-api/src/index.ts` (replace `export {};`)
- Test: covered end-to-end by Task 9 (`test/handlers.test.ts`); this task ends with typecheck + the existing suite green.

**Interfaces:**
- Consumes:
  - Task 2 schemas and `ENDPOINTS`, `ADMIN_ROLES`.
  - Task 3 `addDays`, `cutoffAt`, `isPastCutoff`, `stopTime`, `departureStatus`.
  - Task 4 `Settings`, `SettingsUpdate`, `SECRET_SETTING_KEYS`, `toSettingsView`.
  - Task 5 `Db`, `UserRow`, `BookingRow`, `NotificationRow`, `nextId`, `nowIso`, `today`, `DomainError`, `notify`, `audit`, `generateTrips`, `allocateSeat`, `cancelBooking`.
  - Task 6 `createSubscription`, `endSubscription`, `suspendUser`, `unsuspendUser`, `deactivateUser`, `changeTripBus`, `setBusCapacity`, `cancelTrip`, `cancelDate`.
  - Task 7 `handle`, `parseBody`, `Ctx`, `requireUser`, `login`, `refresh`, `setup`, `needsSetup`, `changePassword`, `resetPassword`, `tempPassword`, `toMe`, `bearer`, `getDb`, `resetDb`, `createSeededDb`, `DEMO_PASSWORD`.
- Produces (exported from `@bms/mock-api`):
  - `handlers: HttpHandler[]` for `setupWorker(...handlers)` (web) and `setupServer(...handlers)` (tests, Expo).
  - `createSeededDb`, `resetDb`, `getDb`, `DEMO_PASSWORD`.
- Response shapes not covered by a named contract schema. Plan 2 API client validates these with inline Zod:
  - `POST /api/auth/refresh` and `POST /api/auth/logout` take body `{ refreshToken: string }`.
  - `POST /api/device-tokens` takes `{ token, platform: "android" | "ios" | "web" }`. `DELETE /api/device-tokens` takes `{ token }`. Both return 204.
  - `POST /api/trips/cancel-date` returns `{ cancelled: number }`.
  - `POST /api/settings/test-push` and `/test-share` return `{ ok: boolean, message: string }`.
  - `POST /api/backups/restore` returns `{ preRestore: BackupFile }`.
  - `POST /api/backups/upload` takes `multipart/form-data` with field `file`.
  - `GET /api/users` and `GET /api/audit-logs` return `Paginated(...)` with `pageSize` 50 and `?page=`.

**Rule notes (who may call what, and what the mock emulates):**
- Read access to master data (vendors, buses, shifts, routes, stops) is open to every logged-in role, because the booking screens need it. Writes are `ADMIN_ROLES` only.
- Templates, trips, passengers, users, audit log and no-show candidates are `ADMIN_ROLES` only.
- Creating, editing, resetting or deactivating an account whose role (old or new) is `SUPER_ADMIN` or `ADMIN_GA` requires `SUPER_ADMIN` (spec 6.1 "Admin user"). `ADMIN_GA` manages employees and vendor accounts.
- Departures and availability are open to every logged-in role. Departures carry no passenger names.
- Bookings and subscriptions are `EMPLOYEE` only and always scoped to the caller. Another user's booking id returns `NOT_FOUND`.
- Reports (dashboard, occupancy, rejected) are `ADMIN_ROLES` + `VENDOR`. `backupWarning` is only filled for `SUPER_ADMIN`.
- Settings, backups and restore are `SUPER_ADMIN` only.
- `GET /api/system/status` needs no login and is the only route served during maintenance.
- Deactivation guards (spec 5.6) return `VALIDATION_ERROR` with the reason:
  - A bus or route cannot be deactivated while an active template or a not-yet-departed `SCHEDULED` trip uses it.
  - A stop cannot be deactivated while an `ACTIVE` subscription or a not-yet-departed `BOOKED` booking uses it.
- There is no DELETE for master data. Records are deactivated with `PUT … { active: false }` so history stays intact.
- Every admin write calls `audit()`. Settings audit writes `***` for secret keys.
- Import (spec 5.9):
  - Rows are numbered as Excel rows, so the header is row 1 and data starts at row 2.
  - Numeric cells are converted to strings first, because SheetJS reads NIKs as numbers.
  - A NIK that appears twice in the file is an error, and so is a NIK that belongs to a non-employee account.
  - Commit applies the valid rows and skips the error rows the preview already showed.
  - Employees missing from the file are left untouched.
- Restore (spec 5.11), in order:
  1. The body must carry `confirm: "RESTORE"` (schema), then the caller's own password is checked. A wrong password returns `VALIDATION_ERROR`, not `UNAUTHORIZED`, so the client does not log out.
  2. The file must exist and end in `.dump`. Uploads are checked for the `PGDMP` magic header, so a corrupt file never reaches the list.
  3. Create the `pre-restore-<timestamp>.dump` backup.
  4. Revoke every session, then write the audit entry.
  - The mock keeps its in-memory data as is. The swap is instant, so it skips the maintenance flag; the 503 gate itself is tested by setting `getDb().maintenance = true`.
- Every path is registered as `*` + the `ENDPOINTS` path, so one handler matches any origin (Vite dev server, `http://localhost` in Node tests, the Expo dev URL).
- `ENDPOINTS.backupDownload(":name")` would URL-encode the colon, so that one handler uses the literal `"/api/backups/:name/download"`.
- Not emulated (backend, Plan 4):
  - login rate limit per IP
  - device token storage (the endpoints validate and return 204)
  - marking no-shows (attendance, sub-project B), so `no-show-candidates` is empty on seed data
  - template edits propagating to generated trips
  - real `pg_dump`/`pg_restore`
  - backup retention
  - FCM delivery

- [ ] **Step 1: Write handlers/util.ts**

`packages/mock-api/src/handlers/util.ts`:
```ts
import {
  cutoffAt, departureStatus, stopTime,
  type Booking, type Departure, type Passenger, type UserSummary,
} from "@bms/shared";
import { DomainError, audit, nextId, type BookingRow, type Db, type UserRow } from "../db";

/** Match any origin: Vite dev server, http://localhost in tests, Expo dev URL. */
export const p = (path: string) => `*${path}`;

export function find<T extends { id: string }>(rows: T[], id: string | undefined): T {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new DomainError("NOT_FOUND");
  return row;
}

export const q = (url: URL, key: string): string | null => url.searchParams.get(key) || null;

export function paginate<T>(rows: T[], url: URL, pageSize = 50) {
  const page = Math.max(1, Number(q(url, "page") ?? 1) || 1);
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** Audited insert for master data. */
export function insert<T extends { id: string }>(db: Db, actorId: string, rows: T[], prefix: string, entity: string, input: Omit<T, "id">): T {
  const row = { id: nextId(db, prefix), ...input } as T;
  rows.push(row);
  audit(db, actorId, `${entity.toUpperCase()}_CREATE`, entity, row.id, null, row);
  return row;
}

/** Audited in-place update; `before` is a shallow copy taken first. */
export function update<T extends { id: string }>(db: Db, actorId: string, row: T, entity: string, input: Partial<T>): T {
  const before = { ...row };
  Object.assign(row, input);
  audit(db, actorId, `${entity.toUpperCase()}_UPDATE`, entity, row.id, before, row);
  return row;
}

export const toSummary = ({ password: _p, mustChangePassword: _m, failedLogins: _f, ...u }: UserRow): UserSummary => u;

export const notDeparted = (db: Db, departureAt: string) => Date.parse(departureAt) > db.now().getTime();

/** Ticket card view (contract `Booking`). */
export function toBooking(db: Db, b: BookingRow): Booking {
  const trip = find(db.trips, b.tripId);
  const route = find(db.routes, trip.routeId);
  const stop = find(db.stops, b.stopId);
  const lastOffset = Math.max(...db.stops.filter((s) => s.routeId === route.id).map((s) => s.offsetMinutes));
  return {
    ...b,
    routeCode: route.code, routeName: route.name, routeColor: route.color, stopName: stop.name,
    busPlate: find(db.buses, trip.busId).plate, departureAt: trip.departureAt,
    pickupAt: stopTime(trip.departureAt, trip.direction, stop.offsetMinutes, lastOffset),
    cutoffAt: cutoffAt(trip.departureAt, db.settings.booking_cutoff_minutes),
    seatsLeft: trip.capacity - trip.bookedCount, capacity: trip.capacity,
  };
}

/** Manifest row (contract `Passenger`). */
export function toPassenger(db: Db, b: BookingRow): Passenger {
  const view = toBooking(db, b);
  const u = find(db.users, b.userId);
  const stop = find(db.stops, b.stopId);
  return { bookingId: b.id, nik: u.nik, name: u.name, department: u.department, phone: u.phone, stopName: stop.name, stopSeq: stop.seq, pickupAt: view.pickupAt };
}

/** Departure board row. `mine` = caller holds a BOOKED seat on it. No passenger data. */
export function toDeparture(db: Db, tripId: string, userId: string): Departure {
  const t = find(db.trips, tripId);
  const route = find(db.routes, t.routeId);
  return {
    tripId: t.id, date: t.date, departureAt: t.departureAt, direction: t.direction,
    routeId: route.id, routeCode: route.code, routeName: route.name, routeColor: route.color,
    shiftId: t.shiftId, shiftName: find(db.shifts, t.shiftId).name, busPlate: find(db.buses, t.busId).plate,
    capacity: t.capacity, bookedCount: t.bookedCount, status: departureStatus(t.status, t.capacity, t.bookedCount),
    mine: db.bookings.some((b) => b.tripId === t.id && b.userId === userId && b.status === "BOOKED"),
  };
}
```

- [ ] **Step 2: Write handlers/auth.ts**

`packages/mock-api/src/handlers/auth.ts`:
```ts
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
    requireUser(db, request, { allowMustChange: true });
    await parseBody(request, DeviceToken.pick({ token: true }));
  })),
];
```

- [ ] **Step 3: Write handlers/master.ts**

PUT takes the full input (the web form sends the whole record), same schema as POST.

`packages/mock-api/src/handlers/master.ts`:
```ts
import { ADMIN_ROLES, BusInput, ENDPOINTS, RouteInput, ShiftInput, StopInput, VendorInput } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, type Db } from "../db";
import { setBusCapacity } from "../domain/admin";
import { handle, parseBody, type Ctx } from "../http";
import { find, insert, notDeparted, p, update } from "./util";

const admin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
const reader = (ctx: Ctx) => requireUser(ctx.db, ctx.request);
const reject = (message: string) => { throw new DomainError("VALIDATION_ERROR", message); };

const inUseByTrips = (db: Db, key: "busId" | "routeId", id: string) =>
  db.templates.some((t) => t.active && t[key] === id) ||
  db.trips.some((t) => t[key] === id && t.status === "SCHEDULED" && notDeparted(db, t.departureAt));

function checkBus(db: Db, input: BusInput, id: string | null) {
  find(db.vendors, input.vendorId);
  if (db.buses.some((b) => b.plate === input.plate && b.id !== id)) reject(`Plat ${input.plate} sudah terdaftar.`);
}

export const masterHandlers = [
  http.get(p(ENDPOINTS.vendors), handle((ctx) => (reader(ctx), ctx.db.vendors))),
  http.post(p(ENDPOINTS.vendors), handle(async (ctx) => {
    const u = admin(ctx);
    return insert(ctx.db, u.id, ctx.db.vendors, "v", "vendor", await parseBody(ctx.request, VendorInput));
  })),
  http.put(p(ENDPOINTS.vendor(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.vendors, ctx.params.id);
    const input = await parseBody(ctx.request, VendorInput);
    if (!input.active && ctx.db.buses.some((b) => b.vendorId === row.id && b.active)) reject("Vendor masih punya bus aktif.");
    return update(ctx.db, u.id, row, "vendor", input);
  })),

  http.get(p(ENDPOINTS.buses), handle((ctx) => (reader(ctx), ctx.db.buses))),
  http.post(p(ENDPOINTS.buses), handle(async (ctx) => {
    const u = admin(ctx);
    const input = await parseBody(ctx.request, BusInput);
    checkBus(ctx.db, input, null);
    return insert(ctx.db, u.id, ctx.db.buses, "b", "bus", input);
  })),
  http.put(p(ENDPOINTS.bus(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.buses, ctx.params.id);
    const input = await parseBody(ctx.request, BusInput);
    checkBus(ctx.db, input, row.id);
    if (row.active && !input.active && inUseByTrips(ctx.db, "busId", row.id)) reject("Bus masih dipakai template aktif atau trip yang belum berangkat.");
    // Capacity goes through the domain rule so scheduled trips follow and CAPACITY_BELOW_BOOKED is enforced.
    if (input.capacity !== row.capacity) setBusCapacity(ctx.db, u.id, row.id, input.capacity);
    return update(ctx.db, u.id, row, "bus", input);
  })),

  http.get(p(ENDPOINTS.shifts), handle((ctx) => (reader(ctx), ctx.db.shifts))),
  http.post(p(ENDPOINTS.shifts), handle(async (ctx) => {
    const u = admin(ctx);
    return insert(ctx.db, u.id, ctx.db.shifts, "sh", "shift", await parseBody(ctx.request, ShiftInput));
  })),
  http.put(p(ENDPOINTS.shift(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    return update(ctx.db, u.id, find(ctx.db.shifts, ctx.params.id), "shift", await parseBody(ctx.request, ShiftInput));
  })),

  http.get(p(ENDPOINTS.routes), handle((ctx) => (reader(ctx), ctx.db.routes))),
  http.post(p(ENDPOINTS.routes), handle(async (ctx) => {
    const u = admin(ctx);
    const input = await parseBody(ctx.request, RouteInput);
    if (ctx.db.routes.some((r) => r.code === input.code)) reject(`Kode rute ${input.code} sudah dipakai.`);
    return insert(ctx.db, u.id, ctx.db.routes, "r", "route", input);
  })),
  http.put(p(ENDPOINTS.route(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.routes, ctx.params.id);
    const input = await parseBody(ctx.request, RouteInput);
    if (ctx.db.routes.some((r) => r.code === input.code && r.id !== row.id)) reject(`Kode rute ${input.code} sudah dipakai.`);
    if (row.active && !input.active && inUseByTrips(ctx.db, "routeId", row.id)) reject("Rute masih dipakai template aktif atau trip yang belum berangkat.");
    return update(ctx.db, u.id, row, "route", input);
  })),

  http.get(p(ENDPOINTS.routeStops(":routeId")), handle((ctx) => {
    reader(ctx);
    find(ctx.db.routes, ctx.params.routeId);
    return ctx.db.stops.filter((s) => s.routeId === ctx.params.routeId).sort((a, b) => a.seq - b.seq);
  })),
  http.post(p(ENDPOINTS.routeStops(":routeId")), handle(async (ctx) => {
    const u = admin(ctx);
    const route = find(ctx.db.routes, ctx.params.routeId);
    return insert(ctx.db, u.id, ctx.db.stops, "s", "stop", { ...(await parseBody(ctx.request, StopInput)), routeId: route.id });
  })),
  http.put(p(ENDPOINTS.stop(":routeId", ":stopId")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.stops, ctx.params.stopId);
    if (row.routeId !== ctx.params.routeId) throw new DomainError("NOT_FOUND");
    const input = await parseBody(ctx.request, StopInput);
    const db = ctx.db;
    const used = db.subscriptions.some((s) => s.stopId === row.id && s.status === "ACTIVE") ||
      db.bookings.some((b) => b.stopId === row.id && b.status === "BOOKED" && notDeparted(db, find(db.trips, b.tripId).departureAt));
    if (row.active && !input.active && used) reject("Titik jemput masih dipakai langganan aktif atau booking yang belum berangkat.");
    return update(db, u.id, row, "stop", input);
  })),
];
```

- [ ] **Step 4: Write handlers/users.ts**

`packages/mock-api/src/handlers/users.ts`:
```ts
import { ADMIN_ROLES, ENDPOINTS, ImportRequest, ImportRow, SuspendRequest, UserInput, type ImportPreview, type Role, type TempPassword } from "@bms/shared";
import { http } from "msw";
import { requireUser, resetPassword, tempPassword } from "../auth";
import { DomainError, audit, nextId, type Db, type UserRow } from "../db";
import { deactivateUser, suspendUser, unsuspendUser } from "../domain/admin";
import { handle, parseBody, type Ctx } from "../http";
import { find, p, paginate, q, toBooking, toSummary } from "./util";

const isAdminRole = (r: Role) => ADMIN_ROLES.includes(r);

/** Spec 6.1: only SUPER_ADMIN touches admin accounts (old or new role). */
function actor(ctx: Ctx, ...roles: Role[]): UserRow {
  const u = requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
  if (roles.some(isAdminRole) && u.role !== "SUPER_ADMIN") throw new DomainError("FORBIDDEN", "Hanya Super Admin yang boleh mengelola akun admin.");
  return u;
}

/** Auth first, so a stranger probing ids gets UNAUTHORIZED/FORBIDDEN, never NOT_FOUND. */
function target(ctx: Ctx): UserRow {
  requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
  return find(ctx.db.users, ctx.params.id);
}

function checkVendor(db: Db, input: UserInput) {
  if (input.vendorId) find(db.vendors, input.vendorId);
}

/** Spec 5.9 preview: Excel row numbers (header = row 1), numeric cells to string, NIK matched to existing users. */
function preview(db: Db, rows: unknown[]): ImportPreview & { valid: ImportRow[] } {
  const out: ImportPreview & { valid: ImportRow[] } = { created: [], updated: [], errors: [], valid: [] };
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const row = i + 2;
    const cells = typeof raw === "object" && raw !== null
      ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "number" ? String(v) : v]))
      : raw;
    const parsed = ImportRow.safeParse(cells);
    if (!parsed.success) return void out.errors.push({ row, message: parsed.error.issues[0]!.message });
    const r = parsed.data;
    if (seen.has(r.nik)) return void out.errors.push({ row, message: `NIK ${r.nik} ganda di file` });
    seen.add(r.nik);
    const existing = db.users.find((u) => u.nik === r.nik);
    if (existing && existing.role !== "EMPLOYEE") return void out.errors.push({ row, message: `NIK ${r.nik} milik akun non-karyawan` });
    (existing ? out.updated : out.created).push(r);
    out.valid.push(r);
  });
  return out;
}

const newUser = (db: Db, input: Omit<UserRow, "id" | "authProvider" | "active" | "bookingSuspendedUntil" | "suspendReason" | "lockedUntil" | "mustChangePassword" | "failedLogins">): UserRow => ({
  id: nextId(db, "usr"), authProvider: "LOCAL", active: true, bookingSuspendedUntil: null, suspendReason: null,
  lockedUntil: null, mustChangePassword: true, failedLogins: 0, ...input,
});

export const userHandlers = [
  http.get(p(ENDPOINTS.users), handle((ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const term = q(ctx.url, "q")?.toLowerCase();
    const role = q(ctx.url, "role");
    const rows = ctx.db.users
      .filter((u) => (!role || u.role === role) && (!term || u.nik.toLowerCase().includes(term) || u.name.toLowerCase().includes(term)))
      .sort((a, b) => a.nik.localeCompare(b.nik))
      .map(toSummary);
    return paginate(rows, ctx.url);
  })),
  http.post(p(ENDPOINTS.users), handle(async (ctx) => {
    actor(ctx); // auth before body validation
    const input = await parseBody(ctx.request, UserInput);
    const u = actor(ctx, input.role);
    checkVendor(ctx.db, input);
    if (ctx.db.users.some((x) => x.nik === input.nik)) throw new DomainError("VALIDATION_ERROR", `NIK ${input.nik} sudah terdaftar.`);
    const pw = tempPassword();
    const row = newUser(ctx.db, { ...input, password: pw });
    ctx.db.users.push(row);
    audit(ctx.db, u.id, "USER_CREATE", "user", row.id, null, toSummary(row));
    return { userId: row.id, nik: row.nik, tempPassword: pw } satisfies TempPassword;
  })),
  http.put(p(ENDPOINTS.user(":id")), handle(async (ctx) => {
    const row = target(ctx);
    actor(ctx, row.role);
    const input = await parseBody(ctx.request, UserInput);
    const u = actor(ctx, row.role, input.role);
    checkVendor(ctx.db, input);
    if (ctx.db.users.some((x) => x.nik === input.nik && x.id !== row.id)) throw new DomainError("VALIDATION_ERROR", `NIK ${input.nik} sudah terdaftar.`);
    if (row.id === u.id && input.role !== row.role) throw new DomainError("VALIDATION_ERROR", "Tidak bisa mengubah role akun sendiri.");
    const before = toSummary(row);
    Object.assign(row, input);
    audit(ctx.db, u.id, "USER_UPDATE", "user", row.id, before, toSummary(row));
    return toSummary(row);
  })),
  http.post(p(ENDPOINTS.userResetPassword(":id")), handle((ctx) => {
    const row = target(ctx);
    return resetPassword(ctx.db, actor(ctx, row.role).id, row.id);
  })),
  http.post(p(ENDPOINTS.userSuspend(":id")), handle(async (ctx) => {
    const row = target(ctx);
    const u = actor(ctx, row.role);
    if (row.role !== "EMPLOYEE") throw new DomainError("VALIDATION_ERROR", "Pembekuan booking hanya untuk karyawan.");
    const { until, reason } = await parseBody(ctx.request, SuspendRequest);
    suspendUser(ctx.db, u.id, row.id, until, reason);
    return toSummary(row);
  })),
  http.post(p(ENDPOINTS.userUnsuspend(":id")), handle((ctx) => {
    const row = target(ctx);
    unsuspendUser(ctx.db, actor(ctx, row.role).id, row.id);
    return toSummary(row);
  })),
  http.post(p(ENDPOINTS.userDeactivate(":id")), handle((ctx) => {
    const row = target(ctx);
    const u = actor(ctx, row.role);
    if (row.id === u.id) throw new DomainError("VALIDATION_ERROR", "Tidak bisa menonaktifkan akun sendiri.");
    deactivateUser(ctx.db, u.id, row.id);
    return toSummary(row);
  })),
  http.get(p(ENDPOINTS.userBookings(":id")), handle((ctx) => {
    const row = target(ctx);
    return ctx.db.bookings
      .filter((b) => b.userId === row.id)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((b) => toBooking(ctx.db, b));
  })),

  http.post(p(ENDPOINTS.importPreview), handle(async (ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const { valid: _v, ...out } = preview(ctx.db, (await parseBody(ctx.request, ImportRequest)).rows);
    return out;
  })),
  http.post(p(ENDPOINTS.importCommit), handle(async (ctx) => {
    const u = requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const { valid, created, updated, errors } = preview(ctx.db, (await parseBody(ctx.request, ImportRequest)).rows);
    const passwords: TempPassword[] = [];
    for (const r of valid) {
      const existing = ctx.db.users.find((x) => x.nik === r.nik);
      if (existing) {
        Object.assign(existing, r);
        continue;
      }
      const pw = tempPassword();
      const row = newUser(ctx.db, { ...r, role: "EMPLOYEE", vendorId: null, password: pw });
      ctx.db.users.push(row);
      passwords.push({ userId: row.id, nik: row.nik, tempPassword: pw });
    }
    audit(ctx.db, u.id, "USER_IMPORT", "user", "-", null, { created: created.length, updated: updated.length, errors: errors.length });
    return { passwords };
  })),
];
```

- [ ] **Step 5: Write handlers/trips.ts**

`packages/mock-api/src/handlers/trips.ts`:
```ts
import {
  ADMIN_ROLES, CancelDateRequest, ChangeBusRequest, Direction, ENDPOINTS, Id, IsoDate, TripTemplateInput,
  cutoffAt, isPastCutoff, type Availability,
} from "@bms/shared";
import { http } from "msw";
import { z } from "zod";
import { requireUser } from "../auth";
import { DomainError, audit, nextId, today, type Db } from "../db";
import { generateTrips } from "../domain/allocate";
import { cancelDate, cancelTrip, changeTripBus } from "../domain/admin";
import { handle, parseBody, type Ctx } from "../http";
import { find, p, q, toDeparture, toPassenger } from "./util";

const admin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
const dateParam = (ctx: Ctx) => IsoDate.parse(q(ctx.url, "date") ?? today(ctx.db));
const AvailabilityQuery = z.object({ routeId: Id, shiftId: Id, direction: Direction, date: IsoDate });

function checkTemplate(db: Db, t: TripTemplateInput) {
  find(db.routes, t.routeId);
  find(db.shifts, t.shiftId);
  if (!find(db.buses, t.busId).active) throw new DomainError("VALIDATION_ERROR", "Bus tidak aktif.");
}

/** New template also fills dates the nightly job already generated (spec 5.2). */
function fillGeneratedDates(db: Db) {
  for (const date of new Set(db.trips.map((t) => t.date).filter((d) => d >= today(db)))) generateTrips(db, date);
}

export const tripHandlers = [
  http.get(p(ENDPOINTS.templates), handle((ctx) => (admin(ctx), ctx.db.templates))),
  http.post(p(ENDPOINTS.templates), handle(async (ctx) => {
    const u = admin(ctx);
    const input = await parseBody(ctx.request, TripTemplateInput);
    checkTemplate(ctx.db, input);
    const row = { id: nextId(ctx.db, "tp"), ...input };
    ctx.db.templates.push(row);
    audit(ctx.db, u.id, "TEMPLATE_CREATE", "template", row.id, null, row);
    fillGeneratedDates(ctx.db);
    return row;
  })),
  http.put(p(ENDPOINTS.template(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    const row = find(ctx.db.templates, ctx.params.id);
    const input = await parseBody(ctx.request, TripTemplateInput);
    checkTemplate(ctx.db, input);
    const before = { ...row };
    Object.assign(row, input);
    audit(ctx.db, u.id, "TEMPLATE_UPDATE", "template", row.id, before, row);
    // ponytail: edits apply to dates generated from now on; propagation to existing trips is backend work (Plan 4).
    fillGeneratedDates(ctx.db);
    return row;
  })),

  http.get(p(ENDPOINTS.trips), handle((ctx) => {
    admin(ctx);
    const date = dateParam(ctx);
    const routeId = q(ctx.url, "routeId");
    const shiftId = q(ctx.url, "shiftId");
    return ctx.db.trips
      .filter((t) => t.date === date && (!routeId || t.routeId === routeId) && (!shiftId || t.shiftId === shiftId))
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt) || a.id.localeCompare(b.id));
  })),
  http.put(p(ENDPOINTS.tripBus(":id")), handle(async (ctx) => {
    const u = admin(ctx);
    changeTripBus(ctx.db, u.id, find(ctx.db.trips, ctx.params.id).id, (await parseBody(ctx.request, ChangeBusRequest)).busId);
    return find(ctx.db.trips, ctx.params.id);
  })),
  http.post(p(ENDPOINTS.tripCancel(":id")), handle((ctx) => {
    const u = admin(ctx);
    cancelTrip(ctx.db, u.id, find(ctx.db.trips, ctx.params.id).id);
    return find(ctx.db.trips, ctx.params.id);
  })),
  http.post(p(ENDPOINTS.tripsCancelDate), handle(async (ctx) => {
    const u = admin(ctx);
    return { cancelled: cancelDate(ctx.db, u.id, (await parseBody(ctx.request, CancelDateRequest)).date) };
  })),
  http.get(p(ENDPOINTS.tripPassengers(":id")), handle((ctx) => {
    admin(ctx);
    const trip = find(ctx.db.trips, ctx.params.id);
    return ctx.db.bookings
      .filter((b) => b.tripId === trip.id && b.status !== "CANCELLED")
      .map((b) => toPassenger(ctx.db, b))
      .sort((a, b) => a.stopSeq - b.stopSeq || a.name.localeCompare(b.name));
  })),

  /** Spec 6.2/6.3 departure board: every role, no passenger names. */
  http.get(p(ENDPOINTS.departures), handle((ctx) => {
    const u = requireUser(ctx.db, ctx.request);
    const date = dateParam(ctx);
    return ctx.db.trips
      .filter((t) => t.date === date)
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt) || a.id.localeCompare(b.id))
      .map((t) => toDeparture(ctx.db, t.id, u.id));
  })),

  /** Spec 5.4: seats for one combo. bookable mirrors allocateSeat: an open (pre-cutoff) trip with a free seat. */
  http.get(p(ENDPOINTS.availability), handle((ctx) => {
    requireUser(ctx.db, ctx.request);
    const f = AvailabilityQuery.parse(Object.fromEntries(ctx.url.searchParams));
    const db = ctx.db;
    const min = db.settings.booking_cutoff_minutes;
    const trips = db.trips
      .filter((t) => t.routeId === f.routeId && t.shiftId === f.shiftId && t.direction === f.direction && t.date === f.date && t.status === "SCHEDULED")
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
    const first = trips[0]?.departureAt ?? null;
    return {
      ...f,
      capacity: trips.reduce((n, t) => n + t.capacity, 0),
      bookedCount: trips.reduce((n, t) => n + t.bookedCount, 0),
      firstDepartureAt: first,
      cutoffAt: first && cutoffAt(first, min),
      bookable: trips.some((t) => t.bookedCount < t.capacity && !isPastCutoff(t.departureAt, min, db.now())),
    } satisfies Availability;
  })),
];
```

- [ ] **Step 6: Write handlers/bookings.ts**

`packages/mock-api/src/handlers/bookings.ts`:
```ts
import { DailyBookingRequest, ENDPOINTS, SubscriptionInput } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, today } from "../db";
import { allocateSeat, cancelBooking } from "../domain/allocate";
import { createSubscription, endSubscription } from "../domain/generate";
import { handle, parseBody, type Ctx } from "../http";
import { p, q, toBooking } from "./util";

const employee = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ["EMPLOYEE"] });

export const bookingHandlers = [
  http.get(p(ENDPOINTS.myBookings), handle((ctx) => {
    const u = employee(ctx);
    const from = q(ctx.url, "from");
    const to = q(ctx.url, "to");
    return ctx.db.bookings
      .filter((b) => b.userId === u.id && (!from || b.date >= from) && (!to || b.date <= to))
      .map((b) => toBooking(ctx.db, b))
      .sort((a, b) => a.departureAt.localeCompare(b.departureAt));
  })),
  http.post(p(ENDPOINTS.bookings), handle(async (ctx) => {
    const u = employee(ctx);
    const input = await parseBody(ctx.request, DailyBookingRequest);
    return toBooking(ctx.db, allocateSeat(ctx.db, { ...input, userId: u.id, source: "DAILY", subscriptionId: null }));
  })),
  http.post(p(ENDPOINTS.bookingCancel(":id")), handle((ctx) => {
    const u = employee(ctx);
    const b = ctx.db.bookings.find((x) => x.id === ctx.params.id && x.userId === u.id);
    if (!b) throw new DomainError("NOT_FOUND");
    if (b.status !== "BOOKED") throw new DomainError("VALIDATION_ERROR", "Booking sudah tidak aktif.");
    cancelBooking(ctx.db, b, "USER", { checkCutoff: true });
    return toBooking(ctx.db, b);
  })),

  http.get(p(ENDPOINTS.mySubscriptions), handle((ctx) => {
    const u = employee(ctx);
    return ctx.db.subscriptions.filter((s) => s.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  })),
  http.post(p(ENDPOINTS.subscriptions), handle(async (ctx) => {
    const u = employee(ctx);
    const input = await parseBody(ctx.request, SubscriptionInput);
    const stop = ctx.db.stops.find((s) => s.id === input.stopId);
    if (!stop || stop.routeId !== input.routeId || !stop.active) throw new DomainError("VALIDATION_ERROR", "Titik jemput tidak valid untuk rute ini.");
    if (input.startDate < today(ctx.db)) throw new DomainError("VALIDATION_ERROR", "Tanggal mulai sudah lewat.");
    return createSubscription(ctx.db, u.id, input);
  })),
  http.post(p(ENDPOINTS.subscriptionEnd(":id")), handle((ctx) => {
    const u = employee(ctx);
    return endSubscription(ctx.db, u.id, ctx.params.id!);
  })),
];
```

- [ ] **Step 7: Write handlers/reports.ts**

Occupancy and rejected take `?from&to` (default today..today). Notifications and audit live here too: both are read-only lists.

`packages/mock-api/src/handlers/reports.ts`:
```ts
import { ADMIN_ROLES, ENDPOINTS, IsoDate, addDays, type DashboardSummary, type NoShowCandidate, type OccupancyRow } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, nowIso, today, type Db } from "../db";
import { handle, type Ctx } from "../http";
import { find, p, paginate, q } from "./util";

const viewer = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: [...ADMIN_ROLES, "VENDOR"] });

function range(ctx: Ctx) {
  const from = IsoDate.parse(q(ctx.url, "from") ?? today(ctx.db));
  const to = IsoDate.parse(q(ctx.url, "to") ?? from);
  if (to < from) throw new DomainError("VALIDATION_ERROR", "Tanggal akhir sebelum tanggal mulai.");
  return { from, to };
}

/** Spec 5.11: share copy failure shows on the Super Admin dashboard. */
function backupWarning(db: Db): string | null {
  const last = [...db.backups].filter((b) => !b.name.startsWith("pre-restore-")).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!last) return "Belum ada backup.";
  if (db.settings.backup_share_enabled && !last.copiedToShare) return `Backup ${last.name} gagal disalin ke network share.`;
  return null;
}

function occupancy(db: Db, from: string, to: string): OccupancyRow[] {
  const rows = new Map<string, OccupancyRow>();
  for (const t of db.trips) {
    if (t.date < from || t.date > to || t.status !== "SCHEDULED") continue;
    const key = `${t.date}|${t.routeId}|${t.shiftId}|${t.direction}`;
    let row = rows.get(key);
    if (!row) {
      const route = find(db.routes, t.routeId);
      row = {
        date: t.date, routeId: route.id, routeCode: route.code, routeName: route.name, routeColor: route.color,
        shiftId: t.shiftId, shiftName: find(db.shifts, t.shiftId).name, direction: t.direction,
        trips: 0, capacity: 0, booked: 0,
        rejected: db.rejected.filter((r) => r.date === t.date && r.routeId === t.routeId && r.shiftId === t.shiftId && r.direction === t.direction).length,
      };
      rows.set(key, row);
    }
    row.trips++;
    row.capacity += t.capacity;
    row.booked += t.bookedCount;
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.routeCode.localeCompare(b.routeCode) || a.shiftId.localeCompare(b.shiftId) || a.direction.localeCompare(b.direction));
}

export const reportHandlers = [
  http.get(p(ENDPOINTS.dashboard), handle((ctx) => {
    const u = viewer(ctx);
    const db = ctx.db;
    const date = IsoDate.parse(q(ctx.url, "date") ?? today(db));
    const trips = db.trips.filter((t) => t.date === date && t.status === "SCHEDULED");
    const rejectedOn = (d: string) => db.rejected.filter((r) => r.date === d).length;
    return {
      date,
      trips: trips.length,
      capacity: trips.reduce((n, t) => n + t.capacity, 0),
      booked: trips.reduce((n, t) => n + t.bookedCount, 0),
      fullTrips: trips.filter((t) => t.bookedCount >= t.capacity).length,
      rejectedToday: rejectedOn(date),
      rejectedYesterday: rejectedOn(addDays(date, -1)),
      rejectedLast7: Array.from({ length: 7 }, (_, i) => addDays(date, i - 6)).map((d) => ({ date: d, count: rejectedOn(d) })),
      backupWarning: u.role === "SUPER_ADMIN" ? backupWarning(db) : null,
    } satisfies DashboardSummary;
  })),
  http.get(p(ENDPOINTS.occupancy), handle((ctx) => {
    viewer(ctx);
    const { from, to } = range(ctx);
    return occupancy(ctx.db, from, to);
  })),
  http.get(p(ENDPOINTS.rejected), handle((ctx) => {
    viewer(ctx);
    const { from, to } = range(ctx);
    return ctx.db.rejected.filter((r) => r.date >= from && r.date <= to).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  })),
  /** NO_SHOW is marked by attendance (sub-project B); the list is ready for when it exists. */
  http.get(p(ENDPOINTS.noShowCandidates), handle((ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const since = addDays(today(ctx.db), -30);
    const counts = new Map<string, number>();
    for (const b of ctx.db.bookings) if (b.status === "NO_SHOW" && b.date >= since) counts.set(b.userId, (counts.get(b.userId) ?? 0) + 1);
    return [...counts].map(([userId, noShows30d]): NoShowCandidate => {
      const u = find(ctx.db.users, userId);
      return { userId, nik: u.nik, name: u.name, noShows30d };
    }).sort((a, b) => b.noShows30d - a.noShows30d);
  })),

  http.get(p(ENDPOINTS.notifications), handle((ctx) => {
    const u = requireUser(ctx.db, ctx.request);
    return ctx.db.notifications
      .filter((n) => n.userId === u.id)
      .map(({ userId: _u, ...n }) => n)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  })),
  http.post(p(ENDPOINTS.notificationRead(":id")), handle((ctx) => {
    const u = requireUser(ctx.db, ctx.request);
    const n = ctx.db.notifications.find((x) => x.id === ctx.params.id && x.userId === u.id);
    if (!n) throw new DomainError("NOT_FOUND");
    n.readAt ??= nowIso(ctx.db);
  })),

  http.get(p(ENDPOINTS.audit), handle((ctx) => {
    requireUser(ctx.db, ctx.request, { roles: ADMIN_ROLES });
    const actorId = q(ctx.url, "actorId");
    const action = q(ctx.url, "action");
    const from = q(ctx.url, "from");
    const to = q(ctx.url, "to");
    const rows = ctx.db.audit
      .filter((a) => (!actorId || a.actorId === actorId) && (!action || a.action === action) &&
        (!from || a.createdAt.slice(0, 10) >= from) && (!to || a.createdAt.slice(0, 10) <= to))
      .reverse();
    return paginate(rows, ctx.url);
  })),
];
```

- [ ] **Step 8: Write handlers/system.ts**

Settings, backups, restore and system status. Mock backup files carry no data: `download` returns `PGDMP` + the file name as bytes, so the web download flow can be exercised end to end.

`packages/mock-api/src/handlers/system.ts`:
```ts
import { ENDPOINTS, ERROR_MESSAGES, RestoreRequest, SECRET_SETTING_KEYS, SettingsUpdate, toSettingsView, type BackupFile, type Settings } from "@bms/shared";
import { http } from "msw";
import { requireUser } from "../auth";
import { DomainError, audit, nowIso, type Db } from "../db";
import { handle, parseBody, type Ctx } from "../http";
import { p } from "./util";

const superAdmin = (ctx: Ctx) => requireUser(ctx.db, ctx.request, { roles: ["SUPER_ADMIN"] });
const MAGIC = "PGDMP";
const mask = (k: string, v: unknown) => ((SECRET_SETTING_KEYS as readonly string[]).includes(k) ? "***" : v);

/** "2026-10-14T00:00:00+07:00" -> "20261014-000000" */
const stamp = (db: Db) => nowIso(db).slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

function addBackup(db: Db, name: string, sizeBytes: number): BackupFile {
  const file: BackupFile = {
    name, sizeBytes, createdAt: nowIso(db),
    copiedToShare: db.settings.backup_share_enabled && db.settings.backup_share_path !== "",
  };
  db.backups.push(file);
  return file;
}

export const systemHandlers = [
  http.get(p(ENDPOINTS.systemStatus), handle(({ db }) => ({
    maintenance: db.maintenance,
    message: db.maintenance ? ERROR_MESSAGES.MAINTENANCE : null,
  }), { duringMaintenance: true })),

  http.get(p(ENDPOINTS.settings), handle((ctx) => (superAdmin(ctx), toSettingsView(ctx.db.settings)))),
  /** Spec 5.12: partial update, applies immediately; audit shows only changed keys, secrets as ***. */
  http.put(p(ENDPOINTS.settings), handle(async (ctx) => {
    const u = superAdmin(ctx);
    const input = await parseBody(ctx.request, SettingsUpdate);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input) as [keyof Settings, unknown][]) {
      if (v === undefined || ctx.db.settings[k] === v) continue;
      before[k] = mask(k, ctx.db.settings[k]);
      after[k] = mask(k, v);
    }
    ctx.db.settings = { ...ctx.db.settings, ...input };
    if (Object.keys(after).length) audit(ctx.db, u.id, "SETTINGS_UPDATE", "settings", "-", before, after);
    return toSettingsView(ctx.db.settings);
  })),
  // ponytail: no real FCM / SMB; checks only that the needed settings are filled.
  http.post(p(ENDPOINTS.settingsTestPush), handle((ctx) => {
    superAdmin(ctx);
    const s = ctx.db.settings;
    if (!s.push_enabled) return { ok: false, message: "Push notifikasi belum diaktifkan." };
    if (!s.fcm_service_account) return { ok: false, message: "Service account FCM belum diisi." };
    return { ok: true, message: "Notifikasi uji terkirim ke perangkat kamu." };
  })),
  http.post(p(ENDPOINTS.settingsTestShare), handle((ctx) => {
    superAdmin(ctx);
    const s = ctx.db.settings;
    if (!s.backup_share_path) return { ok: false, message: "Path network share belum diisi." };
    return { ok: true, message: `Berhasil menulis file uji ke ${s.backup_share_path}.` };
  })),

  http.get(p(ENDPOINTS.backups), handle((ctx) => {
    superAdmin(ctx);
    return [...ctx.db.backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  })),
  http.post(p(ENDPOINTS.backupRun), handle((ctx) => {
    const u = superAdmin(ctx);
    const file = addBackup(ctx.db, `bms-${stamp(ctx.db)}.dump`, 1_048_576 + ctx.db.bookings.length * 128);
    audit(ctx.db, u.id, "BACKUP_RUN", "backup", file.name, null, file);
    return file;
  })),
  // Literal path: ENDPOINTS.backupDownload(":name") would encode the colon.
  http.get(p("/api/backups/:name/download"), handle((ctx) => {
    superAdmin(ctx);
    const file = ctx.db.backups.find((b) => b.name === ctx.params.name);
    if (!file) throw new DomainError("NOT_FOUND");
    return new Response(new TextEncoder().encode(`${MAGIC}${file.name}`), {
      headers: { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${file.name}"` },
    });
  })),
  /** Spec 5.11 step 2: a file that is not a pg_dump custom archive is rejected before it is listed. */
  http.post(p(ENDPOINTS.backupUpload), handle(async (ctx) => {
    const u = superAdmin(ctx);
    const form = await ctx.request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new DomainError("VALIDATION_ERROR", "File backup wajib diunggah.");
    if (!file.name.endsWith(".dump")) throw new DomainError("VALIDATION_ERROR", "File backup harus berekstensi .dump.");
    const head = new TextDecoder().decode((await file.arrayBuffer()).slice(0, MAGIC.length));
    if (head !== MAGIC) throw new DomainError("VALIDATION_ERROR", "File bukan backup database yang valid.");
    if (ctx.db.backups.some((b) => b.name === file.name)) throw new DomainError("VALIDATION_ERROR", `File ${file.name} sudah ada.`);
    const row = addBackup(ctx.db, file.name, file.size);
    row.copiedToShare = false;
    audit(ctx.db, u.id, "BACKUP_UPLOAD", "backup", row.name, null, row);
    return row;
  })),
  /** Spec 5.11 restore, steps in the order the backend must keep. */
  http.post(p(ENDPOINTS.restore), handle(async (ctx) => {
    const u = superAdmin(ctx);
    const input = await parseBody(ctx.request, RestoreRequest);
    if (input.password !== u.password) throw new DomainError("VALIDATION_ERROR", "Password salah.");
    if (!input.fileName.endsWith(".dump") || !ctx.db.backups.some((b) => b.name === input.fileName)) throw new DomainError("NOT_FOUND", "File backup tidak ditemukan.");
    const preRestore = addBackup(ctx.db, `pre-restore-${stamp(ctx.db)}.dump`, 1_048_576 + ctx.db.bookings.length * 128);
    // ponytail: in-memory data stays as is; the backend runs pg_restore under the maintenance flag here.
    ctx.db.sessions.clear();
    audit(ctx.db, u.id, "BACKUP_RESTORE", "backup", input.fileName, null, { preRestore: preRestore.name });
    return { preRestore };
  })),
];
```

- [ ] **Step 9: Export handlers**

Replace `packages/mock-api/src/index.ts`:
```ts
import type { HttpHandler } from "msw";
import { authHandlers } from "./handlers/auth";
import { bookingHandlers } from "./handlers/bookings";
import { masterHandlers } from "./handlers/master";
import { reportHandlers } from "./handlers/reports";
import { systemHandlers } from "./handlers/system";
import { tripHandlers } from "./handlers/trips";
import { userHandlers } from "./handlers/users";

export const handlers: HttpHandler[] = [
  ...systemHandlers, ...authHandlers, ...masterHandlers, ...userHandlers,
  ...tripHandlers, ...bookingHandlers, ...reportHandlers,
];

export { DEMO_PASSWORD, createSeededDb } from "./seed";
export { getDb, resetDb } from "./state";
```

- [ ] **Step 10: Typecheck and run the existing suite**

Run: `pnpm --filter @bms/mock-api typecheck && pnpm --filter @bms/mock-api test`
Expected: typecheck exit 0; Task 5-7 tests still PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/mock-api
git commit -m "feat(mock-api): MSW handlers for every contract endpoint"
```

### Task 9: Handler tests over HTTP

Runs the real MSW handlers through `fetch` in Node, the same path the web app takes. Each test pins one rule from the Task 8 rule notes or the Review Focus list.

**Files:**
- Create: `packages/mock-api/test/handlers.test.ts`

**Interfaces:**
- Consumes: Task 8 `handlers`, `resetDb`, `getDb`, `DEMO_PASSWORD`; shared `ENDPOINTS`.
- Produces: nothing new. Plan 2 relies on these behaviors staying green.

Seed facts used below (Task 7 rule notes): today is Wed 2026-10-14, clock 00:00 WIB. `K1002` rides R2 pagi. `K1061`/`K1062` ride siang, so they have no pagi booking and can book pagi without `SCHEDULE_CONFLICT`. R2 pagi PICKUP departs 05:25 with cutoff 03:25.

- [ ] **Step 1: Write the tests**

`packages/mock-api/test/handlers.test.ts`:
```ts
import { ENDPOINTS } from "@bms/shared";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { DEMO_PASSWORD, getDb, handlers, resetDb } from "../src/index";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => resetDb(() => new Date("2026-10-14T00:00:00+07:00")));

const DAY = "2026-10-14";

// Response bodies are checked field by field below; full typing would only repeat the contract.
type Json = any;

async function api(path: string, opts: { token?: string; method?: string; body?: unknown; form?: FormData } = {}) {
  const res = await fetch(`http://localhost${path}`, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}

async function login(nik: string, password = DEMO_PASSWORD): Promise<{ token: string; name: string }> {
  const r = await api(ENDPOINTS.login, { body: { nik, password } });
  expect(r.status).toBe(200);
  return { token: r.body.accessToken, name: r.body.user.name };
}

describe("auth", () => {
  test("login works and must-change-password blocks everything but /me", async () => {
    const { token } = await login("K1090");
    expect((await api(ENDPOINTS.me, { token })).status).toBe(200);
    const blocked = await api(ENDPOINTS.myBookings, { token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("FORBIDDEN");
  });

  test("5 wrong passwords lock the account, even the right password then gets 423", async () => {
    for (let i = 0; i < 4; i++) expect((await api(ENDPOINTS.login, { body: { nik: "K1001", password: "salah" } })).status).toBe(401);
    expect((await api(ENDPOINTS.login, { body: { nik: "K1001", password: "salah" } })).status).toBe(423);
    const locked = await api(ENDPOINTS.login, { body: { nik: "K1001", password: DEMO_PASSWORD } });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe("ACCOUNT_LOCKED");
  });

  test("setup is locked once a super admin exists", async () => {
    const r = await api(ENDPOINTS.setup, { body: { nik: "x", name: "X", password: "12345678" } });
    expect(r.status).toBe(403);
  });

  test("maintenance returns 503 everywhere except system status", async () => {
    getDb().maintenance = true;
    const r = await api(ENDPOINTS.login, { body: { nik: "admin", password: DEMO_PASSWORD } });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("MAINTENANCE");
    const s = await api(ENDPOINTS.systemStatus);
    expect(s.status).toBe(200);
    expect(s.body.maintenance).toBe(true);
  });
});

describe("roles", () => {
  test("vendor cannot write master data", async () => {
    const { token } = await login("vendor");
    expect((await api(ENDPOINTS.vendors, { token, body: { name: "PT Baru" } })).status).toBe(403);
    expect((await api(ENDPOINTS.vendors, { token })).status).toBe(200);
  });

  test("ADMIN_GA cannot create an admin account", async () => {
    const { token } = await login("ga");
    const r = await api(ENDPOINTS.users, { token, body: { nik: "GA2", name: "GA Dua", role: "ADMIN_GA" } });
    expect(r.status).toBe(403);
    const ok = await api(ENDPOINTS.users, { token, body: { nik: "K2001", name: "Karyawan Baru", role: "EMPLOYEE" } });
    expect(ok.status).toBe(200);
    expect(ok.body.tempPassword).toBeTruthy();
  });

  test("an employee cannot cancel someone else's booking", async () => {
    const owner = await login("K1002");
    const [booking] = (await api(`${ENDPOINTS.myBookings}?from=${DAY}&to=${DAY}`, { token: owner.token })).body;
    const other = await login("K1003");
    const r = await api(ENDPOINTS.bookingCancel(booking.id), { token: other.token, method: "POST" });
    expect(r.status).toBe(404);
    expect(getDb().bookings.find((b) => b.id === booking.id)!.status).toBe("BOOKED");
  });
});

describe("booking", () => {
  test("departures show no passenger identity and flag the caller's own trip", async () => {
    const { token, name } = await login("K1002");
    const r = await api(`${ENDPOINTS.departures}?date=${DAY}`, { token });
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain('"nik"');
    expect(text).not.toContain(name);
    const mine = r.body.filter((d: Json) => d.mine);
    expect(mine.map((d: Json) => `${d.routeId}/${d.shiftId}/${d.direction}`).sort()).toEqual(["r2/pagi/DROPOFF", "r2/pagi/PICKUP"]);
  });

  test("two requests for the last seat: one wins, one gets TRIP_FULL", async () => {
    const trip = getDb().trips.find((t) => t.date === DAY && t.routeId === "r2" && t.shiftId === "pagi" && t.direction === "PICKUP")!;
    trip.capacity = trip.bookedCount + 1;
    const [a, b] = await Promise.all([login("K1061"), login("K1062")]);
    const body = { routeId: "r2", stopId: "r2s1", shiftId: "pagi", direction: "PICKUP", date: DAY };
    const results = await Promise.all([a, b].map(({ token }) => api(ENDPOINTS.bookings, { token, body })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe("TRIP_FULL");
    expect(trip.bookedCount).toBe(trip.capacity);
    expect(getDb().rejected.some((x) => x.date === DAY && x.routeId === "r2")).toBe(true);
  });
});

describe("settings and backups", () => {
  test("secrets are never echoed and are masked in the audit log", async () => {
    const { token } = await login("admin");
    const r = await api(ENDPOINTS.settings, { token, method: "PUT", body: { backup_share_password: "hunter2", booking_cutoff_minutes: 90 } });
    expect(r.status).toBe(200);
    expect(r.body.backup_share_password).toEqual({ isSet: true });
    expect(r.body.booking_cutoff_minutes).toBe(90);
    expect(JSON.stringify(r.body)).not.toContain("hunter2");

    const bad = await api(ENDPOINTS.settings, { token, method: "PUT", body: { booking_cutoff_minutes: 5000 } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_ERROR");
    expect(getDb().settings.booking_cutoff_minutes).toBe(90);

    const audit = await api(`${ENDPOINTS.audit}?action=SETTINGS_UPDATE`, { token });
    expect(JSON.stringify(audit.body)).not.toContain("hunter2");
    expect(audit.body.items[0].after).toEqual({ backup_share_password: "***", booking_cutoff_minutes: 90 });
  });

  test("ADMIN_GA cannot read settings", async () => {
    const { token } = await login("ga");
    expect((await api(ENDPOINTS.settings, { token })).status).toBe(403);
  });

  test("restore checks confirm and password, snapshots first, then logs everyone out", async () => {
    const { token } = await login("admin");
    const backup = (await api(ENDPOINTS.backupRun, { token, method: "POST" })).body;
    expect(backup.name).toMatch(/\.dump$/);

    const noConfirm = await api(ENDPOINTS.restore, { token, body: { fileName: backup.name, password: DEMO_PASSWORD, confirm: "YES" } });
    expect(noConfirm.status).toBe(400);
    const wrongPw = await api(ENDPOINTS.restore, { token, body: { fileName: backup.name, password: "salah", confirm: "RESTORE" } });
    expect(wrongPw.status).toBe(400);
    expect(wrongPw.body.code).toBe("VALIDATION_ERROR");

    const ok = await api(ENDPOINTS.restore, { token, body: { fileName: backup.name, password: DEMO_PASSWORD, confirm: "RESTORE" } });
    expect(ok.status).toBe(200);
    expect(ok.body.preRestore.name).toMatch(/^pre-restore-.*\.dump$/);
    expect(getDb().backups.map((b) => b.name)).toContain(ok.body.preRestore.name);
    expect((await api(ENDPOINTS.backups, { token })).status).toBe(401);
  });

  test("upload rejects a file that is not a pg_dump archive", async () => {
    const { token } = await login("admin");
    const form = new FormData();
    form.append("file", new File(["hello"], "fake.dump"));
    const r = await api(ENDPOINTS.backupUpload, { token, form });
    expect(r.status).toBe(400);
    const good = new FormData();
    good.append("file", new File(["PGDMP-data"], "real.dump"));
    expect((await api(ENDPOINTS.backupUpload, { token, form: good })).status).toBe(200);
  });
});

describe("import", () => {
  test("preview reports errors with Excel row numbers", async () => {
    const { token } = await login("ga");
    const rows = [
      { nik: 9001, name: "Satu" },
      { nik: "9001", name: "Dobel" },
      { nik: "", name: "Kosong" },
      { nik: "admin", name: "Admin" },
      { nik: "K1001", name: "Update" },
    ];
    const r = await api(ENDPOINTS.importPreview, { token, body: { rows } });
    expect(r.status).toBe(200);
    expect(r.body.created.map((x: Json) => x.nik)).toEqual(["9001"]);
    expect(r.body.updated.map((x: Json) => x.nik)).toEqual(["K1001"]);
    expect(r.body.errors.map((e: Json) => e.row)).toEqual([3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @bms/mock-api test -- handlers`
Expected: PASS. A failure here is a handler bug: fix the handler from Task 8, never loosen the test. If the race test shows two 200s, `allocateSeat` has an `await` between its capacity check and the write; move the check and write into one synchronous block.

- [ ] **Step 3: Run the whole workspace**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: all packages PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/mock-api/test/handlers.test.ts
git commit -m "test(mock-api): handler rules over HTTP (roles, race, secrets, restore, import)"
```
