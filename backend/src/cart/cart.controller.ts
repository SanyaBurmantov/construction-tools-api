import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { ServerCartService } from './server-cart.service';
import { ValidateCartDto } from './dto/validate-cart.dto';
import { CartItemsDto } from './dto/server-cart.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.service';

@ApiTags('Cart')
@Controller('cart')
export class CartController {
  constructor(
    private service: CartService,
    private serverCart: ServerCartService,
  ) {}

  /**
   * Re-prices a client-side cart. Read-only despite being a POST — the cart
   * contents are the request body, not a resource on the server. Public: a
   * guest cart needs re-pricing too.
   */
  @Post('validate')
  @HttpCode(200)
  validate(@Body() dto: ValidateCartDto) {
    return this.service.validate(dto);
  }

  /* ---- The signed-in account's stored cart ----------------------------- */

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get()
  getCart(@CurrentUser() user: AuthenticatedUser) {
    return this.serverCart.getCart(user.id);
  }

  /** Mirrors a local change up. Last write wins. */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Put()
  replaceCart(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CartItemsDto,
  ) {
    return this.serverCart.replace(user.id, dto);
  }

  /**
   * Sign-in step: the guest cart in the browser is merged with whatever the
   * account had, and the merged cart comes back as the authoritative one.
   */
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @HttpCode(200)
  @Post('merge')
  mergeCart(@CurrentUser() user: AuthenticatedUser, @Body() dto: CartItemsDto) {
    return this.serverCart.merge(user.id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Delete()
  clearCart(@CurrentUser() user: AuthenticatedUser) {
    return this.serverCart.clear(user.id);
  }
}
