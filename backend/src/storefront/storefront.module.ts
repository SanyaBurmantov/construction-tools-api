import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsModule } from '../products/products.module';
import {
  StorefrontAdminController,
  StorefrontController,
} from './storefront.controller';
import { StorefrontService } from './storefront.service';

/** Admin-curated storefront blocks: the header strip, popular products. */
@Module({
  imports: [CategoriesModule, ProductsModule],
  controllers: [StorefrontController, StorefrontAdminController],
  providers: [StorefrontService],
})
export class StorefrontModule {}
