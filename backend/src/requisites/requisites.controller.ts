import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PayerRegistryService } from './payer-registry.service';

/**
 * `GET /requisites/unp/:unp` — what the tax ministry's public registry says
 * about a УНП, for filling the organisation's name and address as it is
 * typed (registration, checkout, «счёт без регистрации»). Public data, but
 * throttled: it is a proxy to someone else's service.
 */
@ApiTags('Requisites')
@Controller('requisites')
export class RequisitesController {
  constructor(private readonly registry: PayerRegistryService) {}

  @Get('unp/:unp')
  @Throttle({ default: { limit: 20, ttl: 60 * 1000 } })
  async unp(@Param('unp') unp: string) {
    const lookup = await this.registry.lookup(unp);
    if (lookup.status !== 'found') return { status: lookup.status };
    const { shortName, name, address, state, active } = lookup.payer;
    return { status: 'found', shortName, name, address, state, active };
  }
}
