import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { NotificationType } from '@bms/shared';
import { toJakartaIso } from '@bms/shared';
import { FcmService } from './fcm.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Notification writer + push fan-out (spec §5.7: notify row first, FCM after).
 * Never throws on FCM failure; push failures are logged inside FcmService, no retry.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fcm: FcmService,
    private readonly settings: SettingsService,
  ) {}

  async insert(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: { userId, type, title, body, data: (data ?? {}) as Prisma.InputJsonValue },
    });
  }

  async insertMany(
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!userIds.length) return;
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, type, title, body, data: (data ?? {}) as Prisma.InputJsonValue })),
    });
  }

  /** Insert row then (if push_enabled) push to user's devices. Failure logged, no retry. */
  async sendToUser(userId: string, type: NotificationType, title: string, body: string, data?: Record<string, string>) {
    const n = await this.prisma.notification.create({
      data: { userId, type, title, body, data: (data ?? {}) as Prisma.InputJsonValue },
    });
    if (this.settings.get().push_enabled) {
      const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
      if (devices.length) {
        await this.fcm.send(
          devices.map((d) => ({ token: d.token, platform: d.platform as 'android' | 'ios' | 'web' })),
          title, body, data ?? {},
        );
      }
    }
    return n;
  }

  /** Reminder job: BOOKED trips departing within reminder_minutes, reminder_sent_at NULL. */
  async sendReminderCandidates(): Promise<number> {
    const minutes = this.settings.get().reminder_minutes;
    const now = new Date();
    const horizon = new Date(now.getTime() + minutes * 60_000);
    const bookings = await this.prisma.booking.findMany({
      where: { status: 'BOOKED', reminderSentAt: null, trip: { departureAt: { gt: now, lte: horizon } } },
      include: { trip: { include: { route: true } }, stop: true, user: true },
    });
    for (const b of bookings) {
      const title = 'Pengingat booking';
      const body = `Bus kamu berangkat ${b.date} pukul ${toJakartaIso(b.trip!.departureAt.getTime()).slice(11, 16)} dari ${b.stop.name}.`;
      await this.sendToUser(b.userId, 'REMINDER', title, body, { bookingId: b.id, tripId: b.tripId ?? '' });
      await this.prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
    }
    return bookings.length;
  }

  /** Cleanup job: delete notifications older than retention days. */
  async cleanup(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const r = await this.prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return r.count;
  }
}
