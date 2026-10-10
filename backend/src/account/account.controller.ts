import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountService } from './account.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccountOrderQueryDto } from './dto/account-order-query.dto';
import type { AuthenticatedUser } from '../auth/auth.service';

/**
 * The customer's личный кабинет. Profile editing and the password change stay
 * on `/auth/me` — this controller is the read side: общая информация,
 * история заказов, доступные промокоды.
 */
@ApiTags('Account')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.account.getSummary(user.id);
  }

  @Get('orders')
  getOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AccountOrderQueryDto,
  ) {
    return this.account.listOrders(user.id, query);
  }

  @Get('orders/:id')
  getOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.account.getOrder(user.id, id);
  }

  @Get('promo-codes')
  getPromoCodes() {
    return this.account.listPromoCodes();
  }
}
