import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { SubscriptionsService } from './subscriptions.service';
import { AllocateService } from './allocate.service';

@Module({
  controllers: [BookingsController],
  providers: [AllocateService, BookingsService, SubscriptionsService],
})
export class BookingsModule {}
