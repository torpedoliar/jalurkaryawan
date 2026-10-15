import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { handlers, resetDb } from "@bms/mock-api";
import { apiEvents, setToken } from "../src/api";

export const TEST_NOW = () => new Date("2026-10-14T00:00:00+07:00");
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  resetDb(TEST_NOW);
  // Only Date is faked: pages default to "today" from the browser clock, and it must match the mock's clock. Timers stay real.
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(TEST_NOW());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  server.resetHandlers();
  setToken(null);
  apiEvents.maintenance = () => {};
  apiEvents.loggedOut = () => {};
});
afterAll(() => server.close());
