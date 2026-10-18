import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { BackupController } from './backup.controller';

/** BackupService itself lives in SchedulerModule (the cron job injects it); this module owns the HTTP surface. */
@Module({
  imports: [SchedulerModule],
  controllers: [BackupController],
  exports: [SchedulerModule], // re-export: importers (SettingsModule test-share) resolve BackupService
})
export class BackupModule {}
