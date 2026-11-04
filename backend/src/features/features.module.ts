import { Global, Module } from '@nestjs/common';
import {
  FeatureFlagsAdminController,
  FeatureFlagsController,
} from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Feature flags (/admin/features). `@Global()`: any module may check a flag
 * without importing this one — the point of a flag is to be cheap to add.
 */
@Global()
@Module({
  controllers: [FeatureFlagsController, FeatureFlagsAdminController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeaturesModule {}
