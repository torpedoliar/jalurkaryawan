import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';

/** Global so booking/subscription/notification tasks inject without importing. */
@Global()
@Module({
  providers: [NotificationsService, PrismaClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}
