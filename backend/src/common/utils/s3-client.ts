import { createHash, createHmac } from 'node:crypto';
import { fetchWithTimeout } from './fetch-with-timeout';

/**
 * A minimal S3 client: AWS Signature V4 over `fetch`, path-style URLs. It is
 * what hoster.by's MinIO needs for a few calls — put, head, bucket and its
 * policy — and costs no dependency (`@aws-sdk/client-s3` is ~3 MB of modules
 * for four requests, the same reasoning that removed axios).
 *
 * Configuration (`S3_*`, shared with deploy/backup-db.sh):
 *   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION (us-east-1).
 * Any of the first three missing = not configured.
 */
export type S3Config = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
};

export function s3ConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): S3Config | null {
  const endpoint = env.S3_ENDPOINT?.trim().replace(/\/+$/, '');
  const accessKey = env.S3_ACCESS_KEY?.trim();
  const secretKey = env.S3_SECRET_KEY?.trim();
  if (!endpoint || !accessKey || !secretKey) return null;
  return {
    endpoint,
    accessKey,
    secretKey,
    region: env.S3_REGION?.trim() || 'us-east-1',
  };
}

const sha256Hex = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it (`encodeURIComponent` leaves `!'()*`). */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Signs a request: returns the headers to send (`host` excluded — fetch sets
 * it, and it is signed from the URL). `payloadHash` is the hex SHA-256 of the
 * body or `UNSIGNED-PAYLOAD`. Pure given `now`, so it is tested against the
 * example in AWS's own documentation.
 */
export function signS3Request(params: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  payloadHash: string;
  accessKey: string;
  secretKey: string;
  region: string;
  now?: Date;
}): Record<string, string> {
  const url = new URL(params.url);
  const amzDate = (params.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(params.headers ?? {})) {
    headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  }
  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = params.payloadHash;
  const signed: Record<string, string> = { ...headers, host: url.host };
  const names = Object.keys(signed).sort();

  const canonicalPath = url.pathname
    .split('/')
    .map((segment) => uriEncode(decodeURIComponent(segment)))
    .join('/');
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalPath || '/',
    canonicalQuery,
    names.map((name) => `${name}:${signed[name]}\n`).join(''),
    names.join(';'),
    params.payloadHash,
  ].join('\n');

  const scope = `${day}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${params.secretKey}`, day), params.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign)
    .digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class S3Client {
  constructor(private readonly config: S3Config) {}

  objectUrl(bucket: string, key = ''): string {
    const path = key
      .split('/')
      .map((segment) => uriEncode(segment))
      .join('/');
    return `${this.config.endpoint}/${bucket}${key ? `/${path}` : ''}`;
  }

  private async request(
    method: string,
    url: string,
    body?: Buffer | string,
    headers: Record<string, string> = {},
    timeoutMs = 60_000,
  ): Promise<Response> {
    const payload =
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : Buffer.from(body);
    const signedHeaders = signS3Request({
      method,
      url,
      headers,
      payloadHash: sha256Hex(payload ?? ''),
      accessKey: this.config.accessKey,
      secretKey: this.config.secretKey,
      region: this.config.region,
    });
    // The signature carries x-amz-date, so a retry must be re-signed — hence
    // retries: 0 here and the callers' own retry policy.
    return fetchWithTimeout(
      url,
      {
        method,
        headers: signedHeaders,
        body: payload ? new Uint8Array(payload) : undefined,
      },
      { timeoutMs, retries: 0 },
    );
  }

  private async expectOk(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new S3Error(
      res.status,
      `S3 ${what}: HTTP ${res.status}${code ? ` ${code}` : ''}`,
    );
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    headers: Record<string, string> = {},
  ): Promise<void> {
    const res = await this.request(
      'PUT',
      this.objectUrl(bucket, key),
      body,
      headers,
    );
    await this.expectOk(res, `put ${key}`);
  }

  /** Size of an object, or null when there is none. */
  async headObject(bucket: string, key: string): Promise<number | null> {
    const res = await this.request(
      'HEAD',
      this.objectUrl(bucket, key),
      undefined,
      {},
      20_000,
    );
    if (res.status === 404) return null;
    await this.expectOk(res, `head ${key}`);
    return Number(res.headers.get('content-length') ?? 0);
  }

  /** Creates the bucket; one that is already ours is fine. */
  async ensureBucket(bucket: string): Promise<void> {
    const res = await this.request(
      'PUT',
      this.objectUrl(bucket),
      undefined,
      {},
      20_000,
    );
    if (res.status === 409) return; // BucketAlreadyOwnedByYou
    await this.expectOk(res, `create bucket ${bucket}`);
  }

  async putBucketPolicy(bucket: string, policy: object): Promise<void> {
    const res = await this.request(
      'PUT',
      `${this.objectUrl(bucket)}?policy=`,
      JSON.stringify(policy),
      { 'content-type': 'application/json' },
      20_000,
    );
    await this.expectOk(res, `policy ${bucket}`);
  }
}

/** Anyone may read an object by its exact key; listing stays closed. */
export function publicReadPolicy(bucket: string): object {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
}
