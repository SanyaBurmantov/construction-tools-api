import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { SpecificationsModule } from './specifications/specifications.module';
import { BrandsModule } from './brands/brands.module';
import { SourcesModule } from './sources/sources.module';
import { ParserModule } from './parser/parser.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { OrdersModule } from './orders/orders.module';
import { CartModule } from './cart/cart.module';
import { PricingModule } from './pricing/pricing.module';
import { OffersModule } from './offers/offers.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PromoModule } from './promo/promo.module';
import { ParserRuntimeStatusService } from './parser/parser-runtime-status.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60000),
        limit: Number(process.env.THROTTLE_LIMIT ?? 120),
      },
    ]),
    PrismaModule,
    ProductsModule,
    CategoriesModule,
    SpecificationsModule,
    BrandsModule,
    SourcesModule,
    ParserModule,
    OrdersModule,
    CartModule,
    PricingModule,
    OffersModule,
    ReviewsModule,
    PromoModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ParserRuntimeStatusService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
