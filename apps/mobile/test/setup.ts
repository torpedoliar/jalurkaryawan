import { setupServer } from "msw/node";
import { handlers, resetDb } from "@bms/mock-api";
import { setToken } from "../src/api";
import { __resetSecureStore } from "./secureStoreMock";

export const TEST_NOW = () => new Date("2026-10-14T00:00:00+07:00");
// ponytail: mock-api resolves its own msw copy (same 2.6.8); cast the boundary.
export const server = setupServer(...(handlers as unknown as Parameters<typeof setupServer>));

jest.mock("expo-secure-store", () => require("./secureStoreMock"));
jest.mock("expo-location", () => ({
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined), Accuracy: { High: 4 },
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));

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
