import { Module } from '@nestjs/common';
import { SourceWebsitesService } from './source-websites.service';
import { SourceWebsitesController } from './source-websites.controller';

@Module({
  controllers: [SourceWebsitesController],
  providers: [SourceWebsitesService],
  exports: [SourceWebsitesService],
})
export class SourceWebsitesModule {}
