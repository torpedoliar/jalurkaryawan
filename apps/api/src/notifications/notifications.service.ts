import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { NotificationType } from '@bms/shared';

/**
 * Insert-only notification writer (spec §5.7: notify row first, FCM after — FCM lands in Task 11).
 * This service never throws on FCM failure; it only persists.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaClient) {}

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
}
