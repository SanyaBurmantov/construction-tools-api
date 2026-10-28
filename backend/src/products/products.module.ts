import { Module } from '@nestjs/common';
import { ListingRankService } from './listing-rank.service';
import { ProductService } from './products.service';
import { ProductController } from './products.controller';
@Module({
  providers: [ProductService, ListingRankService],
  controllers: [ProductController],
})
export class ProductsModule {}
