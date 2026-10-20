import { Body, Controller, Delete, Get, Param, Post, Put, Req, UsePipes } from '@nestjs/common';
import { RouteInput, ShiftInput, StopInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { RoutesService } from './routes.service';
import { StopsService } from './stops.service';
import { ShiftsService } from './shifts.service';

type ActorReq = { user: { id: string | null; name: string } };

@Controller()
export class RoutesController {
  constructor(
    private readonly routes: RoutesService,
    private readonly stops: StopsService,
    private readonly shifts: ShiftsService,
  ) {}

  @Get('routes')
  listRoutes() {
    return this.routes.list();
  }

  @Post('routes')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(RouteInput))
  createRoute(@Body() b: RouteInput, @Req() r: ActorReq) {
    return this.routes.create(b, r.user);
  }

  @Put('routes/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(RouteInput))
  updateRoute(@Param('id') id: string, @Body() b: RouteInput, @Req() r: ActorReq) {
    return this.routes.update(id, b, r.user);
  }

  @Delete('routes/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateRoute(@Param('id') id: string, @Req() r: ActorReq) {
    return this.routes.deactivate(id, r.user);
  }

  @Get('routes/:id/stops')
  listStops(@Param('id') id: string) {
    return this.stops.listByRoute(id);
  }

  @Post('routes/:id/stops')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(StopInput))
  createStop(@Param('id') id: string, @Body() b: StopInput, @Req() r: ActorReq) {
    return this.stops.create(id, b, r.user);
  }

  @Put('routes/:id/stops/:stopId')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(StopInput))
  updateStop(@Param('id') id: string, @Param('stopId') stopId: string, @Body() b: StopInput, @Req() r: ActorReq) {
    return this.stops.update(id, stopId, b, r.user);
  }

  @Delete('routes/:id/stops/:stopId')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateStop(@Param('id') id: string, @Param('stopId') stopId: string, @Req() r: ActorReq) {
    return this.stops.deactivate(id, stopId, r.user);
  }

  @Get('shifts')
  listShifts() {
    return this.shifts.list();
  }

  @Post('shifts')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(ShiftInput))
  createShift(@Body() b: ShiftInput, @Req() r: ActorReq) {
    return this.shifts.create(b, r.user);
  }

  @Put('shifts/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(ShiftInput))
  updateShift(@Param('id') id: string, @Body() b: ShiftInput, @Req() r: ActorReq) {
    return this.shifts.update(id, b, r.user);
  }
}
