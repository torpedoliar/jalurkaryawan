import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable } from '@nestjs/common';
import { ERROR_HTTP_STATUS, ERROR_MESSAGES } from '@bms/shared';
import type { ZodError } from 'zod';
import { DomainError } from './domain-error';
import { zodMessage } from './zod';

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<import('express').Response>();
    const body = (code: string, message: string, status: number) => res.status(status).json({ code, message });

    if (e instanceof DomainError) return body(e.code, e.message, ERROR_HTTP_STATUS[e.code]);
    if (e instanceof HttpException) {
      const s = e.getStatus();
      if (s === 413) return body('VALIDATION_ERROR', 'File terlalu besar.', 413);
      return body('VALIDATION_ERROR', e.message, s);
    }
    if (e instanceof SyntaxError && 'body' in (e as object)) {
      return body('VALIDATION_ERROR', 'Body harus JSON.', 400); // body-parser JSON parse failure
    }
    if (e instanceof Error && 'issues' in e) {
      const z = e as unknown as ZodError;
      return body('VALIDATION_ERROR', zodMessage(z.issues[0]), 400);
    }
    // unknown — mock has no INTERNAL code, so VALIDATION_ERROR at 500
    return body('VALIDATION_ERROR', 'Terjadi kesalahan server.', 500);
  }
}
