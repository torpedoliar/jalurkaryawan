import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { ERROR_MESSAGES, jakartaDate, LoginResponse, Me, SetupRequest } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  private async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId }, { expiresIn: `${this.settings.get().access_token_minutes}m` });
    const refreshToken = randomBytes(32).toString('base64url');
    const days = this.settings.get().refresh_token_days;
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + days * 86_400_000) },
    });
    return { accessToken, refreshToken };
  }

  async revokeAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async login(nik: string, password: string, _ip: string): Promise<LoginResponse & { refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { nik } });
    const badLogin = () => new DomainError('UNAUTHORIZED', 'NIK atau password salah.');
    if (!user || !user.active || user.authProvider !== 'LOCAL') throw badLogin();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new DomainError('ACCOUNT_LOCKED', ERROR_MESSAGES.ACCOUNT_LOCKED);
    }
    const ok = user.passwordHash ? await argon2.verify(user.passwordHash, password) : false;
    if (!ok) {
      const failed = user.failedLogins + 1;
      const max = this.settings.get().login_max_failed;
      if (failed >= max) {
        const lockout = this.settings.get().login_lockout_minutes;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: new Date(Date.now() + lockout * 60_000) },
        });
        throw new DomainError('ACCOUNT_LOCKED', ERROR_MESSAGES.ACCOUNT_LOCKED);
      }
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed } });
      throw badLogin();
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    const t = await this.issueTokens(user.id);
    return { ...t, user: this.toMe(user) };
  }

  async refresh(refreshToken: string): Promise<LoginResponse & { refreshToken: string }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    if (row.revokedAt) {
      // reuse of a used/revoked token → revoke the whole family, then fail (re-login)
      await this.revokeAll(row.userId);
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    if (row.expiresAt < new Date()) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    // atomic rotate: only one caller may move revokedAt null→set; loser is reuse
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) {
      await this.revokeAll(row.userId);
      throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    }
    const user = await this.prisma.user.findFirst({ where: { id: row.userId, active: true } });
    if (!user) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    const t = await this.issueTokens(user.id);
    return { ...t, user: this.toMe(user) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    return this.toMe(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw new DomainError('UNAUTHORIZED', ERROR_MESSAGES.UNAUTHORIZED);
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new DomainError('VALIDATION_ERROR', 'Password lama salah.');
    }
    const min = this.settings.get().password_min_length;
    if (newPassword.length < min) throw new DomainError('VALIDATION_ERROR', `Password minimal ${min} karakter.`);
    if (newPassword === currentPassword) throw new DomainError('VALIDATION_ERROR', 'Password baru harus berbeda.');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword), mustChangePassword: false },
    });
    await this.revokeAll(userId);
  }

  async setupStatus(): Promise<{ needsSetup: boolean }> {
    return { needsSetup: !(await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })) };
  }

  async setup(req: SetupRequest): Promise<LoginResponse & { refreshToken: string }> {
    if (await this.prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })) {
      throw new DomainError('FORBIDDEN', 'Setup awal sudah dilakukan.');
    }
    if (await this.prisma.user.findUnique({ where: { nik: req.nik } })) {
      throw new DomainError('VALIDATION_ERROR', 'NIK sudah dipakai.');
    }
    const min = this.settings.get().password_min_length;
    if (req.password.length < min) throw new DomainError('VALIDATION_ERROR', `Password minimal ${min} karakter.`);
    const user = await this.prisma.user.create({
      data: {
        nik: req.nik, name: req.name, role: 'SUPER_ADMIN', authProvider: 'LOCAL',
        passwordHash: await argon2.hash(req.password), mustChangePassword: false, active: true,
      },
    });
    await this.audit.write({ actorId: user.id, actorName: user.name, action: 'SETUP_SUPER_ADMIN', entity: 'user', entityId: user.id, after: { nik: user.nik } });
    const t = await this.issueTokens(user.id);
    return { ...t, user: this.toMe(user) };
  }

  async addDeviceToken(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { userId_token: { userId, token } },
      create: { userId, token, platform },
      update: { platform },
    });
  }

  async removeDeviceToken(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  /** toMe parity: expired suspension (until < today) → bookingSuspendedUntil AND suspendReason null. */
  private toMe(u: {
    id: string; nik: string; name: string; role: string; vendorId: string | null;
    mustChangePassword: boolean; bookingSuspendedUntil: Date | null; suspendReason: string | null;
  }): Me {
    const expired = !!u.bookingSuspendedUntil && jakartaDate(u.bookingSuspendedUntil) < jakartaDate(new Date());
    return {
      id: u.id, nik: u.nik, name: u.name, role: u.role as Me['role'], vendorId: u.vendorId,
      mustChangePassword: u.mustChangePassword,
      bookingSuspendedUntil: expired || !u.bookingSuspendedUntil ? null : jakartaDate(u.bookingSuspendedUntil), // IsoDate, Jakarta calendar day
      suspendReason: expired ? null : u.suspendReason,
    };
  }
}
