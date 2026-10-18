import { Controller, Get } from '@nestjs/common';
import { ERROR_MESSAGES, type SystemStatus } from '@bms/shared';
import { Public } from './auth/decorators/public.decorator';
import { MaintenanceGuard } from './common/guards/maintenance.guard';

/** Both paths are maintenance-exempt (MaintenanceGuard) and public. */
@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** mock system.ts systemStatus parity. */
  @Public()
  @Get('system/status')
  status(): SystemStatus {
    const on = MaintenanceGuard.enabled;
    return { maintenance: on, message: on ? ERROR_MESSAGES.MAINTENANCE : null };
  }
}
