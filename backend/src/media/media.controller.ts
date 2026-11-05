import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminGuard } from '../admin/admin.guard';
import { MAX_IMAGE_BYTES } from './image-mirror';
import { ImageMirrorService } from './image-mirror.service';
import { MediaUploadService, UploadKind } from './media-upload.service';

/** What multer hands over (memory storage); @types/multer is not installed. */
type UploadedImage = { buffer: Buffer; size: number; originalname: string };

@Controller('admin/media')
@UseGuards(AdminGuard)
export class MediaAdminController {
  constructor(
    private readonly mirror: ImageMirrorService,
    private readonly uploads: MediaUploadService,
  ) {}

  /** How much of the catalogue's photos are served from our S3. */
  @Get('stats')
  async stats() {
    return {
      ...(await this.mirror.stats()),
      uploadsEnabled: this.uploads.enabled,
    };
  }

  /**
   * An admin's picture into our S3, resized (see MediaUploadService).
   * `kind=banner` for the home slider, `kind=screenshot` for a plan's
   * attachment, anything else for category tiles and brand logos. Answers the public URL to put into the form's field.
   */
  @Post('upload')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Query('kind') kind?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Файл не передан');
    const uploadKind: UploadKind =
      kind === 'banner' || kind === 'screenshot' ? kind : 'image';
    return this.uploads.upload(file.buffer, uploadKind);
  }
}
