import { Module } from '@nestjs/common';
import { ProductService } from './products.service';
import { ProductController } from './products.controller';
import { MergeService } from './merge/merge.service';
@Module({
  providers: [ProductService, MergeService],
  controllers: [ProductController],
})
export class ProductsModule {}
