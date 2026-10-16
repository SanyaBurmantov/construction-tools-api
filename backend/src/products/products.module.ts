import { Module } from '@nestjs/common';
import { ProductService } from './products.service';
import { ProductController } from './products.controller';
@Module({
  providers: [ProductService],
  controllers: [ProductController],
})
export class ProductsModule {}
