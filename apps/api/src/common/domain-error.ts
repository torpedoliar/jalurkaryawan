import type { ErrorCode } from '@bms/shared';

/** Every business failure the API can answer; rendered by AllExceptionsFilter via ERROR_HTTP_STATUS. */
export class DomainError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
