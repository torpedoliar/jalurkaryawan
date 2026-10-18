import { Body, Controller, Get, Param, Post, Query, Req, UsePipes } from '@nestjs/common';
import { DailyBookingRequest } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { BookingsService } from './bookings.service';

type EmpReq = { user: { id: string } };

/** Paths mirror ENDPOINTS: /me/bookings, /bookings, /bookings/:id/cancel. */
@Controller()
@Roles('EMPLOYEE') // employee-only endpoints (mock bookingHandlers gate EMPLOYEE)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('me/bookings')
  my(@Req() r: EmpReq, @Query('from') from?: string, @Query('to') to?: string) {
    return this.bookings.myBookings(r.user.id, from, to);
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
}
