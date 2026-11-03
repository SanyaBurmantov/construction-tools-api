import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PerfController } from './perf.controller';
import { PerfService } from './perf.service';
import { RequestTimingMiddleware } from './request-timing.middleware';

/** Request timing, database statistics and the slow-site alert. */
@Module({
  imports: [NotificationsModule],
  controllers: [PerfController],
  providers: [PerfService, RequestTimingMiddleware],
})
export class PerfModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestTimingMiddleware).forRoutes('{*path}');
  }
}
