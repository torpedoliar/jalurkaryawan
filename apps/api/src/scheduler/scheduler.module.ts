import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TripsModule } from '../trips/trips.module';
import { SchedulerService, BACKUP_JOB } from './scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), TripsModule],
  providers: [
    SchedulerService,
    // Task 14 replaces this token with the real BackupService; stub until then
    { provide: BACKUP_JOB, useValue: { runBackup: async () => ({ name: '', copiedToShare: false }) } },
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
