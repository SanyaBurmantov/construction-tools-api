import { FEATURE_FLAGS, featureKey, resolveFlags } from './feature-flags';
import { FeatureFlagsService } from './feature-flags.service';

describe('feature flags', () => {
  const [first] = FEATURE_FLAGS;

  it('falls back to the default without a stored choice', () => {
    expect(resolveFlags(new Map())[first.key]).toBe(first.default);
  });

  it('takes a stored choice, ignores garbage', () => {
    expect(
      resolveFlags(new Map([[featureKey(first.key), 'admins']]))[first.key],
    ).toBe('admins');
    expect(
      resolveFlags(new Map([[featureKey(first.key), 'maybe']]))[first.key],
    ).toBe(first.default);
  });

  it('isOn: admins mode only for an admin; refuses unknown flags and modes', async () => {
    const rows: Array<{ key: string; value: string }> = [];
    const prisma = {
      siteSetting: {
        findMany: jest.fn(() => Promise.resolve(rows)),
        upsert: jest.fn((args: { create: { key: string; value: string } }) => {
          rows.splice(0, rows.length, args.create);
          return Promise.resolve(args.create);
        }),
      },
    };
    const service = new FeatureFlagsService(prisma as never);
    await service.setMode(first.key, 'admins');
    expect(await service.isOn(first.key)).toBe(false);
    expect(await service.isOn(first.key, true)).toBe(true);
    await expect(service.setMode('nope', 'on')).rejects.toThrow();
    await expect(service.setMode(first.key, 'maybe')).rejects.toThrow();
  });
});
