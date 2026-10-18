import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TemplatesService } from './templates.service';
import { TripsService } from './trips.service';
import { GenerateService } from '../generate/generate.service';
import { AllocateService } from '../bookings/allocate.service';

@Module({
  controllers: [TripsController],
  providers: [TemplatesService, TripsService, GenerateService, AllocateService],
  exports: [GenerateService],
})
export class TripsModule {}
