import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TripsController } from './trips.controller';
import { TemplatesService } from './templates.service';
import { TripsService } from './trips.service';
import { GenerateService } from '../generate/generate.service';
import { AllocateService } from '../bookings/allocate.service';

@Module({
  controllers: [TripsController],
  providers: [TemplatesService, TripsService, GenerateService, AllocateService, PrismaClient],
  exports: [GenerateService],
})
export class TripsModule {}
