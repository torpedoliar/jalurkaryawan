import { Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors, UsePipes } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RestoreRequest } from '@bms/shared';
import { basename } from 'node:path';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { BackupService } from './backup.service';
import type { Response } from 'express';

type ActorReq = { user: { id: string | null; name: string } };

/** Wire parity with mock-api system.ts backups handlers; SUPER_ADMIN only. */
@Controller('backups')
@Roles('SUPER_ADMIN')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  list() {
    return this.backup.list();
  }

  @Get(':name/download')
  async download(@Param('name') name: string, @Res() res: Response) {
    const file = basename(name);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    this.backup.downloadStream(file).pipe(res);
  }

  /** Mock ENDPOINTS.backupRun: manual "Backup sekarang". */
  @Post('run')
  run() {
    return this.backup.runBackup();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.backup.upload(file);
  }

  @Post('restore')
  @UsePipes(new ZodPipe(RestoreRequest))
  restore(@Body() body: RestoreRequest, @Req() req: ActorReq) {
    return this.backup.restore(body, req.user);
  }
}
