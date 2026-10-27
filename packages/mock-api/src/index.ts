import type { HttpHandler } from "msw";
import { authHandlers } from "./handlers/auth";
import { bookingHandlers } from "./handlers/bookings";
import { masterHandlers } from "./handlers/master";
import { operationHandlers } from "./handlers/operations";
import { reportHandlers } from "./handlers/reports";
import { systemHandlers } from "./handlers/system";
import { tripHandlers } from "./handlers/trips";
import { userHandlers } from "./handlers/users";

export const handlers: HttpHandler[] = [
  ...systemHandlers, ...authHandlers, ...masterHandlers, ...userHandlers,
  ...tripHandlers, ...bookingHandlers, ...reportHandlers, ...operationHandlers,
];

export { DEMO_PASSWORD, createSeededDb } from "./seed";
export { getDb, resetDb, useKarawangDemo } from "./state";