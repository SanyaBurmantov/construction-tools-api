import {
  attributionColumns,
  hasSource,
  isOwnHost,
  trafficSourceLabel,
} from './traffic-source';

describe('trafficSourceLabel', () => {
  it('trusts UTM tags first, lower-cased', () => {
    expect(
      trafficSourceLabel({ utmSource: 'Yandex', utmMedium: 'CPC', yclid: '1' }),
    ).toBe('yandex / cpc');
    expect(trafficSourceLabel({ utmSource: 'onliner' })).toBe(
      'onliner / (not set)',
    );
  });

  it('recognises ad clicks without tags', () => {
    expect(trafficSourceLabel({ yclid: '123' })).toBe('yandex / cpc');
    expect(trafficSourceLabel({ gclid: 'abc' })).toBe('google / cpc');
  });

  it('classifies referrers: search, social, everything else', () => {
    expect(trafficSourceLabel({ referrer: 'yandex.by' })).toBe(
      'yandex / organic',
    );
    expect(trafficSourceLabel({ referrer: 'ya.ru' })).toBe('yandex / organic');
    expect(trafficSourceLabel({ referrer: 'www.google.com' })).toBe(
      'google / organic',
    );
    expect(trafficSourceLabel({ referrer: 'go.mail.ru' })).toBe(
      'mail.ru / organic',
    );
    expect(trafficSourceLabel({ referrer: 't.me' })).toBe('t.me / social');
    expect(trafficSourceLabel({ referrer: 'm.vk.com' })).toBe(
      'm.vk.com / social',
    );
    expect(trafficSourceLabel({ referrer: 'catalog.onliner.by' })).toBe(
      'catalog.onliner.by / referral',
    );
  });

  it('calls no tags and no referrer direct', () => {
    expect(trafficSourceLabel({})).toBe('direct');
    expect(trafficSourceLabel(null)).toBe('direct');
    expect(hasSource({ landing: '/catalog' })).toBe(false);
  });

  it('does not take a lookalike for a search engine', () => {
    expect(trafficSourceLabel({ referrer: 'notyandex.com' })).toBe(
      'notyandex.com / referral',
    );
    expect(trafficSourceLabel({ referrer: 'google.evil.com' })).toBe(
      'google.evil.com / referral',
    );
  });
});

describe('isOwnHost', () => {
  it('ignores www and case', () => {
    expect(isOwnHost('WWW.gost.by', ['gost.by'])).toBe(true);
    expect(isOwnHost('shop.gost.by', ['gost.by'])).toBe(false);
  });
});

describe('attributionColumns', () => {
  it('credits the last touch that had a source', () => {
    const columns = attributionColumns({
      first: { referrer: 'yandex.by' },
      last: { utmSource: 'yandex', utmMedium: 'cpc' },
    });
    expect(columns.trafficSource).toBe('yandex / cpc');
    expect(columns.firstTrafficSource).toBe('yandex / organic');
  });

  it('falls back to the first touch when the last one was direct', () => {
    const columns = attributionColumns({
      first: { utmSource: 'onliner', utmMedium: 'referral' },
      last: { landing: '/cart' },
    });
    expect(columns.trafficSource).toBe('onliner / referral');
  });

  it('is direct with nothing sent, and stores no raw data', () => {
    expect(attributionColumns(undefined)).toEqual({
      trafficSource: 'direct',
      firstTrafficSource: null,
      attribution: undefined,
    });
  });
});
