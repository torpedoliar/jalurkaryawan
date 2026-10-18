import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ERROR_MESSAGES } from '@bms/shared';
import { SettingsService } from '../../settings/settings.service';
import { DomainError } from '../../common/domain-error';

/** In-memory per-IP sliding window for POST /api/auth/login; limit = login_rate_limit_per_minute. */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private hits = new Map<string, number[]>();
  constructor(private readonly settings: SettingsService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<import('express').Request>();
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const arr = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.settings.get().login_rate_limit_per_minute) {
      this.hits.set(ip, arr);
      throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);
    }
    arr.push(now);
    this.hits.set(ip, arr);
    return true;
  }
}
