import { Module } from '@nestjs/common';
import { IndexNowSeedService } from './indexnow-seed.service';
import { IndexNowService } from './indexnow.service';

/** Search-engine plumbing the API and the worker share (IndexNow). */
@Module({
  providers: [IndexNowService, IndexNowSeedService],
  exports: [IndexNowService],
})
export class SeoModule {}
