import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { AuditService } from '../audit/audit.service';
import { AuditController } from '../audit/audit.controller';
import { BackupModule } from '../backup/backup.module';

@Global()
@Module({
  imports: [BackupModule],
  controllers: [SettingsController, AuditController],
  providers: [
    SettingsService, AuditService, PrismaClient,
    { provide: 'SETTINGS_KEY', useFactory: () => scryptSync(process.env.APP_SECRET ?? '', 'bms-settings', 32) },
  ],
  exports: [SettingsService, AuditService, PrismaClient], // @Global: the ONE PrismaClient pool for every module
})
export class SettingsModule {}
