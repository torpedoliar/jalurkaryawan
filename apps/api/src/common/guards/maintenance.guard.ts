import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ERROR_MESSAGES } from '@bms/shared';
import { DomainError } from '../domain-error';

/**
 * In-memory maintenance flag (spec §5.11 restore flips it). Skips /api/system/status and /api/health.
 * Task 14 sets/restores the flag around pg_restore.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  enabled = false;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<import('express').Request>();
    if (req.path === '/api/system/status' || req.path === '/api/health') return true;
    if (this.enabled) throw new DomainError('MAINTENANCE', ERROR_MESSAGES.MAINTENANCE);
    return true;
  }
}
