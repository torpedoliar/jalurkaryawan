import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { IsoDate } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { ReportsService } from './reports.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

/** Param-named so zodMessage yields `date:`/`from:`/`to:` paths (mock IsoDate.parse parity, fix round 1). */
const DashboardQuery = z.object({ date: IsoDate.optional() });
const RangeQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

/** Paths mirror ENDPOINTS: /api/reports/*, /api/me/notifications*. */
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/dashboard') @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  dashboard(@Query(new ZodPipe(DashboardQuery)) q: z.infer<typeof DashboardQuery>, @Req() r: ActorReq) {
    return this.reports.dashboard(r.user, q.date);
  }

  @Get('reports/occupancy') @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  occupancy(@Query(new ZodPipe(RangeQuery)) q: z.infer<typeof RangeQuery>) { return this.reports.occupancy(q.from, q.to); }

  @Get('reports/rejected') @Roles('SUPER_ADMIN', 'ADMIN_GA', 'VENDOR')
  rejected(@Query(new ZodPipe(RangeQuery)) q: z.infer<typeof RangeQuery>) { return this.reports.rejected(q.from, q.to); }

  @Get('reports/no-show-candidates') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  noShow() { return this.reports.noShowCandidates(); }

  @Get('me/notifications') // ANY logged-in user (mock requireUser only)
  myNotifications(@Req() r: ActorReq) { return this.reports.notificationsList(r.user.id!); }

  @Post('me/notifications/:id/read')
  readNotification(@Param('id') id: string, @Req() r: ActorReq) { return this.reports.notificationRead(r.user.id!, id); }
}
