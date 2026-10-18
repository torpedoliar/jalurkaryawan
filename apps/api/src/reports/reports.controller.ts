import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

/** Paths mirror ENDPOINTS: /api/reports/*, /api/me/notifications*. */
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/dashboard') @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  dashboard(@Req() r: ActorReq, @Query('date') date?: string) { return this.reports.dashboard(r.user, date); }

  @Get('reports/occupancy') @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  occupancy(@Query('from') from?: string, @Query('to') to?: string) { return this.reports.occupancy(from, to); }

  @Get('reports/rejected') @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  rejected(@Query('from') from?: string, @Query('to') to?: string) { return this.reports.rejected(from, to); }

  @Get('reports/no-show-candidates') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  noShow() { return this.reports.noShowCandidates(); }

  @Get('me/notifications') // ANY logged-in user (mock requireUser only)
  myNotifications(@Req() r: ActorReq) { return this.reports.notificationsList(r.user.id!); }

  @Post('me/notifications/:id/read')
  readNotification(@Param('id') id: string, @Req() r: ActorReq) { return this.reports.notificationRead(r.user.id!, id); }
}
