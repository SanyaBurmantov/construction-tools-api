import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CartService } from './cart.service';
import { ValidateCartDto } from './dto/validate-cart.dto';

@ApiTags('Cart')
@Controller('cart')
export class CartController {
  constructor(private service: CartService) {}

  /**
   * Re-prices a client-side cart. Read-only despite being a POST — the cart
   * contents are the request body, not a resource on the server.
   */
  @Post('validate')
  @HttpCode(200)
  validate(@Body() dto: ValidateCartDto) {
    return this.service.validate(dto);
  }
}
