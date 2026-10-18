import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { GenerateService } from '../generate/generate.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

/** Injected token for the backup job (Task 13 provides the real BackupService). */
export const BACKUP_JOB = 'BACKUP_JOB';
export interface BackupJobLike { runBackup(): Promise<{ name: string; copiedToShare: boolean }> }

const JOB_NAMES = ['generate', 'reminder', 'cleanup', 'backup'] as const;

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private startupRun?: Promise<void>;

  constructor(
    private readonly generate: GenerateService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    @Inject(BACKUP_JOB) private readonly backup: BackupJobLike,
    private readonly registry: SchedulerRegistry,
  ) {
    // attach in constructor (not onModuleInit): settings change must re-register
    // even when tests instantiate the service without Nest lifecycle hooks
    this.settings.onChanged.on('changed', () => {
      this.logger.log('settings changed, re-registering cron jobs');
      this.registerAll();
    });
  }

  async onModuleInit() {
    // startup generate: fire-and-forget so boot is not blocked by a long window
    this.startupRun = this.generate
      .runGenerate()
      .catch((e) => this.logger.error(`startup generate failed: ${(e as Error).message}`));
    this.registerAll();
  }

  async onApplicationShutdown() {
    // close() must outlive the startup window — otherwise test-suite wipes race its inserts
    await this.startupRun;
    for (const name of JOB_NAMES) {
      try { this.registry.getCronJob(name).stop(); } catch { /* not registered */ }
    }
  }

  /** Idempotent: removes existing jobs by name, re-adds with current settings. */
  registerAll(): void {
    const s = this.settings.get();
    for (const name of JOB_NAMES) this.removeIfPresent(name);

    const [gh, gm] = s.generate_run_time.split(':').map(Number);
    const generateJob = CronJob.from({
      cronTime: `${gm} ${gh} * * *`,
      onTick: () => { void this.generate.runGenerate().catch((e) => this.logger.error(`generate job: ${(e as Error).message}`)); },
      start: false,
    });
    this.registry.addCronJob('generate', generateJob);
    generateJob.start();

    const reminderJob = CronJob.from({
      cronTime: '*/5 * * * *',
      onTick: () => { void this.notifications.sendReminderCandidates().catch((e) => this.logger.error(`reminder job: ${(e as Error).message}`)); },
      start: false,
    });
    this.registry.addCronJob('reminder', reminderJob);
    reminderJob.start();

    // cleanup nightly 01:30
    const cleanupJob = CronJob.from({
      cronTime: '30 1 * * *',
      onTick: () => { void this.notifications.cleanup(this.settings.get().notification_retention_days).catch((e) => this.logger.error(`cleanup job: ${(e as Error).message}`)); },
      start: false,
    });
    this.registry.addCronJob('cleanup', cleanupJob);
    cleanupJob.start();

    const [bh, bm] = s.backup_run_time.split(':').map(Number);
    const backupJob = CronJob.from({
      cronTime: `${bm} ${bh} * * *`,
      onTick: () => { void this.backup.runBackup().catch((e) => this.logger.error(`backup job: ${(e as Error).message}`)); },
      start: false,
    });
    this.registry.addCronJob('backup', backupJob);
    backupJob.start();
  }

  pauseAll(): void {
    for (const name of JOB_NAMES) this.registry.getCronJob(name).stop();
  }

  resumeAll(): void {
    for (const name of JOB_NAMES) this.registry.getCronJob(name).start();
  }

  // test helpers
  listJobs(): string[] { return Array.from(this.registry.getCronJobs().keys()); }
  cronExpression(name: string): string { return this.registry.getCronJob(name).cronTime.source as string; }
  allPaused(): boolean {
    return JOB_NAMES.every((n) => !this.registry.getCronJob(n).isActive);
  }

  private removeIfPresent(name: string): void {
    try { this.registry.deleteCronJob(name); } catch { /* not registered yet */ }
  }
}
