import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { OptionalUserId } from '../auth/current-user.decorator';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Guest checkout, with one difference when a session is present: the order is
   * stamped with the account so it appears in the customer's order history.
   *
   * Throttled on its own: it evaluates promo codes (so without a limit it is a
   * faster code oracle than /promo-codes/validate) and every order fans out to
   * Telegram and the shop mailbox.
   */
  @Throttle({ default: { limit: 10, ttl: 60 * 1000 } })
  @UseGuards(OptionalAuthGuard)
  @Post()
  create(@Body() dto: CreateOrderDto, @OptionalUserId() userId?: string) {
    return this.ordersService.createOrder(dto, userId);
  }

  // Public order confirmation by UUID (used by the /checkout/success page).
  @Get(':id')
  getConfirmation(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getOrderConfirmation(id);
  }
}
