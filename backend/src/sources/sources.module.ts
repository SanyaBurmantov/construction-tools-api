import { Module } from '@nestjs/common';
import { SourcesProductsService, SourcesService } from './sources.service';
import {
  SourceController,
  SourcesProductsController,
} from './sources.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SourcesService, SourcesProductsService],
  controllers: [SourceController, SourcesProductsController],
})
export class SourcesModule {}
