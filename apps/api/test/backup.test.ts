import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BackupService } from '../src/backup/backup.service';
import { ExecRunnerService } from '../src/backup/exec-runner.service';
import { SettingsService } from '../src/settings/settings.service';
import { AuditService } from '../src/audit/audit.service';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { MaintenanceGuard } from '../src/common/guards/maintenance.guard';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();
const { scryptSync } = require('node:crypto') as typeof import('node:crypto');
const key = scryptSync(process.env.APP_SECRET!, 'bms-settings', 32);
const BACKUP_DIR = '/tmp/bms-test-backups'; // tests use a fake runner, never real pg_dump

let settings: SettingsService;
let backup: BackupService;
let fakeExec: { calls: string[][]; onExec: (cmd: string, args: string[]) => { stdout: string; stderr: string; code: number } };

beforeAll(async () => {
  await prisma.$transaction([prisma.backup.deleteMany(), prisma.auditLog.deleteMany()]);
  const audit = new AuditService(prisma);
  settings = new SettingsService(prisma, audit, key);
  await settings.init();
  fakeExec = {
    calls: [],
    onExec: () => ({ stdout: '', stderr: '', code: 0 }),
  };
  const runner = {
    exec: async (cmd: string, args: string[]) => {
      fakeExec.calls.push([cmd, ...args]);
      return fakeExec.onExec(cmd, args);
    },
  } as ExecRunnerService;
  const fakeScheduler = { pauseAll: () => {}, resumeAll: () => {} } as SchedulerService;
  backup = new BackupService(prisma, runner, settings, audit, fakeScheduler, BACKUP_DIR);
});

describe('backup filename + runBackup', () => {
  test('runBackup calls pg_dump, creates row, audit BACKUP_RUN', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    // fake pg_dump writes a file when called
    fakeExec.onExec = (cmd) => {
      if (cmd === 'pg_dump') writeFileSync(join(BACKUP_DIR, 'tmp.dump'), Buffer.from('PGDMPfake'));
      return { stdout: '', stderr: '', code: 0 };
    };
    // seed a real dump file named like the expected result so the service can copy it
    const { runBackup } = backup;
    // runBackup internally names the file; let the fake pg_dump target it:
    fakeExec.onExec = (cmd, args) => {
      if (cmd === 'pg_dump') {
        const outIdx = args.findIndex((a) => a === '-f' || a === '--file');
        const outPath = outIdx >= 0 ? args[outIdx + 1] : join(BACKUP_DIR, 'x.dump');
        writeFileSync(outPath, Buffer.from('PGDMPfake'));
      }
      return { stdout: '', stderr: '', code: 0 };
    };
    const r = await backup.runBackup();
    expect(r.name).toMatch(/^bms-\d{8}T\d{6}Z?\.dump$/);
    expect(r.copiedToShare).toBe(false); // share disabled by default
    const row = await prisma.backup.findFirst({ where: { name: r.name } });
    expect(row).toBeTruthy();
    const log = await prisma.auditLog.findFirst({ where: { action: 'BACKUP_RUN' } });
    expect(log).toBeTruthy();
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });
});

describe('upload validation', () => {
  test('rejects non-.dump extension', async () => {
    await expect(backup.upload({ originalname: 'file.txt', buffer: Buffer.from('x') } as never))
      .rejects.toThrow('File backup harus berekstensi .dump.');
  });

  test('rejects wrong magic bytes', async () => {
    await expect(backup.upload({ originalname: 'file.dump', buffer: Buffer.from('NOTPG') } as never))
      .rejects.toThrow('File bukan backup database yang valid.');
  });

  test('accepts PGDMP magic, stores file, copiesToShare false, audit BACKUP_UPLOAD', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const r = await backup.upload({ originalname: 'up.dump', buffer: Buffer.from('PGDMPrest') } as never);
    expect(r.name).toBe('up.dump');
    expect(r.copiedToShare).toBe(false);
    const log = await prisma.auditLog.findFirst({ where: { action: 'BACKUP_UPLOAD' } });
    expect(log).toBeTruthy();
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });

  test('duplicate filename → "File ${name} sudah ada."', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    await backup.upload({ originalname: 'dup.dump', buffer: Buffer.from('PGDMPrest') } as never);
    await expect(backup.upload({ originalname: 'dup.dump', buffer: Buffer.from('PGDMPrest') } as never))
      .rejects.toThrow('File dup.dump sudah ada.');
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });
});

