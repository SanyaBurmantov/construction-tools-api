/** Our storefront's hosts: gost.by and whatever PUBLIC_ORIGIN / CORS_ORIGIN name. */
export function ourHosts(): Set<string> {
  const hosts = new Set(['gost.by', 'www.gost.by']);
  for (const origin of [process.env.PUBLIC_ORIGIN, process.env.CORS_ORIGIN]) {
    for (const part of (origin ?? '').split(',')) {
      try {
        hosts.add(new URL(part.trim()).hostname.toLowerCase());
      } catch {
        /* not a URL */
      }
    }
  }
  return hosts;
}
