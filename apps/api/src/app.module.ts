import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { MaintenanceGuard } from './common/guards/maintenance.guard';
import { SettingsModule } from './settings/settings.module';

@Module({
  controllers: [HealthController],
  imports: [SettingsModule],
  providers: [
    MaintenanceGuard,
    { provide: APP_GUARD, useExisting: MaintenanceGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
