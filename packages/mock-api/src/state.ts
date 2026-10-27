import type { Db } from "./db";
import { createSeededDb } from "./seed";
import { createKarawangDb } from "./karawang";

let current: Db | undefined;

export const getDb = (): Db => (current ??= createSeededDb());

/** Fresh seeded DB. Tests pass a fixed clock; the browser uses the real one. The only way to change the clock. */
export function resetDb(now?: () => Date): Db {
  current = createSeededDb(now);
  return current;
}

/** Explicit runtime demo selection; never changes fixed-clock regression fixtures. */
export function useKarawangDemo(): Db { current = createKarawangDb(); return current; }
