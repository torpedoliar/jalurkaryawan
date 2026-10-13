import type { Db } from "./db";
import { createSeededDb } from "./seed";

let current: Db = createSeededDb();

export const getDb = (): Db => current;

/** Fresh seeded DB. Tests pass a fixed clock; the browser uses the real one. */
export function resetDb(now?: () => Date): Db {
  current = createSeededDb(now);
  return current;
}
