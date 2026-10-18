import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';
import { SettingsService } from '../settings/settings.service';

interface Device { token: string; platform: 'android' | 'ios' | 'web' }

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private auth?: { raw: string; client: GoogleAuth };

  // prisma injected (brief note) — invalid-token delete must not spawn a fresh client per call
  constructor(private readonly settings: SettingsService, private readonly prisma: PrismaClient) {}

  private get projectId(): string | null {
    const raw = this.settings.getSecret('fcm_service_account');
    if (!raw) return null;
    try { return (JSON.parse(raw) as { project_id?: string }).project_id ?? null; } catch { return null; }
  }

  async send(devices: Device[], title: string, body: string, data: Record<string, string>): Promise<{ sent: number; failed: number }> {
    if (!this.settings.get().push_enabled) return { sent: 0, failed: 0 };
    const raw = this.settings.getSecret('fcm_service_account');
    const projectId = this.projectId;
    if (!raw || !projectId) {
      this.logger.warn('fcm_service_account not configured, skipping push');
      return { sent: 0, failed: 0 };
    }
    let accessToken: string;
    try {
      // one GoogleAuth per secret: it caches the OAuth token, so fan-out does not re-auth per send
      if (this.auth?.raw !== raw) {
        this.auth = { raw, client: new GoogleAuth({ credentials: JSON.parse(raw), scopes: ['https://www.googleapis.com/auth/firebase.messaging'] }) };
      }
      accessToken = (await this.auth.client.getAccessToken()) ?? '';
    } catch (e) {
      this.logger.warn(`fcm auth failed: ${(e as Error).message}`);
      return { sent: 0, failed: devices.length };
    }
    let sent = 0, failed = 0;
    for (const d of devices) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: d.token,
              notification: { title, body },
              data,
              android: { priority: 'HIGH' },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
        });
        if (res.ok) {
          sent += 1;
        } else {
          const err = await res.json().catch(() => ({})) as { error?: { status?: string; message?: string } };
          this.logger.warn(`fcm send failed status=${res.status} code=${err.error?.status ?? ''} msg=${err.error?.message ?? ''}`);
          // invalid/expired token → delete DeviceToken row
          if (err.error?.status === 'UNREGISTERED' || err.error?.status === 'INVALID_ARGUMENT') {
            await this.deleteDeviceToken(d.token);
          }
          failed += 1;
        }
      } catch (e) {
        this.logger.warn(`fcm send threw: ${(e as Error).message}`);
        failed += 1;
      }
    }
    return { sent, failed };
  }

  private async deleteDeviceToken(token: string) {
    try {
      await this.prisma.deviceToken.deleteMany({ where: { token } });
    } catch (e) {
      this.logger.warn(`device token delete failed: ${(e as Error).message}`);
    }
  }
}
