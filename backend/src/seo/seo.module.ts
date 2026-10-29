import { Module } from '@nestjs/common';
import { IndexNowService } from './indexnow.service';

/** Search-engine plumbing the API and the worker share (IndexNow). */
@Module({
  providers: [IndexNowService],
  exports: [IndexNowService],
})
export class SeoModule {}
