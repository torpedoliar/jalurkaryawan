import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, PrismaClient],
})
export class ReportsModule {}
