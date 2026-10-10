import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { PromoService } from './promo.service';
import { ValidatePromoCodeDto } from './dto/promo-code.dto';

@ApiTags('Promo')
@Controller('promo-codes')
export class PromoController {
  constructor(private service: PromoService) {}

  /**
   * Checkout preview. The real discount is recomputed in POST /orders.
   *
   * Throttled well below the global 120/min: the endpoint answers "does this
   * code exist", so at the global limit it is a code-guessing oracle. A
   * customer types one or two codes per order.
   */
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  @Post('validate')
  validate(@Body() dto: ValidatePromoCodeDto) {
    return this.service.validateForCheckout(dto.code, dto.itemsTotal);
  }
}
