import { Body, Controller, Get, Param, Post, Query, Req, UsePipes } from '@nestjs/common';
import { DailyBookingRequest, SELF_SERVICE_ROLES, SubscriptionInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { BookingsService } from './bookings.service';
import { SubscriptionsService } from './subscriptions.service';

type EmpReq = { user: { id: string } };

/** Paths mirror ENDPOINTS: /me/bookings, /bookings, /bookings/:id/cancel, /me/subscriptions, /subscriptions. */
@Controller()
@Roles(...SELF_SERVICE_ROLES) // employees and admins share self-service booking
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly subs: SubscriptionsService,
  ) {}

  @Get('me/bookings')
  my(@Req() r: EmpReq, @Query('from') from?: string, @Query('to') to?: string) {
    return this.bookings.myBookings(r.user.id, from, to);
  }

  @Get('users/:id/bookings')
  @Roles('SUPER_ADMIN', 'ADMIN_GA') // method-level overrides the class EMPLOYEE gate
  userBookings(@Param('id') id: string) {
    return this.bookings.userBookings(id);
  }

  @Post('bookings')
  @UsePipes(new ZodPipe(DailyBookingRequest))
  book(@Req() r: EmpReq, @Body() b: { routeId: string; stopId: string; shiftId: string; direction: 'PICKUP' | 'DROPOFF'; date: string }) {
    return this.bookings.bookDaily(r.user.id, b);
  }

  @Post('bookings/:id/cancel')
  cancel(@Param('id') id: string, @Req() r: EmpReq) {
    return this.bookings.cancelBooking(id, r.user.id);
  }

  @Get('me/subscriptions')
  listSubs(@Req() r: EmpReq) {
    return this.subs.list(r.user.id);
  }

  @Post('subscriptions')
  @UsePipes(new ZodPipe(SubscriptionInput))
  createSub(@Req() r: EmpReq, @Body() b: SubscriptionInput) {
    return this.subs.create(r.user.id, b);
  }

  @Post('subscriptions/:id/end')
  endSub(@Param('id') id: string, @Req() r: EmpReq) {
    return this.subs.end(r.user.id, id);
  }
}
