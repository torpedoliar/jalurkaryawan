import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { MaintenanceGuard } from './common/guards/maintenance.guard';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { FleetModule } from './fleet/fleet.module';
import { RoutesModule } from './routes/routes.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TripsModule } from './trips/trips.module';
import { BookingsModule } from './bookings/bookings.module';
import { AdminModule } from './admin/admin.module';
import { ReportsModule } from './reports/reports.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SchedulerModule } from './scheduler/scheduler.module';
import { BackupModule } from './backup/backup.module';
import { OperationsController } from './operations/operations.controller';
import { OperationsService } from './operations/operations.service';

@Module({
  controllers: [HealthController, OperationsController],
  imports: [SettingsModule, AuthModule, NotificationsModule, FleetModule, RoutesModule, UsersModule, TripsModule, BookingsModule, AdminModule, ReportsModule, ScheduleModule.forRoot(), SchedulerModule, BackupModule],
  providers: [
    OperationsService,
    MaintenanceGuard,
    { provide: APP_GUARD, useExisting: MaintenanceGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
