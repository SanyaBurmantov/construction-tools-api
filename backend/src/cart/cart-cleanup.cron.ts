import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ServerCartService } from './server-cart.service';

/** Drops carts nobody has touched for `CART_TTL_DAYS` (default 90). */
@Injectable()
export class CartCleanupCron {
  constructor(private readonly serverCart: ServerCartService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async handle() {
    await this.serverCart.purgeStale();
  }
}
