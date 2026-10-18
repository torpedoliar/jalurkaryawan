import { EventEmitter } from 'node:events';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { SECRET_SETTING_KEYS, Settings, SettingsUpdate, SettingsView, toSettingsView } from '@bms/shared';
import { DomainError } from '../common/domain-error';
import { zodMessage } from '../common/zod';
import { AuditService } from '../audit/audit.service';

/**
 * In-memory settings cache. Secrets encrypted at rest with AES-256-GCM,
 * key = scryptSync(APP_SECRET, 'bms-settings', 32). update(): shared zod validation,
 * live cache swap, async durable write + masked audit, 'changed' event for cron re-register (Task 13).
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  readonly onChanged = new EventEmitter();
  private cache: Settings = Settings.parse({});

  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    @Inject('SETTINGS_KEY') private readonly key: Buffer,
  ) {}

  async onModuleInit() {
    await this.init();
  }

  async init(): Promise<void> {
    const rows = await this.prisma.setting.findMany();
    const merged: Record<string, unknown> = { ...Settings.parse({}) };
    for (const r of rows) {
      merged[r.key] = (SECRET_SETTING_KEYS as readonly string[]).includes(r.key) ? this.decrypt(String(r.value)) : r.value;
    }
    this.cache = merged as Settings;
  }

  get(): Settings {
    return this.cache;
  }

  getSecret(key: string): string | undefined {
    if (!(SECRET_SETTING_KEYS as readonly string[]).includes(key)) return undefined;
    return (this.cache as Record<string, unknown>)[key] as string | undefined;
  }

  toView(): SettingsView {
    return toSettingsView(this.cache);
  }

  update(partial: SettingsUpdate, actor: { id: string | null; name: string }): SettingsView {
    const candidate = { ...this.cache, ...partial } as Settings;
    const parsed = Settings.safeParse(candidate);
    if (!parsed.success) throw new DomainError('VALIDATION_ERROR', zodMessage(parsed.error.issues[0]));
    const before = { ...this.cache };
    this.cache = parsed.data; // live-apply synchronously
    this.onChanged.emit('changed', this.cache);
    const writes = Object.entries(partial)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        const stored = (SECRET_SETTING_KEYS as readonly string[]).includes(k) ? this.encrypt(String(v ?? '')) : v;
        return this.prisma.setting.upsert({
          where: { key: k },
          create: { key: k, value: stored as Prisma.InputJsonValue, isSecret: (SECRET_SETTING_KEYS as readonly string[]).includes(k) },
          update: { value: stored as Prisma.InputJsonValue },
        });
      });
    void this.prisma.$transaction(writes).then(() =>
      this.audit.write({
        actorId: actor.id, actorName: actor.name, action: 'SETTINGS_UPDATE',
        entity: 'settings', entityId: '-',
        before: toSettingsView(before), after: toSettingsView(this.cache),
      }),
    );
    return toSettingsView(this.cache);
  }

  private encrypt(plain: string): string {
    if (plain === '') return '';
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
  }

  private decrypt(blob: string): string {
    if (!blob.includes('.')) return blob;
    try {
      const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
      const d = createDecipheriv('aes-256-gcm', this.key, iv!);
      d.setAuthTag(tag!);
      return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
    } catch {
      return blob;
    }
  }
}
