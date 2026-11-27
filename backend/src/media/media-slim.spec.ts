import { slimPlan } from './media-slim';

const sha = 'ab' + 'c'.repeat(38);
const set = `v/ab/${sha}/`;

describe('slimPlan', () => {
  it('keeps 320 and 640 of an old four-size set and names it by the 640', () => {
    expect(slimPlan(`${set}1200.webp`)).toEqual({
      key: `${set}640.webp`,
      keep: [`${set}320.webp`, `${set}640.webp`],
      drop: [`${set}160.webp`, `${set}1200.webp`],
    });
  });

  it('drops both old caps again on a retry, after the key became 640', () => {
    expect(slimPlan(`${set}640.webp`)?.drop).toEqual([
      `${set}160.webp`,
      `${set}1200.webp`,
    ]);
  });

  it('takes the 160 from a small original and keeps its 320', () => {
    expect(slimPlan(`${set}320.webp`)).toEqual({
      key: `${set}320.webp`,
      keep: [`${set}320.webp`],
      drop: [`${set}160.webp`, `${set}1200.webp`],
    });
  });

  it('leaves a set whose only file is the 160, and anything that is not a set', () => {
    expect(slimPlan(`${set}160.webp`)).toBeNull();
    expect(slimPlan('b/banner.webp')).toBeNull();
    expect(slimPlan(`${set}800.webp`)).toBeNull();
  });
});
