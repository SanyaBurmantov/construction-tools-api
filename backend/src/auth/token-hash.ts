import { createHash } from 'node:crypto';

/**
 * How every opaque token (session, e-mail confirmation) is stored: SHA-256,
 * hex. A database dump then holds nothing that can be replayed.
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
