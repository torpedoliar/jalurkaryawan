import { Body, Controller, Param, Post, Put, Req, UsePipes } from '@nestjs/common';
import { ChangeBusRequest, SuspendRequest } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { AdminService } from './admin.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

/** Mock parity: suspend/unsuspend/deactivate live under /users/:id/*, bus swap at PUT /trips/:id/bus. */
@Controller()
@Roles('SUPER_ADMIN', 'ADMIN_GA')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('users/:id/suspend')
  @UsePipes(new ZodPipe(SuspendRequest))
  suspend(@Param('id') id: string, @Body() b: { until: string; reason: string }, @Req() r: ActorReq) {
    return this.admin.suspend(id, b.until, b.reason, r.user);
  }

  @Post('users/:id/unsuspend')
  unsuspend(@Param('id') id: string, @Req() r: ActorReq) {
    return this.admin.unsuspend(id, r.user);
  }

  @Post('users/:id/deactivate')
  deactivate(@Param('id') id: string, @Req() r: ActorReq) {
    return this.admin.deactivate(id, r.user);
  }

  @Put('trips/:id/bus')
  @UsePipes(new ZodPipe(ChangeBusRequest))
  changeBus(@Param('id') id: string, @Body() b: { busId: string }, @Req() r: ActorReq) {
    return this.admin.changeTripBus(id, b.busId, r.user);
  }
}
