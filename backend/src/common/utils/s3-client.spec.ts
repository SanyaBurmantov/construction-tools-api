import {
  deleteObjectsXml,
  parseDeleteErrors,
  s3ConfigFromEnv,
  signS3Request,
} from './s3-client';

describe('signS3Request', () => {
  // "Example: GET Object" from the AWS Signature V4 documentation for S3
  // (sig-v4-header-based-auth): the published signature for these inputs.
  it('matches the AWS documentation example', () => {
    const headers = signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
      payloadHash:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
    expect(headers.host).toBeUndefined();
  });
});

describe('s3ConfigFromEnv', () => {
  it('is null until endpoint and both keys are set', () => {
    expect(s3ConfigFromEnv({ S3_ENDPOINT: 'https://s3.example' })).toBeNull();
    expect(
      s3ConfigFromEnv({
        S3_ENDPOINT: 'https://s3.example/',
        S3_ACCESS_KEY: 'a',
        S3_SECRET_KEY: 'b',
      }),
    ).toEqual({
      endpoint: 'https://s3.example',
      accessKey: 'a',
      secretKey: 'b',
      region: 'us-east-1',
    });
  });
});

describe('DeleteObjects body and answer', () => {
  it('lists every key, escaped, in quiet mode', () => {
    const xml = deleteObjectsXml(['v/ab/1/160.webp', 'b/a&b.webp']);
    expect(xml).toContain('<Quiet>true</Quiet>');
    expect(xml).toContain('<Object><Key>v/ab/1/160.webp</Key></Object>');
    expect(xml).toContain('<Key>b/a&amp;b.webp</Key>');
  });

  it('reads the refused keys and nothing else', () => {
    const answer = `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<Deleted><Key>v/ab/1/1200.webp</Key></Deleted>
<Error><Key>v/ab/2/160.webp</Key><Code>AccessDenied</Code><Message>no</Message></Error>
<Error><Key>b/a&amp;b.webp</Key><Code>InternalError</Code></Error>
</DeleteResult>`;
    expect(parseDeleteErrors(answer)).toEqual([
      { key: 'v/ab/2/160.webp', code: 'AccessDenied' },
      { key: 'b/a&b.webp', code: 'InternalError' },
    ]);
    expect(parseDeleteErrors('<DeleteResult></DeleteResult>')).toEqual([]);
  });
});
