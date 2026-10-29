import { offerPrice } from './offer-price';
import { stuckAfterHours } from './parser-runtime-status.service';

describe('offerPrice', () => {
  it('takes the price the page shows', () => {
    expect(offerPrice(12.5, false)).toBe(12.5);
    expect(offerPrice(12.5, true)).toBe(12.5);
  });

  it('withdraws the price of an item that is out of stock and unpriced', () => {
    expect(offerPrice(undefined, true)).toBeNull();
    expect(offerPrice(0, true)).toBeNull();
  });

  it('leaves the stored price alone when an in-stock page shows none', () => {
    expect(offerPrice(undefined, false)).toBeUndefined();
    expect(offerPrice(Number.NaN, false)).toBeUndefined();
  });
});

describe('stuckAfterHours', () => {
  it('gives a catalogue crawl longer than a batch before calling it hung', () => {
    expect(stuckAfterHours('dukon-refresh')).toBe(12);
    expect(stuckAfterHours('dukon-process')).toBe(6);
  });
});
