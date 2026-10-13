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
5. Settings PUT with secret value → response never echoes the secret; out-of-range number → `VALIDATION_ERROR`. (Task 7)

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
  src/schemas/auth.ts
  src/schemas/master.ts          vendor, bus, shift, route, stop, user
  src/schemas/trips.ts           template, trip, passenger
  src/schemas/bookings.ts        booking, subscription, rejected request
  src/schemas/reports.ts         occupancy, notifications, audit
  src/endpoints.ts               endpoint path constants
  test/time.test.ts
  test/settings.test.ts
packages/mock-api/
  package.json
  src/index.ts                   exports handlers, db, resetDb
  src/db.ts                      in-memory store types + resetDb
  src/seed.ts                    deterministic seed
  src/domain/allocate.ts         seat allocation, cancel
  src/domain/generate.ts         trip + subscription generation
  src/domain/admin.ts            suspend, change bus, cancel trip, deactivate
  src/auth.ts                    mock token + role guard
  src/http.ts                    json/error helpers
  src/handlers/*.ts              one file per module
  test/allocate.test.ts
  test/generate.test.ts
  test/admin.test.ts
  test/handlers.test.ts
```
