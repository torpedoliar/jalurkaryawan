import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { SubscriptionsService } from './subscriptions.service';
import { AllocateService } from './allocate.service';

@Module({
  controllers: [BookingsController],
  providers: [AllocateService, BookingsService, SubscriptionsService, PrismaClient],
})
export class BookingsModule {}
