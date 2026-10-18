import { Body, Controller, Get, Headers, Post, Req, Res, UseGuards, UsePipes } from '@nestjs/common';
import type { Response } from 'express';
import { ChangePasswordRequest, LoginRequest, REFRESH_COOKIE, SetupRequest } from '@bms/shared';
import { z } from 'zod';
import { Public } from './decorators/public.decorator';
import { AllowMustChange } from './decorators/allow-must-change.decorator';
import { LoginRateLimitGuard } from './guards/login-rate.limit.guard';
import { ZodPipe } from '../common/zod-body.pipe';
import { DomainError } from '../common/domain-error';
import { AuthService } from './auth.service';

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** bms_refresh; Path=/api/auth; HttpOnly; Secure; SameSite=Strict (auth.ts parity). */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { path: '/api/auth', httpOnly: true, secure: true, sameSite: 'strict' });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  @UsePipes(new ZodPipe(LoginRequest))
  async login(@Body() body: { nik: string; password: string }, @Req() req: { ip: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.nik, body.password, req.ip);
    setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() body: unknown,
    @Headers('content-type') ct: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // body {refreshToken?} only when content-type includes json, else cookie (auth.ts parity)
    const fromBody = ct?.includes('json') ? (body as { refreshToken?: string } | undefined)?.refreshToken : undefined;
    const token = fromBody ?? readCookie(cookie, REFRESH_COOKIE);
    if (!token) throw new DomainError('UNAUTHORIZED', 'Silakan login terlebih dahulu.');
    const r = await this.auth.refresh(token);
    setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  }

  @Public()
  @Post('logout')
  async logout(@Body() body: unknown, @Headers('cookie') cookie: string | undefined, @Res({ passthrough: true }) res: Response) {
    const token = (body as { refreshToken?: string } | undefined)?.refreshToken ?? readCookie(cookie, REFRESH_COOKIE);
    await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    // undefined → 204 via ResponseInterceptor
  }

  @Get('me')
  @AllowMustChange()
  me(@Req() req: { user: { id: string } }) {
    return this.auth.me(req.user.id);
  }

  @Post('change-password')
  @AllowMustChange()
  @UsePipes(new ZodPipe(ChangePasswordRequest))
  async changePassword(@Req() req: { user: { id: string } }, @Body() body: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(req.user.id, body.currentPassword, body.newPassword);
    // 204
  }

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  @Public()
  @Post('setup')
  @UsePipes(new ZodPipe(SetupRequest))
  async setup(@Body() body: { nik: string; name: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.setup(body);
    setRefreshCookie(res, r.refreshToken);
    return { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
  }

  @Post('device-tokens')
  @UsePipes(new ZodPipe(z.object({ token: z.string().min(1), platform: z.enum(['android', 'ios', 'web']) })))
  async addToken(@Req() req: { user: { id: string } }, @Body() body: { token: string; platform: string }) {
    await this.auth.addDeviceToken(req.user.id, body.token, body.platform);
    // 204
  }

  @Post('device-tokens/delete')
  @UsePipes(new ZodPipe(z.object({ token: z.string().min(1) })))
  async deleteToken(@Req() req: { user: { id: string } }, @Body() body: { token: string }) {
    await this.auth.removeDeviceToken(req.user.id, body.token);
    // 204
  }
}
