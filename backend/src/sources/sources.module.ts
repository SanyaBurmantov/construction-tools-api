import { Module } from '@nestjs/common';
import { SourcesService } from './sources.service';
import { SourceController } from './sources.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SourcesService],
  controllers: [SourceController],
})
export class SourcesModule {}
