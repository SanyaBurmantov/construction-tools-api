import { fetchWithTimeout } from '../../common/utils/fetch-with-timeout';
import { emptySnapshot } from './supplier-connection';
import type { SupplierConnectionService } from './supplier-connection.service';

/**
 * For specs: a connection that always goes direct, records nothing and never
 * blocks — requests still go through `fetchWithTimeout`, so a mocked global
 * `fetch` sees them exactly as before.
 */
export function directConnection(): SupplierConnectionService {
  const decision = {
    mode: 'off' as const,
    route: 'DIRECT' as const,
    proxyConfigured: false,
    usable: true,
    snapshot: emptySnapshot(),
  };
  return {
    fetch: (url: string, init?: RequestInit, options?: object) =>
      fetchWithTimeout(url, init, options),
    routeFor: () => Promise.resolve(decision),
    assertUsable: () => Promise.resolve(decision),
    describeBlock: () => '',
  } as unknown as SupplierConnectionService;
}
