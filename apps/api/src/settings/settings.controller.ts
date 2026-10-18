import { Body, Controller, Get, Post, Put, Req, UsePipes } from '@nestjs/common';
import { SettingsUpdate } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
@Roles('SUPER_ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.toView();
  }

  @Put()
  @UsePipes(new ZodPipe(SettingsUpdate))
  update(@Body() body: SettingsUpdate, @Req() req: { user: { id: string | null; name: string } }) {
    return this.settings.update(body, req.user);
  }

  // Real implementations arrive in Task 11 (push) and Task 14 (share); stubs match mock's unconfigured answers.
  @Post('test-push')
  testPush() {
    return { ok: false, message: 'Push notifikasi belum diaktifkan.' };
  }

  @Post('test-share')
  testShare() {
    return { ok: false, message: 'Path network share belum diisi.' };
  }
}
