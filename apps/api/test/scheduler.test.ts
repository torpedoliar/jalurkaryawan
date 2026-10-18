import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GenerateService } from '../src/generate/generate.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { FcmService } from '../src/notifications/fcm.service';
import { AllocateService } from '../src/bookings/allocate.service';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);

let settings: SettingsService;
let generate: GenerateService;
let notifications: NotificationsService;
let scheduler: SchedulerService;

beforeAll(async () => {
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  const fcm = new FcmService(settings, prisma);
  notifications = new NotificationsService(prisma, fcm, settings);
  generate = new GenerateService(prisma, settings, notifications, new AllocateService(prisma, settings));
  const fakeBackup = { runBackup: async () => ({ name: 'bms-test.dump', copiedToShare: false }) };
  scheduler = new SchedulerService(generate, notifications, settings, fakeBackup as never, new SchedulerRegistry());
});

describe('scheduler registration', () => {
  test('registerAll registers 4 jobs: generate, reminder, cleanup, backup', () => {
    scheduler.registerAll();
    const jobs = scheduler.listJobs();
    expect(jobs.length).toBe(4);
    expect(jobs).toContain('generate');
    expect(jobs).toContain('reminder');
    expect(jobs).toContain('cleanup');
    expect(jobs).toContain('backup');
  });

  test('re-register on settings change: generate_run_time change updates cron expr', async () => {
    scheduler.registerAll();
    await settings.update({ generate_run_time: '01:15' }, { id: null, name: 'Admin' });
    // onChanged fired inside update → registerAll re-ran
    const expr = scheduler.cronExpression('generate');
    expect(expr).toContain('15 1');
  });

  test('pauseAll / resumeAll toggle every job', () => {
    scheduler.registerAll();
    scheduler.pauseAll();
    expect(scheduler.allPaused()).toBe(true);
    scheduler.resumeAll();
    expect(scheduler.allPaused()).toBe(false);
  });
});

// hygiene (fix round 1): test 3 leaves real cron timers RUNNING (*/5 reminder hits test DB mid-suite).
// Restore the shared settings row first (update re-registers+starts jobs via 'changed'), then pause.
afterAll(async () => {
  await settings.update({ generate_run_time: '00:30' }, { id: null, name: 'Admin' });
  scheduler.pauseAll();
});
