import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PromoService } from './promo.service';
import { ValidatePromoCodeDto } from './dto/promo-code.dto';

@ApiTags('Promo')
@Controller('promo-codes')
export class PromoController {
  constructor(private service: PromoService) {}

  /** Checkout preview. The real discount is recomputed in POST /orders. */
  @Post('validate')
  validate(@Body() dto: ValidatePromoCodeDto) {
    return this.service.validateForCheckout(dto.code, dto.itemsTotal);
  }
}
