import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { FleetController } from './fleet.controller';
import { VendorsService } from './vendors.service';
import { BusesService } from './buses.service';

@Module({
  controllers: [FleetController],
  providers: [VendorsService, BusesService, PrismaClient],
})
export class FleetModule {}
