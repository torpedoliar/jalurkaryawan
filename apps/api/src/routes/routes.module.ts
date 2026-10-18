import { Module } from '@nestjs/common';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';
import { StopsService } from './stops.service';
import { ShiftsService } from './shifts.service';

@Module({
  controllers: [RoutesController],
  providers: [RoutesService, StopsService, ShiftsService],
})
export class RoutesModule {}
