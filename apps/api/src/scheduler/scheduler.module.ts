import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TripsModule } from '../trips/trips.module';
import { SchedulerService, BACKUP_JOB } from './scheduler.service';
import { BackupService } from '../backup/backup.service';
import { ExecRunnerService } from '../backup/exec-runner.service';

@Module({
  imports: [ScheduleModule.forRoot(), TripsModule],
  providers: [
    SchedulerService,
    ExecRunnerService,
    // Class provider (not factory): Nest only proxies forwardRef cycles through class prototypes.
    BackupService,
    { provide: BACKUP_JOB, useExisting: BackupService },
  ],
  exports: [SchedulerService, BackupService, ExecRunnerService],
})
export class SchedulerModule {}
