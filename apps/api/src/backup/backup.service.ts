import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BackupFile, ERROR_MESSAGES, RestoreRequest } from '@bms/shared';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DomainError } from '../common/domain-error';
import { MaintenanceGuard } from '../common/guards/maintenance.guard';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { ExecRunnerService } from './exec-runner.service';

const BACKUP_DIR_DEFAULT = '/backups';

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  // backupDir last + defaultable: tests pass a fake dir positionally; Nest builds this via
  // a useFactory in SchedulerModule (breaks the SchedulerService<->BackupService cycle).
  constructor(
    private readonly prisma: PrismaClient,
    private readonly exec: ExecRunnerService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerService,
    private readonly backupDir: string = process.env.BACKUP_DIR ?? BACKUP_DIR_DEFAULT,
  ) {}

  /** libpq conn string — pg_dump/pg_restore do not read DATABASE_URL themselves. */
  private conn(): string {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL wajib diisi untuk backup/restore.');
    return url;
  }

  /** "2026-10-18T02:00:00.000Z" -> "20261018T020000" (keeps T; brief test regex + example pin this shape). */
  private stamp(): string {
    return new Date().toISOString().slice(0, 19).replace(/[-:]/g, '');
  }

  private toFile(b: { name: string; sizeBytes: number; createdAt: Date; copiedToShare: boolean }): BackupFile {
    return { name: b.name, sizeBytes: b.sizeBytes, createdAt: b.createdAt.toISOString(), copiedToShare: b.copiedToShare };
  }

  /** Spec §5.11: daily pg_dump, optional smbclient copy, retention, audit. */
  async runBackup(): Promise<BackupFile> {
    mkdirSync(this.backupDir, { recursive: true });
    const name = `bms-${this.stamp()}.dump`;
    const outPath = join(this.backupDir, name);
    const r = await this.exec.exec('pg_dump', ['-Fc', '-f', outPath, this.conn()]);
    if (r.code !== 0) {
      this.logger.error(`pg_dump failed: ${r.stderr}`);
      try { unlinkSync(outPath); } catch { /* best-effort: drop partial dump */ }
      throw new Error(`pg_dump failed: ${r.stderr}`);
    }
    let copiedToShare = false;
    const s = this.settings.get();
    if (s.backup_share_enabled && s.backup_share_path !== '') {
      copiedToShare = (await this.trySmbPut(outPath, name)).ok;
    }
    const sizeBytes = statSync(outPath).size;
    const row = await this.prisma.backup.create({ data: { name, sizeBytes, copiedToShare } });
    await this.applyRetention();
    await this.audit.write({
      actorId: null, actorName: 'system', action: 'BACKUP_RUN',
      entity: 'backup', entityId: name, after: this.toFile(row),
    });
    return this.toFile(row);
  }

  private async trySmbPut(localPath: string, remoteName: string): Promise<{ ok: boolean; error?: string }> {
    const s = this.settings.get();
    const pass = this.settings.getSecret('backup_share_password') ?? '';
    try {
      const url = new URL(s.backup_share_path.replace(/^\/\//, 'smb://'));
      const hostShare = `//${url.host}${url.pathname.replace(/\/$/, '')}`;
      const cmdArgs = [hostShare, '-c', `put "${localPath}" "${remoteName}"`];
      if (s.backup_share_username) cmdArgs.push('-U', `${s.backup_share_username}%${pass}`);
      const r = await this.exec.exec('smbclient', cmdArgs);
      if (r.code !== 0) {
        this.logger.warn(`smbclient copy failed for ${remoteName}: ${r.stderr}`);
        return { ok: false, error: r.stderr.trim() || `smbclient exited with code ${r.code}` };
      }
      return { ok: true };
    } catch (e) {
      this.logger.warn(`smbclient threw for ${remoteName}: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }

  private async applyRetention(): Promise<void> {
    const days = this.settings.get().backup_retention_days;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await this.prisma.backup.findMany({ where: { createdAt: { lt: cutoff } } });
    for (const b of old) {
      const p = join(this.backupDir, basename(b.name));
      if (existsSync(p)) { try { unlinkSync(p); } catch { /* best-effort */ } }
      await this.prisma.backup.delete({ where: { id: b.id } });
    }
  }

  async list(): Promise<BackupFile[]> {
    const rows = await this.prisma.backup.findMany({ orderBy: [{ createdAt: 'desc' }, { name: 'desc' }] });
    return rows.map((r) => this.toFile(r));
  }

  downloadStream(name: string): NodeJS.ReadableStream {
    const p = join(this.backupDir, basename(name));
    if (!existsSync(p)) throw new DomainError('NOT_FOUND', ERROR_MESSAGES.NOT_FOUND);
    return createReadStream(p);
  }

  async upload(file?: { originalname: string; buffer: Buffer }): Promise<BackupFile> {
    if (!file) throw new DomainError('VALIDATION_ERROR', 'File backup wajib diunggah.');
    const name = basename(file.originalname);
    if (!name.endsWith('.dump')) throw new DomainError('VALIDATION_ERROR', 'File backup harus berekstensi .dump.');
    // PGDMP magic (PostgreSQL custom format)
    if (file.buffer.subarray(0, 5).toString('utf8') !== 'PGDMP') {
      throw new DomainError('VALIDATION_ERROR', 'File bukan backup database yang valid.');
    }
    mkdirSync(this.backupDir, { recursive: true });
    const dest = join(this.backupDir, name);
    if (existsSync(dest)) throw new DomainError('VALIDATION_ERROR', `File ${name} sudah ada.`);
    writeFileSync(dest, file.buffer);
    const row = await this.prisma.backup.create({ data: { name, sizeBytes: file.buffer.length, copiedToShare: false } });
    await this.audit.write({
      actorId: null, actorName: 'system', action: 'BACKUP_UPLOAD',
      entity: 'backup', entityId: name, after: this.toFile(row),
    });
    return this.toFile(row);
  }

  /** Spec §5.11 restore. Review Focus: pg_restore --list validates BEFORE anything touches data. */
  async restore(input: RestoreRequest, actor: { id: string | null; name: string }): Promise<{ preRestore: BackupFile }> {
    if (input.confirm !== 'RESTORE') throw new DomainError('VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR);
    // ops: set RESTORE_PASSWORD via deployment env, not .env
    const expected = process.env.RESTORE_PASSWORD ?? '';
    if (!expected || input.password !== expected) throw new DomainError('VALIDATION_ERROR', 'Password salah.');
    const name = basename(input.fileName);
    const src = join(this.backupDir, name);
    if (!name.endsWith('.dump') || !existsSync(src)) {
      throw new DomainError('NOT_FOUND', 'File backup tidak ditemukan.');
    }
    // step 1: validate the archive — a corrupt dump is rejected with the DB completely untouched
    const listCheck = await this.exec.exec('pg_restore', ['--list', src]);
    if (listCheck.code !== 0) throw new DomainError('VALIDATION_ERROR', 'File bukan backup database yang valid.');

    // step 2: pre-restore safety snapshot (abort before maintenance if this fails)
    mkdirSync(this.backupDir, { recursive: true });
    const preRestore = `pre-restore-${this.stamp()}.dump`;
    const prePath = join(this.backupDir, preRestore);
    const pre = await this.exec.exec('pg_dump', ['-Fc', '-f', prePath, this.conn()]);
    if (pre.code !== 0) {
      try { unlinkSync(prePath); } catch { /* best-effort: drop partial dump */ }
      throw new Error(`pg_dump pre-restore failed: ${pre.stderr}`);
    }

    // step 3: maintenance mode + stop cron jobs (pauseAll inside the try: a throw must not strand the guard)
    MaintenanceGuard.enabled = true;
    try {
      this.scheduler.pauseAll();
      // step 4: destructive restore in one transaction
      const r = await this.exec.exec('pg_restore', ['--clean', '--if-exists', '--single-transaction', '-d', this.conn(), src]);
      if (r.code !== 0) throw new DomainError('VALIDATION_ERROR', `Restore gagal: ${r.stderr}`);
      // step 5: re-apply migrations on the restored schema — a failed deploy must not fall through to success
      const m = await this.exec.exec('npx', ['prisma', 'migrate', 'deploy']);
      if (m.code !== 0) throw new DomainError('VALIDATION_ERROR', `Restore gagal: ${m.stderr}`);
      // step 6: reload settings cache + revoke every refresh token (everyone re-logins)
      await this.settings.init();
      await this.prisma.refreshToken.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
    } finally {
      try { this.scheduler.resumeAll(); } catch { /* job never registered */ }
      MaintenanceGuard.enabled = false;
    }
    // step 7: record the snapshot + audit INTO the restored DB
    const sizeBytes = existsSync(prePath) ? statSync(prePath).size : 0;
    const row = await this.prisma.backup.create({ data: { name: preRestore, sizeBytes, copiedToShare: false } });
    await this.audit.write({
      actorId: actor.id, actorName: actor.name, action: 'BACKUP_RESTORE',
      entity: 'backup', entityId: name, after: { preRestore },
    });
    return { preRestore: this.toFile(row) };
  }

  async testShare(): Promise<{ ok: boolean; message: string }> {
    const s = this.settings.get();
    if (s.backup_share_path === '') return { ok: false, message: 'Path network share belum diisi.' };
    try {
      mkdirSync(this.backupDir, { recursive: true });
      const testFile = join(this.backupDir, 'test-share.txt');
      writeFileSync(testFile, 'ok');
      const r = await this.trySmbPut(testFile, 'test-share.txt');
      if (!r.ok) return { ok: false, message: r.error ?? 'Gagal menulis file uji ke network share.' };
      return { ok: true, message: `Berhasil menulis file uji ke ${s.backup_share_path}.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
}
