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

  it('withdraws the price when the page says it is on request', () => {
    // dukon.by keeps «1 руб.» in the hidden price block of such items.
    expect(offerPrice(1, false, true)).toBeNull();
    expect(offerPrice(undefined, false, true)).toBeNull();
  });
});

describe('stuckAfterHours', () => {
  it('gives a catalogue crawl longer than a batch before calling it hung', () => {
    expect(stuckAfterHours('dukon-refresh')).toBe(12);
    expect(stuckAfterHours('dukon-process')).toBe(6);
  });
});
