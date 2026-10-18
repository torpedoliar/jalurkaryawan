import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UsePipes } from '@nestjs/common';
import { BusInput, VendorInput } from '@bms/shared';
import { z } from 'zod';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { VendorsService } from './vendors.service';
import { BusesService } from './buses.service';

type ActorReq = { user: { id: string | null; name: string } };

const CapacityInput = z.object({ capacity: z.number().int().min(1).max(100) });

@Controller()
export class FleetController {
  constructor(private readonly vendors: VendorsService, private readonly buses: BusesService) {}

  @Get('vendors')
  listVendors() {
    return this.vendors.list();
  }

  @Post('vendors')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(VendorInput))
  createVendor(@Body() b: VendorInput, @Req() r: ActorReq) {
    return this.vendors.create(b, r.user);
  }

  @Put('vendors/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(VendorInput))
  updateVendor(@Param('id') id: string, @Body() b: VendorInput, @Req() r: ActorReq) {
    return this.vendors.update(id, b, r.user);
  }

  @Delete('vendors/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateVendor(@Param('id') id: string, @Req() r: ActorReq) {
    return this.vendors.deactivate(id, r.user);
  }

  @Get('buses')
  listBuses(@Query('vendorId') vendorId?: string) {
    return this.buses.list(vendorId);
  }

  @Post('buses')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(BusInput))
  createBus(@Body() b: BusInput, @Req() r: ActorReq) {
    return this.buses.create(b, r.user);
  }

  @Put('buses/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(BusInput))
  updateBus(@Param('id') id: string, @Body() b: BusInput, @Req() r: ActorReq) {
    return this.buses.update(id, b, r.user);
  }

  @Delete('buses/:id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  deactivateBus(@Param('id') id: string, @Req() r: ActorReq) {
    return this.buses.deactivate(id, r.user);
  }

  @Put('buses/:id/capacity')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(CapacityInput))
  setCapacity(@Param('id') id: string, @Body() b: { capacity: number }, @Req() r: ActorReq) {
    return this.buses.setBusCapacity(id, b.capacity, r.user);
  }
}
