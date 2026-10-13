import type { Db } from "./db";
import { createSeededDb } from "./seed";

let current: Db | undefined;

export const getDb = (): Db => (current ??= createSeededDb());

/** Fresh seeded DB. Tests pass a fixed clock; the browser uses the real one. The only way to change the clock. */
export function resetDb(now?: () => Date): Db {
  current = createSeededDb(now);
  return current;
}
