import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ERROR_MESSAGES } from '@bms/shared';
import { PrismaClient } from '@prisma/client';
import { DomainError } from '../../common/domain-error';
import { ALLOW_MUST_CHANGE_KEY } from '../decorators/allow-must-change.decorator';
import { PUBLIC_KEY } from '../decorators/public.decorator';

/** Global: Bearer → verify JWT → load active user → req.user. Public routes: missing/invalid token → req.user=null, no throw. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaClient,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]) ?? false;
    const allowMustChange = this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE_KEY, [ctx.getHandler(), ctx.getClass()]) ?? false;
    const req = ctx.switchToHttp().getRequest<import('express').Request & { user?: unknown }>();

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (isPublic) { req.user = null; return true; }
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7));
      sub = payload.sub;
    } catch {
      if (isPublic) { req.user = null; return true; }
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    const user = await this.prisma.user.findFirst({ where: { id: sub, active: true } });
    if (!user) {
      if (isPublic) { req.user = null; return true; }
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    // mustChange gate applies to authenticated routes only — public routes (re-login/logout) must not 403
    if (!isPublic && user.mustChangePassword && !allowMustChange) {
      throw new DomainError('FORBIDDEN', 'Ganti password terlebih dahulu.');
    }
    req.user = user;
    return true;
  }
}
