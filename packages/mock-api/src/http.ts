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
  // Cast via unknown: MSW 2.6 types resolvers as returning StrictResponse<Body> (branded), which a plain Response is not
  // comparable to; we return plain Response for JSON, 204 and errors alike, and MSW accepts any Response at runtime.
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
  }) as unknown as HttpResponseResolver;
}
