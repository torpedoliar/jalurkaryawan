import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.APP_SECRET }), SettingsModule],
  controllers: [AuthController],
  providers: [
    // Nest scanner UUID-keys each APP_GUARD entry — both register without multi/overwrite.
    // No `multi: true`: not in Nest 11 Provider type (Angular-ism); same-array entries do not collide here.
    AuthService, AuthGuard, RolesGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
