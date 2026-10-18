import type { ZodError } from 'zod';

/** Verbatim copy of packages/mock-api/src/http.ts zodMessage — first issue only. */
export function zodMessage(i: ZodError['issues'][number]): string {
  if (i.code === 'unrecognized_keys') return 'Ada kolom yang tidak dikenali.';
  if (i.code === 'invalid_type') return `${i.path.join('.') || 'body'}: format tidak sesuai.`;
  return `${i.path.join('.') || 'body'}: ${i.message}`;
}
