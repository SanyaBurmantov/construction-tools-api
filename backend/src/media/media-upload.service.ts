import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  publicReadPolicy,
  S3Client,
  s3ConfigFromEnv,
} from '../common/utils/s3-client';
import {
  MAX_IMAGE_BYTES,
  MediaConfig,
  mediaConfigFromEnv,
  sniffImageType,
} from './image-mirror';
import { renderVariants, Variant } from './image-variants';

export type UploadKind = 'image' | 'banner' | 'screenshot';

/** A banner spans the page: one WebP up to this wide, `object-fit: cover`. */
const BANNER_CAP = 1920;
/**
 * A screenshot attached to a plan: one WebP, large enough for its text to
 * stay readable. Stored under an unguessable key (the hash of the bytes) —
 * the bucket is public by exact key and closed for listing.
 */
const SCREENSHOT_CAP = 2400;
const CACHE = 'public, max-age=31536000, immutable';

/**
 * An admin's own picture (category tile, brand logo, banner) straight into
 * our S3 — the forms used to take only a pasted link, i.e. somebody else's
 * server.
 *
 * - `image` is cut into the same sizes as a product photo
 *   (`v/ab/<sha1>/<cap>.webp`), so the storefront picks a size from the URL
 *   exactly as it does for photos (utils/media-variants.ts).
 * - `banner` is one WebP whose longer side is at most 1920 px.
 * - `screenshot` (a plan's attachment) is one WebP of at most 2400 px under `s/`.
 *
 * The key is the hash of the bytes: the same file uploaded twice is one
 * object, and a changed picture is a new URL (the objects are cached for a
 * year). Runs in the API process — it is a single picture on a button, not a
 * batch — one at a time, so two uploads never decode together.
 */
@Injectable()
export class MediaUploadService {
  private readonly logger = new Logger(MediaUploadService.name);
  private readonly media: MediaConfig | null = mediaConfigFromEnv();
  private readonly s3: S3Client | null;
  private bucketReady = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    const config = s3ConfigFromEnv();
    this.s3 = config && this.media ? new S3Client(config) : null;
  }

  get enabled(): boolean {
    return this.s3 !== null;
  }

  upload(body: Buffer, kind: UploadKind): Promise<{ url: string }> {
    const run = this.chain.then(() => this.store(body, kind));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async store(
    body: Buffer,
    kind: UploadKind,
  ): Promise<{ url: string }> {
    if (!this.s3 || !this.media) {
      throw new ServiceUnavailableException(
        'Хранилище S3 не настроено — вставьте ссылку на картинку',
      );
    }
    if (body.length === 0) throw new BadRequestException('Пустой файл');
    if (body.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Файл больше 15 МБ');
    }
    if (!sniffImageType(body)) {
      throw new BadRequestException('Нужна картинка JPEG, PNG, WebP или GIF');
    }

    const hash = createHash('sha1').update(body).digest('hex');
    let files: Array<{ key: string; body: Buffer }>;
    try {
      if (kind === 'banner' || kind === 'screenshot') {
        const prefix = kind === 'banner' ? 'b' : 's';
        files = [
          {
            key: `${prefix}/${hash.slice(0, 2)}/${hash}.webp`,
            body:
              kind === 'banner'
                ? await single(body, BANNER_CAP, 82)
                : await single(body, SCREENSHOT_CAP, 88),
          },
        ];
      } else {
        files = (await renderVariants(body)).map((v: Variant) => ({
          key: `v/${hash.slice(0, 2)}/${hash}/${v.cap}.webp`,
          body: v.body,
        }));
      }
    } catch (error) {
      this.logger.warn(`Upload decode: ${message(error)}`);
      throw new BadRequestException('Не удалось прочитать картинку');
    }

    try {
      await this.ensureBucket();
      // Smallest first, like the mirror: the URL names the last one written.
      for (const file of files) {
        await this.s3.putObject(this.media.bucket, file.key, file.body, {
          'content-type': 'image/webp',
          'cache-control': CACHE,
        });
      }
    } catch (error) {
      this.bucketReady = false;
      this.logger.error(`Upload to S3: ${message(error)}`);
      throw new ServiceUnavailableException(
        'Хранилище S3 не ответило, попробуйте ещё раз',
      );
    }
    const last = files[files.length - 1];
    return { url: `${this.media.publicBase}/${last.key}` };
  }

  private async ensureBucket() {
    if (this.bucketReady) return;
    await this.s3!.ensureBucket(this.media!.bucket);
    await this.s3!.putBucketPolicy(
      this.media!.bucket,
      publicReadPolicy(this.media!.bucket),
    );
    this.bucketReady = true;
  }
}

/** One WebP whose longer side is at most `cap`, never enlarged. */
function single(body: Buffer, cap: number, quality: number): Promise<Buffer> {
  return sharp(body, { limitInputPixels: 40_000_000, failOn: 'error' })
    .autoOrient()
    .resize({
      width: cap,
      height: cap,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
