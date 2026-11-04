import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  verifyTotp,
} from './totp.util';

// RFC 6238 Appendix B (SHA-1), 8 digits; the 6-digit code is its tail.
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
] as const;

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, code] of RFC) {
      expect(hotp(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(code);
    }
  });

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(RFC_SECRET))).toEqual(RFC_SECRET);
    expect(base32Encode(RFC_SECRET)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('accepts the current code and one step either side, nothing further', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 59_000;
    expect(verifyTotp(secret, '287082', { now })).toBe(1);
    expect(verifyTotp(secret, hotp(RFC_SECRET, 2), { now })).toBe(2);
    expect(verifyTotp(secret, hotp(RFC_SECRET, 4), { now })).toBeNull();
    expect(verifyTotp(secret, '12345', { now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now })).toBeNull();
  });

  it('refuses a code already used', () => {
    const secret = base32Encode(RFC_SECRET);
    expect(
      verifyTotp(secret, '287082', { now: 59_000, lastStep: 1 }),
    ).toBeNull();
  });

  it('makes 160-bit secrets and an otpauth link', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(otpauthUrl(secret, 'admin@gost.by')).toMatch(
      /^otpauth:\/\/totp\/Gost\.by%3Aadmin%40gost\.by\?secret=[A-Z2-7]+&issuer=Gost\.by/,
    );
  });
});
