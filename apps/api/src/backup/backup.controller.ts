import { Body, Controller, Get, Param, Post, Req, Res, StreamableFile, UploadedFile, UseInterceptors, UsePipes } from '@nestjs/common';
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

  // passthrough + StreamableFile: a raw @Res() pipe returns undefined → interceptor forces 204 empty body
  @Get(':name/download')
  download(@Param('name') name: string, @Res({ passthrough: true }) res: Response) {
    const file = basename(name);
    const stream = this.backup.downloadStream(file);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    return new StreamableFile(stream as import('node:stream').Readable);
  }

  /** Mock ENDPOINTS.backupRun: manual "Backup sekarang". */
  @Post('run')
  run(@Req() req: ActorReq) {
    return this.backup.runBackup(req.user);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  upload(@Req() req: ActorReq, @UploadedFile() file?: Express.Multer.File) {
    return this.backup.upload(file, req.user);
  }

  @Post('restore')
  @UsePipes(new ZodPipe(RestoreRequest))
  restore(@Body() body: RestoreRequest, @Req() req: ActorReq) {
    return this.backup.restore(body, req.user);
  }
}
