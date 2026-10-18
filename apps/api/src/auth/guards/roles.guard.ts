import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_MESSAGES } from '@bms/shared';
import { DomainError } from '../../common/domain-error';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const req = ctx.switchToHttp().getRequest<{ user?: { role: string } | null }>();
    if (!req.user) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    if (!roles.includes(req.user.role)) throw new DomainError('FORBIDDEN', ERROR_MESSAGES.FORBIDDEN);
    return true;
  }
}
