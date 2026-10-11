import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { ListsModule } from './lists/lists.module';
import { AuditModule } from './audit/audit.module';
import { ErrorsModule } from './errors/errors.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AdminActionLogInterceptor } from './audit/admin-action-log.interceptor';
import { OrdersModule } from './orders/orders.module';
import { CartModule } from './cart/cart.module';
import { PricingModule } from './pricing/pricing.module';
import { OffersModule } from './offers/offers.module';
import { BannersModule } from './banners/banners.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PromoModule } from './promo/promo.module';
import { CatalogNormalizerModule } from './catalog-normalizer/catalog-normalizer.module';
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
    AuthModule,
    AccountModule,
    ListsModule,
    AuditModule,
    ErrorsModule,
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
    BannersModule,
    ReviewsModule,
    PromoModule,
    AdminModule,
    CatalogNormalizerModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ParserRuntimeStatusService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global because admin routes live in six controllers across four modules;
    // it logs only mutating calls in admin scope, so the cost on the public
    // storefront is one Set lookup per request.
    { provide: APP_INTERCEPTOR, useClass: AdminActionLogInterceptor },
    // Registered here rather than with `useGlobalFilters(new …)` in main.ts so
    // it can be given the error log through DI. The response it sends is
    // unchanged; it now also keeps a copy of what went wrong.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