describe('restore validation (Review Focus #4)', () => {
  test('wrong password → "Password salah."', async () => {
    process.env.RESTORE_PASSWORD = 'correct';
    await expect(backup.restore({ fileName: 'x.dump', password: 'wrong', confirm: 'RESTORE' } as never, { id: 'a', name: 'A' }))
      .rejects.toThrow('Password salah.');
  });

  test('missing file → NOT_FOUND "File backup tidak ditemukan."', async () => {
    process.env.RESTORE_PASSWORD = 'correct';
    await expect(backup.restore({ fileName: 'missing.dump', password: 'correct', confirm: 'RESTORE' } as never, { id: 'a', name: 'A' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', message: 'File backup tidak ditemukan.' });
  });

  test('corrupt file: pg_restore --list fails → rejected BEFORE any destructive step (Review Focus #4)', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(join(BACKUP_DIR, 'corrupt.dump'), Buffer.from('PGDMPgarbage'));
    process.env.RESTORE_PASSWORD = 'correct';
    fakeExec.calls = [];
    fakeExec.onExec = (cmd) => {
      if (cmd === 'pg_restore' && argsIncludesList()) return { stdout: '', stderr: 'invalid archive', code: 1 };
      return { stdout: '', stderr: '', code: 0 };
    };
    function argsIncludesList() { return fakeExec.calls.at(-1)?.includes('--list') ?? false; }
    await expect(backup.restore({ fileName: 'corrupt.dump', password: 'correct', confirm: 'RESTORE' } as never, { id: 'a', name: 'A' }))
      .rejects.toThrow('File bukan backup database yang valid.');
    // pg_restore --list ran, but the destructive --clean restore never did
    const cleanCalls = fakeExec.calls.filter((c) => c.includes('--clean'));
    expect(cleanCalls.length).toBe(0);
    // corrupt rejection must leave the process untouched: maintenance never flipped, jobs never paused
    expect(MaintenanceGuard.enabled).toBe(false);
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });

  test('confirm !== "RESTORE" → VALIDATION', async () => {
    process.env.RESTORE_PASSWORD = 'correct';
    await expect(backup.restore({ fileName: 'x.dump', password: 'correct', confirm: 'yes' } as never, { id: 'a', name: 'A' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// shared-DB hygiene: later suites (reports) expect an empty backups table
afterAll(async () => {
  await prisma.backup.deleteMany();
});

// Extra check beyond the brief's floor: the full §5.11 success sequence, still on the fake runner.
describe('restore success path', () => {
  test('--list before --clean, maintenance active during restore, audit into restored DB', async () => {
    mkdirSync(BACKUP_DIR, { recursive: true });
    writeFileSync(join(BACKUP_DIR, 'good.dump'), Buffer.from('PGDMPok'));
    process.env.RESTORE_PASSWORD = 'correct';

    const calls: string[][] = [];
    let paused = 0;
    let resumed = 0;
    let guardDuringClean: boolean | null = null;
    const runner = {
      exec: async (cmd: string, args: string[]) => {
        calls.push([cmd, ...args]);
        if (cmd === 'pg_dump') {
          const outIdx = args.findIndex((a) => a === '-f' || a === '--file');
          writeFileSync(args[outIdx + 1]!, Buffer.from('PGDMPfake'));
        }
        if (cmd === 'pg_restore' && args.includes('--clean')) guardDuringClean = MaintenanceGuard.enabled;
        return { stdout: '', stderr: '', code: 0 };
      },
    } as ExecRunnerService;
    const spy = {
      pauseAll: () => { paused++; },
      resumeAll: () => { resumed++; },
    } as SchedulerService;
    const svc = new BackupService(prisma, runner, settings, new AuditService(prisma), spy, BACKUP_DIR);

    const r = await svc.restore(
      { fileName: 'good.dump', password: 'correct', confirm: 'RESTORE' } as never,
      { id: null, name: 'Tester' },
    );

    const listIdx = calls.findIndex((c) => c[0] === 'pg_restore' && c.includes('--list'));
    const cleanIdx = calls.findIndex((c) => c[0] === 'pg_restore' && c.includes('--clean'));
    expect(listIdx).toBeGreaterThanOrEqual(0);
    expect(cleanIdx).toBeGreaterThan(listIdx); // validation runs before the destructive step
    expect(guardDuringClean).toBe(true); // maintenance mode active exactly during pg_restore --clean
    expect(MaintenanceGuard.enabled).toBe(false); // flipped back afterwards
    expect(paused).toBe(1);
    expect(resumed).toBe(1);
    expect(r.preRestore.name).toMatch(/^pre-restore-.*\.dump$/);
    expect(await prisma.backup.findFirst({ where: { name: r.preRestore.name } })).toBeTruthy();
    const log = await prisma.auditLog.findFirst({ where: { action: 'BACKUP_RESTORE' } });
    expect(log).toBeTruthy();
    expect((log!.after as { preRestore: string }).preRestore).toBe(r.preRestore.name);
    expect(calls.some((c) => c[0] === 'npx' && c.includes('migrate'))).toBe(true);
    rmSync(BACKUP_DIR, { recursive: true, force: true });
  });
});
