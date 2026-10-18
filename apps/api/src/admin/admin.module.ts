import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AllocateService } from '../bookings/allocate.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AllocateService, PrismaClient],
})
export class AdminModule {}
