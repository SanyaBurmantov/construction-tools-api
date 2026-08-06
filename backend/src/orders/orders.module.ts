import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PromoModule } from '../promo/promo.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PromoModule, NotificationsModule],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
