import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ERROR_MESSAGES, type SystemStatus } from '@bms/shared';
import { Public } from './auth/decorators/public.decorator';
import { MaintenanceGuard } from './common/guards/maintenance.guard';

/** Both paths are maintenance-exempt (MaintenanceGuard) and public. */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaClient) {}

  /** spec: "cek API + koneksi DB" — live SELECT 1; DB down → 503 {status:'error'} (backend-only, no mock counterpart). */
  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response): Promise<{ status: 'ok' | 'error' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      res.status(503);
      return { status: 'error' };
    }
  }

  /** mock system.ts systemStatus parity. */
  @Public()
  @Get('system/status')
  status(): SystemStatus {
    const on = MaintenanceGuard.enabled;
    return { maintenance: on, message: on ? ERROR_MESSAGES.MAINTENANCE : null };
  }
}
