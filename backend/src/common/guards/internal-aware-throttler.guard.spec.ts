import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle, type ThrottlerStorage } from '@nestjs/throttler';
import {
  InternalAwareThrottlerGuard,
  isInternalAddress,
} from './internal-aware-throttler.guard';

describe('isInternalAddress', () => {
  it.each([
    '172.18.0.4',
    '::ffff:172.18.0.4',
    '10.0.0.1',
    '192.168.1.10',
    '127.0.0.1',
    '::1',
    'fd00::1',
  ])('treats %s as the internal network', (ip) => {
    expect(isInternalAddress(ip)).toBe(true);
  });

  it.each([
    '93.84.1.2',
    '172.32.0.1',
    '8.8.8.8',
    '2a00:1450::1',
    '',
    undefined,
  ])('throttles %s like any visitor', (ip) => {
    expect(isInternalAddress(ip)).toBe(false);
  });
});

describe('InternalAwareThrottlerGuard', () => {
  class Plain {
    open() {}
  }
  class Limited {
    @Throttle({ default: { limit: 5, ttl: 60_000 } })
    expensive() {}
  }

  async function skips(ip: string, target: object, handler: string) {
    const guard = new InternalAwareThrottlerGuard(
      [{ limit: 120, ttl: 60_000 }],
      {} as ThrottlerStorage,
      new Reflector(),
    );
    await guard.onModuleInit();
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ ip }) }),
      getHandler: () => (target as Record<string, unknown>)[handler],
      getClass: () => target.constructor,
    } as unknown as ExecutionContext;
    return (
      guard as unknown as { shouldSkip(c: ExecutionContext): Promise<boolean> }
    ).shouldSkip(context);
  }

  it('lets SSR past the global limit', async () => {
    expect(await skips('172.18.0.4', new Plain(), 'open')).toBe(true);
  });

  it('keeps a route-level @Throttle for internal peers too', async () => {
    expect(await skips('172.18.0.4', new Limited(), 'expensive')).toBe(false);
  });

  it('throttles the public as before', async () => {
    expect(await skips('93.84.1.2', new Plain(), 'open')).toBe(false);
  });
});
