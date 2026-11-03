import { isPlaceholderImageUrl } from '../common/utils/product-images';

/**
 * Pure rules of copying supplier photos into our S3 (ImageMirrorService).
 *
 * Every product photo used to be hot-linked from the supplier and resized by
 * IPX on each browser-cache miss: a supplier that stops answering our server
 * (th-tool.by, 2026-11-01), deletes a delisted product's photo or is slow
 * makes our catalogue empty or slow. A copy in our bucket removes all three.
 */

export type MediaConfig = {
  bucket: string;
  /** Public base the stored URL starts with, no trailing slash. */
  publicBase: string;
  /** Stop copying above this many bytes in the bucket. */
  maxBytes: number;
};

/**
 * `S3_MEDIA_BUCKET` (+ the shared S3_ENDPOINT/keys) turns copying on.
 * `S3_MEDIA_PUBLIC_BASE` overrides the public URL prefix (a CDN, a proxy on
 * our domain); `S3_MEDIA_MAX_GB` (30) leaves room in a 50 GB plan for the
 * database backups.
 */
export function mediaConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MediaConfig | null {
  const bucket = env.S3_MEDIA_BUCKET?.trim();
  const endpoint = env.S3_ENDPOINT?.trim().replace(/\/+$/, '');
  if (!bucket || !endpoint) return null;
  const publicBase = (
    env.S3_MEDIA_PUBLIC_BASE?.trim() || `${endpoint}/${bucket}`
  ).replace(/\/+$/, '');
  const maxGb = Number(env.S3_MEDIA_MAX_GB);
  return {
    bucket,
    publicBase,
    maxBytes: (Number.isFinite(maxGb) && maxGb > 0 ? maxGb : 30) * 1024 ** 3,
  };
}

/** Worth copying: an http(s) photo, not a supplier's «нет фото» asset. */
export function isMirrorable(sourceUrl: string): boolean {
  return (
    /^https?:\/\/[^/]+\//i.test(sourceUrl) && !isPlaceholderImageUrl(sourceUrl)
  );
}

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * The image type by its first bytes, or null when it is not one. Suppliers
 * answer a missing photo with a 200 HTML page often enough that the status
 * and the Content-Type header cannot be trusted.
 */
export function sniffImageType(body: Buffer): string | null {
  if (body.length < 12) return null;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)
    return 'image/jpeg';
  if (
    body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (body.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Host of a URL, lower-case; '' when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Rewrites the `images.create` rows a parser hands to Prisma: `sourceUrl` is
 * the supplier's URL, `url` our copy when one is stored. Parsers recreate a
 * product's image rows on every parse — without this the daily re-parse put
 * the supplier's URL back and the copy was used for a day at most.
 */
export function withImageSources<T>(
  images: T,
  storedUrl: (sourceUrl: string) => string | undefined,
): T {
  if (!images || typeof images !== 'object') return images;
  const nested = images as { create?: unknown };
  if (nested.create === undefined) return images;
  const rows = Array.isArray(nested.create) ? nested.create : [nested.create];
  const mapped = rows.map((row: Record<string, unknown>) => {
    const source = (row.sourceUrl as string | undefined) ?? (row.url as string);
    return { ...row, sourceUrl: source, url: storedUrl(source) ?? source };
  });
  return {
    ...images,
    create: Array.isArray(nested.create) ? mapped : mapped[0],
  };
}

/** Every supplier URL in the `images.create` of a parser's write. */
export function imageSourcesOf(images: unknown): string[] {
  const create = (images as { create?: unknown } | undefined)?.create;
  if (!create) return [];
  const rows = (Array.isArray(create) ? create : [create]) as Array<{
    url?: string;
    sourceUrl?: string;
  }>;
  return rows
    .map((row) => row.sourceUrl ?? row.url)
    .filter((url): url is string => typeof url === 'string');
}
