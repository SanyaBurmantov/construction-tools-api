import {
  labelledRows,
  metrikaDevice,
  monthsFromBytime,
  notFoundRows,
  pathRows,
  periodTotals,
  visitsByDay,
} from './metrika-report';

describe('metrika-report', () => {
  it('maps device ids, a TV counting as a computer', () => {
    expect(metrikaDevice('mobile')).toBe('mobile');
    expect(metrikaDevice('tablet')).toBe('tablet');
    expect(metrikaDevice('desktop')).toBe('desktop');
    expect(metrikaDevice('tv')).toBe('desktop');
    expect(metrikaDevice(null)).toBe('desktop');
  });

  it('takes period totals from Metrika (users are not summed across devices)', () => {
    const totals = periodTotals({
      data: [
        {
          dimensions: [{ id: 'mobile', name: 'Смартфоны' }],
          metrics: [60, 50, 200],
        },
        { dimensions: [{ id: 'desktop', name: 'ПК' }], metrics: [40, 35, 160] },
        { dimensions: [{ id: 'tv', name: 'ТВ' }], metrics: [1, 1, 2] },
      ],
      totals: [101, 80, 362],
    });
    expect(totals).toEqual({
      visits: 101,
      visitors: 80,
      views: 362,
      devices: { mobile: 60, desktop: 41, tablet: 0 },
    });
  });

  it('puts monthly bytime data onto the screen months, zero where missing', () => {
    const rows = monthsFromBytime(
      ['2026-09', '2026-10', '2026-11'],
      {
        time_intervals: [
          ['2026-10-01', '2026-10-31'],
          ['2026-11-01', '2026-11-05'],
        ],
        data: [
          {
            dimensions: [{ id: 'mobile' }],
            metrics: [
              [300, 80],
              [250, 70],
              [900, 240],
            ],
          },
          {
            dimensions: [{ id: 'desktop' }],
            metrics: [
              [200, 20],
              [180, 18],
              [700, 60],
            ],
          },
        ],
        totals: [
          [500, 100],
          [400, 85],
          [1600, 300],
        ],
      },
      {
        time_intervals: [
          ['2026-10-01', '2026-10-31'],
          ['2026-11-01', '2026-11-05'],
        ],
        totals: [[12, 3]],
      },
    );
    expect(rows[0]).toMatchObject({ month: '2026-09', visits: 0, notFound: 0 });
    expect(rows[1]).toEqual({
      month: '2026-10',
      visits: 500,
      visitors: 400,
      views: 1600,
      notFound: 12,
      devices: { mobile: 300, desktop: 200, tablet: 0 },
    });
    expect(rows[2]).toMatchObject({
      visits: 100,
      notFound: 3,
      devices: { mobile: 80, desktop: 20, tablet: 0 },
    });
  });

  it('reads daily visits', () => {
    const map = visitsByDay({
      time_intervals: [
        ['2026-11-01', '2026-11-01'],
        ['2026-11-02', '2026-11-02'],
      ],
      totals: [[7, 9]],
    });
    expect(map.get('2026-11-02')).toBe(9);
  });

  it('groups 404 views by path with the main referer', () => {
    const rows = notFoundRows({
      data: [
        {
          dimensions: [
            { name: 'https://gost.by/siz/zaschita-ruk/' },
            { name: 'https://yandex.by/search/' },
          ],
          metrics: [5],
        },
        {
          dimensions: [
            { name: 'https://gost.by/siz/zaschita-ruk/' },
            { name: null },
          ],
          metrics: [2],
        },
        {
          dimensions: [
            { name: 'https://gost.by/about_us' },
            { name: 'https://example.org/' },
          ],
          metrics: [1],
        },
      ],
    });
    expect(rows[0]).toEqual({
      path: '/siz/zaschita-ruk/',
      views: 7,
      visitors: 0,
      referrer: 'https://yandex.by/search/',
      lastAt: null,
    });
    expect(rows[1].path).toBe('/about_us');
  });

  it('labels sources and folds URLs to paths', () => {
    expect(
      labelledRows({
        data: [
          {
            dimensions: [
              { name: 'Переходы из поисковых систем' },
              { name: 'Яндекс' },
            ],
            metrics: [10],
          },
          {
            dimensions: [{ name: 'Прямые заходы' }, { name: null }],
            metrics: [4],
          },
        ],
      }),
    ).toEqual([
      { label: 'Переходы из поисковых систем · Яндекс', value: 10 },
      { label: 'Прямые заходы', value: 4 },
    ]);
    expect(
      pathRows({
        data: [
          {
            dimensions: [{ name: 'https://gost.by/catalog?page=2' }],
            metrics: [3],
          },
          { dimensions: [{ name: 'https://gost.by/catalog' }], metrics: [2] },
        ],
      }),
    ).toEqual([{ path: '/catalog', value: 5 }]);
  });
});
