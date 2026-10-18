import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { TripsModule } from '../trips/trips.module';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { SchedulerService, BACKUP_JOB } from './scheduler.service';
import { BackupService } from '../backup/backup.service';
import { ExecRunnerService } from '../backup/exec-runner.service';

@Module({
  imports: [ScheduleModule.forRoot(), TripsModule],
  providers: [
    SchedulerService,
    ExecRunnerService,
    PrismaClient,
    // Real backup job: forwardRef breaks the SchedulerService <-> BackupService cycle
    // (restore pauses/resumes the scheduler). backupDir stays default (BACKUP_DIR env).
    {
      provide: BACKUP_JOB,
      useFactory: (backup: BackupService) => backup,
      // cast: Nest 11 types omit ForwardReference from inject, runtime unwraps it (injector.js resolveParams)
      inject: [forwardRef(() => BackupService) as never],
    },
    {
      provide: BackupService,
      useFactory: (
        scheduler: SchedulerService,
        exec: ExecRunnerService,
        settings: SettingsService,
        audit: AuditService,
        prisma: PrismaClient,
      ) => new BackupService(prisma, exec, settings, audit, scheduler),
      inject: [forwardRef(() => SchedulerService) as never, ExecRunnerService, SettingsService, AuditService, PrismaClient],
    },
  ],
  exports: [SchedulerService, BackupService, ExecRunnerService],
})
export class SchedulerModule {}
