import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * «Check a page by its address» makes our server fetch a URL someone typed.
 * Admin-only, but still a request from inside the compose network: without a
 * guard `http://backend:8000/…`, `http://db:5432`, the host's `127.0.0.1`
 * or a cloud metadata address would be fetched and their text shown back
 * (SSRF). So: http(s) only, default ports only, and every address the host
 * name resolves to must be public — re-checked on each redirect hop.
 *
 * Residual risk, accepted for an admin tool: a DNS answer that changes
 * between this check and the fetch (rebinding). Closing that needs pinning
 * the socket to the checked address, which `fetch` cannot do.
 */
export class UnsafeUrlError extends Error {}

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // docker's default networks live here
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

function v4ToInt(ip: string) {
  return ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const n = v4ToInt(ip);
    return !BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]);
    if (lower === '::' || lower === '::1') return false;
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
    return !/^(f[cd]|fe[89ab]|ff)/.test(lower);
  }
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Parses and vets one URL; throws `UnsafeUrlError` with a readable reason. */
export async function assertPublicUrl(
  raw: string,
  resolve: Resolver = systemResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('Это не адрес страницы');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Нужен адрес http:// или https://');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('Адрес с логином и паролем не проверяем');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new UnsafeUrlError('Только стандартные порты 80 и 443');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new UnsafeUrlError(`Сайт ${host} не найден`);
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) {
    throw new UnsafeUrlError('Внутренние адреса не проверяем');
  }
  return url;
}
