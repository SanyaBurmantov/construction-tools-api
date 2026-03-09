import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { SpecificationsModule } from './specifications/specifications.module';
import { BrandsModule } from './brands/brands.module';
import { SourcesModule } from './sources/sources.module';
import { ParserModule } from './parser/parser.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    ProductsModule,
    CategoriesModule,
    SpecificationsModule,
    BrandsModule,
    SourcesModule,
    ParserModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
