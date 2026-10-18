import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { FcmService } from './fcm.service';

/** Global so booking/subscription/notification tasks inject without importing. */
@Global()
@Module({
  providers: [NotificationsService, FcmService, PrismaClient],
  exports: [NotificationsService, FcmService],
})
export class NotificationsModule {}
