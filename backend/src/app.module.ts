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
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { ParserRuntimeStatusService } from './parser/parser-runtime-status.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    ProductsModule,
    CategoriesModule,
    SpecificationsModule,
    BrandsModule,
    SourcesModule,
    ParserModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService, ParserRuntimeStatusService],
})
export class AppModule {}
