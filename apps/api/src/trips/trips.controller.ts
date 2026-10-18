import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { CancelDateRequest, Direction, Id, IsoDate, TripTemplateInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { TemplatesService } from './templates.service';
import { TripsService } from './trips.service';

type ActorReq = { user: { id: string | null; name: string; role: string } | null };

/** Mock handlers/trips.ts local schema parity (shared has no AvailabilityQuery export). */
const AvailabilityQuery = z.object({ routeId: Id, shiftId: Id, direction: Direction, date: IsoDate });

/** Paths mirror ENDPOINTS: /trip-templates, /trips, /departures. */
@Controller()
export class TripsController {
  constructor(private readonly templates: TemplatesService, private readonly trips: TripsService) {}

  @Get('trip-templates') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  listTemplates() { return this.templates.list(); }

  @Post('trip-templates') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(TripTemplateInput))
  createTemplate(@Body() b: TripTemplateInput, @Req() r: ActorReq) { return this.templates.create(b, r.user!); }

  @Put('trip-templates/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(TripTemplateInput))
  updateTemplate(@Param('id') id: string, @Body() b: TripTemplateInput, @Req() r: ActorReq) { return this.templates.update(id, b, r.user!); }

  @Delete('trip-templates/:id') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateTemplate(@Param('id') id: string, @Req() r: ActorReq) { return this.templates.deactivate(id, r.user!); }

  @Get('trips') @Roles('SUPER_ADMIN', 'ADMIN_GA') // mock trips.ts gates with ADMIN_ROLES
  listTrips(@Query('date') date?: string, @Query('routeId') routeId?: string, @Query('shiftId') shiftId?: string) {
    return this.trips.list({ date, routeId, shiftId });
  }

  // ANY logged-in user (mock requireUser only); declared above :id routes so it can never be captured as one.
  @Get('availability')
  availability(@Query(new ZodPipe(AvailabilityQuery)) q: z.infer<typeof AvailabilityQuery>) {
    return this.trips.availability(q.routeId, q.shiftId, q.direction, q.date);
  }

  @Get('departures') // ANY logged-in user
  departures(@Req() r: ActorReq, @Query('date') date?: string) {
    return this.trips.departures(r.user?.id ?? null, date);
  }

  @Get('trips/:id/passengers') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  passengers(@Param('id') id: string) { return this.trips.tripPassengers(id); }

  @Post('trips/:id/cancel') @Roles('SUPER_ADMIN', 'ADMIN_GA')
  cancelTrip(@Param('id') id: string, @Req() r: ActorReq) { return this.trips.tripCancel(id, r.user!); }

  @Post('trips/cancel-date') @Roles('SUPER_ADMIN', 'ADMIN_GA') @UsePipes(new ZodPipe(CancelDateRequest))
  cancelDate(@Body() b: { date: string }, @Req() r: ActorReq) { return this.trips.cancelDate(b.date, r.user!); }
}
