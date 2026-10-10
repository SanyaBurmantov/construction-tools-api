import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserListKind } from '@prisma/client';
import { UserListsService } from './user-lists.service';
import { UserListsDto } from './dto/user-lists.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.service';

/**
 * The account's favourites and comparison. Guests keep both in localStorage
 * and never reach this controller; for an account it is the same backup
 * arrangement as the cart.
 */
@ApiTags('Lists')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('lists')
export class ListsController {
  constructor(private readonly lists: UserListsService) {}

  @Get()
  getLists(@CurrentUser() user: AuthenticatedUser) {
    return this.lists.getLists(user.id);
  }

  @Put()
  replace(@CurrentUser() user: AuthenticatedUser, @Body() dto: UserListsDto) {
    return this.lists.replace(user.id, dto);
  }

  @HttpCode(200)
  @Post('merge')
  merge(@CurrentUser() user: AuthenticatedUser, @Body() dto: UserListsDto) {
    return this.lists.merge(user.id, dto);
  }

  /** Without `kind` both lists are emptied. */
  @Delete()
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind?: UserListKind,
  ) {
    const known =
      kind === UserListKind.WISHLIST || kind === UserListKind.COMPARE
        ? kind
        : undefined;
    return this.lists.clear(user.id, known);
  }
}
