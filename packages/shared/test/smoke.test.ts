import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "../src/index";

test("shared package loads", () => {
  expect(CONTRACT_VERSION).toBe(1);
});
