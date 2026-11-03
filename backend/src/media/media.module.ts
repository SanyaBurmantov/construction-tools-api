import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ImageMirrorService } from './image-mirror.service';
import { MediaAdminController } from './media.controller';
import { MediaUploadService } from './media-upload.service';

/** Our S3 media: supplier photos copied by ImageMirrorService, admin uploads by MediaUploadService. */
@Module({
  imports: [NotificationsModule],
  controllers: [MediaAdminController],
  providers: [ImageMirrorService, MediaUploadService],
})
export class MediaModule {}
