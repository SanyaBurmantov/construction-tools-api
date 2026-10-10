import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with `node:crypto`'s scrypt — no native build step and no
 * extra dependency, which matters because the images are `node:22-slim`
 * (bcrypt's node-gyp build needs a toolchain that isn't there).
 *
 * Stored format: `scrypt$N$r$p$keylen$saltBase64$hashBase64`. The parameters
 * travel with the hash, so raising the cost later still verifies old
 * passwords.
 */
const SCRYPT_N = 16384; // CPU/memory cost — ~16 MB per hash at r=8.
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** scrypt needs maxmem above 128 * N * r, which exceeds the 32 MB default. */
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keylen: number,
): Promise<Buffer> {
  // Promisified by hand: `util.promisify(scrypt)` loses the options overload.
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      keylen,
      { N: n, r, p, maxmem: Math.max(MAX_MEM, 128 * n * r * 2) },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(
    password,
    salt,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    KEY_LENGTH,
  );
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    KEY_LENGTH,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Verifies a password against a stored hash. Returns false — never throws —
 * for a malformed or unknown-format hash, so a corrupted row is a failed login
 * rather than a 500 on the login endpoint.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, rawKeylen, rawSalt, rawHash] = parts;
  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  const keylen = Number(rawKeylen);
  if (![n, r, p, keylen].every((value) => Number.isInteger(value) && value > 0))
    return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(rawHash, 'base64');
    if (expected.length !== keylen) return false;
  } catch {
    return false;
  }

  try {
    const actual = await derive(
      password,
      Buffer.from(rawSalt, 'base64'),
      n,
      r,
      p,
      keylen,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Why a password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Пароль не должен быть длиннее ${MAX_PASSWORD_LENGTH} символов`;
  return null;
}
