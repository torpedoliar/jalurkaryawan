import { Body, Controller, Get, Post, Put, Req, UsePipes } from '@nestjs/common';
import { SettingsUpdate } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { SettingsService } from './settings.service';
import { NotificationsService } from '../notifications/notifications.service';

@Controller('settings')
@Roles('SUPER_ADMIN')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  get() {
    return this.settings.toView();
  }

  @Put()
  @UsePipes(new ZodPipe(SettingsUpdate))
  update(@Body() body: SettingsUpdate, @Req() req: { user: { id: string | null; name: string } }) {
    return this.settings.update(body, req.user);
  }

  // Task 11: real FCM send; stub answers match mock system.ts settingsTestPush.
  @Post('test-push')
  async testPush(@Req() req: { user: { id: string | null; name: string } }) {
    if (!this.settings.get().push_enabled) return { ok: false, message: 'Push notifikasi belum diaktifkan.' };
    if (!this.settings.getSecret('fcm_service_account')) return { ok: false, message: 'Service account FCM belum diisi.' };
    await this.notifications.sendToUser(req.user.id!, 'REMINDER', 'Notifikasi uji', 'Ini notifikasi uji dari BMS.');
    return { ok: true, message: 'Notifikasi uji terkirim ke perangkat kamu.' };
  }

  // Real implementation arrives in Task 14 (share); stub matches mock's unconfigured answer.
  @Post('test-share')
  testShare() {
    return { ok: false, message: 'Path network share belum diisi.' };
  }
}
