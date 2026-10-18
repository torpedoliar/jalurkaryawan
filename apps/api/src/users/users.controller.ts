import { Body, Controller, Get, Param, Post, Put, Query, Req, UsePipes } from '@nestjs/common';
import { ImportRequest, UserInput } from '@bms/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodPipe } from '../common/zod-body.pipe';
import { UsersService } from './users.service';

type ActorReq = { user: { id: string | null; name: string; role: string } };

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  list(@Query('q') q?: string, @Query('role') role?: string, @Query('page') page?: string) {
    return this.users.list({ q, role, page: page ? Number(page) : undefined });
  }

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(UserInput))
  create(@Body() b: UserInput, @Req() r: ActorReq) {
    return this.users.create(b, r.user);
  }

  @Put(':id')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(UserInput))
  update(@Param('id') id: string, @Body() b: UserInput, @Req() r: ActorReq) {
    return this.users.update(id, b, r.user);
  }

  @Post(':id/reset-password')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  reset(@Param('id') id: string, @Req() r: ActorReq) {
    return this.users.resetPassword(id, r.user);
  }

  @Post('import/preview')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(ImportRequest))
  preview(@Body() b: { rows: Record<string, unknown>[] }) {
    return this.users.importPreview(b.rows);
  }

  @Post('import/commit')
  @Roles('SUPER_ADMIN', 'ADMIN_GA')
  @UsePipes(new ZodPipe(ImportRequest))
  commit(@Body() b: { rows: Record<string, unknown>[] }, @Req() r: ActorReq) {
    return this.users.importCommit(b.rows, r.user);
  }
}
