import { Module } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { VendorsService } from './vendors.service';
import { BusesService } from './buses.service';

@Module({
  controllers: [FleetController],
  providers: [VendorsService, BusesService],
})
export class FleetModule {}
