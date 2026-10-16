import { isInternalAddress } from './internal-aware-throttler.guard';

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
