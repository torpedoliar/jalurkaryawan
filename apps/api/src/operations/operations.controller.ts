import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { AssignDriverRequest, DriverCheckinRequest, IsoDate, LocationBatch, SELF_SERVICE_ROLES, SelfCheckinRequest } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { OperationsService } from './operations.service';

type Request = { user: { id: string; name: string; role: string } };
@Controller()
export class OperationsController {
  constructor(private readonly ops: OperationsService) {}
  @Get('me/bookings/:id/ticket-qr') @Roles(...SELF_SERVICE_ROLES)
  ticket(@Param('id') id: string, @Req() req: Request) { return this.ops.ticket(id, req.user); }
  @Post('me/bookings/:id/checkin') @Roles(...SELF_SERVICE_ROLES)
  self(@Param('id') id: string, @Req() req: Request, @Body() body: unknown) { return this.ops.checkin(id, SelfCheckinRequest.parse(body).qr, req.user, 'EMPLOYEE_BUS_QR'); }
  @Get('me/bookings/:id/bus-position') @Roles(...SELF_SERVICE_ROLES)
  mine(@Param('id') id: string, @Req() req: Request) { return this.ops.myPosition(id, req.user); }
  @Get('buses/:id/qr') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  busQr(@Param('id') id: string, @Req() req: Request) { return this.ops.busQr(id, req.user); }
  @Post('buses/:id/qr/rotate') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  rotate(@Param('id') id: string, @Req() req: Request) { return this.ops.busQr(id, req.user, true); }
  @Put('trips/:id/driver') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  assign(@Param('id') id: string, @Req() req: Request, @Body() body: unknown) { return this.ops.assign(id, AssignDriverRequest.parse(body), req.user); }
  @Get('trips/:id/attendance') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  attendance(@Param('id') id: string) { return this.ops.attendance(id); }
  @Get('tracking') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  tracking(@Query('date') date?: string) { return this.ops.tracking(date ? IsoDate.parse(date) : undefined); }
  @Get('driver/trips') @Roles('DRIVER')
  trips(@Req() req: Request, @Query('date') date?: string) { return this.ops.driverTrips(req.user, date ? IsoDate.parse(date) : undefined); }
  @Get('driver/trips/:id/manifest') @Roles('DRIVER')
  manifest(@Param('id') id: string, @Req() req: Request) { return this.ops.manifest(id, req.user); }
  @Post('driver/trips/:id/checkin') @Roles('DRIVER')
  scan(@Param('id') id: string, @Req() req: Request, @Body() body: unknown) {
    const parsed = DriverCheckinRequest.parse(body);
    return this.ops.checkin(id, parsed.qr, req.user, parsed.method, true);
  }
  @Post('driver/trips/:id/start') @Roles('DRIVER')
  start(@Param('id') id: string, @Req() req: Request) { return this.ops.lifecycle(id, req.user, false); }
  @Post('driver/trips/:id/end') @Roles('DRIVER')
  end(@Param('id') id: string, @Req() req: Request) { return this.ops.lifecycle(id, req.user, true); }
  @Post('driver/trips/:id/locations') @Roles('DRIVER')
  locations(@Param('id') id: string, @Req() req: Request, @Body() body: unknown) { return this.ops.locations(id, LocationBatch.parse(body), req.user); }
}
