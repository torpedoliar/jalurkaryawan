import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ERROR_MESSAGES } from '@bms/shared';
import { DomainError } from '../domain-error';

/**
 * In-memory maintenance flag (spec §5.11 restore flips it process-wide from outside a request).
 * Skips /api/system/status and /api/health. Task 13 sets/restores the flag around pg_restore.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  static enabled = false;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<import('express').Request>();
    if (req.path === '/api/system/status' || req.path === '/api/health') return true;
    if (MaintenanceGuard.enabled) throw new DomainError('MAINTENANCE', ERROR_MESSAGES.MAINTENANCE);
    return true;
  }
}
