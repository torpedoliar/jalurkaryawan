import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AllocateService } from '../bookings/allocate.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AllocateService],
})
export class AdminModule {}
