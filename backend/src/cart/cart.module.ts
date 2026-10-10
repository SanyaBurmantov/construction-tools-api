import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { ServerCartService } from './server-cart.service';
import { CartCleanupCron } from './cart-cleanup.cron';

@Module({
  controllers: [CartController],
  providers: [CartService, ServerCartService, CartCleanupCron],
  // OrdersModule clears the stored cart once an order from an account is
  // committed; nothing else writes to it.
  exports: [CartService, ServerCartService],
})
export class CartModule {}
