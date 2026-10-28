import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PromoModule } from '../promo/promo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CartModule } from '../cart/cart.module';
import { B2bModule } from '../b2b/b2b.module';

@Module({
  // CartModule: an order placed from an account empties that account's stored
  // cart, so the next sign-in does not restore what was just bought.
  // B2bModule: whether the confirmation letter can link the PDF invoice.
  imports: [PromoModule, NotificationsModule, CartModule, B2bModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
