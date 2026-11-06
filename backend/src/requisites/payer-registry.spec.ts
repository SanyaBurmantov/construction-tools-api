import {
  parsePayerRegistry,
  payerProblem,
  prettifyQuotes,
} from './payer-registry';

// The registry's real answer for our own seller, 2026-11-06.
const MULTITOOL = {
  row: {
    vunp: '391807521',
    vnaimp: 'Общество с ограниченной ответственностью "МультиТул"',
    vnaimk: 'ООО "МультиТул"',
    vpadres:
      'Республика Беларусь, Витебская область, Октябрьский район, г. Витебск, ПР. ФРУНЗЕ, дом 39А, каб. 17',
    dreg: '2016-05-03',
    nmns: '363',
    vmns: 'Инспекция МНС по Октябрьскому району г.Витебска',
    ckodsost: '1',
    vkods: 'Действующий',
    dlikv: null,
    vlikv: null,
  },
};

describe('parsePayerRegistry', () => {
  it('reads an active organisation', () => {
    const lookup = parsePayerRegistry(200, MULTITOOL);
    expect(lookup).toEqual({
      status: 'found',
      payer: {
        unp: '391807521',
        name: 'Общество с ограниченной ответственностью «МультиТул»',
        shortName: 'ООО «МультиТул»',
        address: MULTITOOL.row.vpadres,
        state: 'Действующий',
        active: true,
      },
    });
    expect(payerProblem(lookup)).toBeNull();
  });

  it('treats «Нет данных по запросу» as an unknown УНП', () => {
    const lookup = parsePayerRegistry(400, {
      status: 400,
      error: 'Bad Request',
      message: 'Нет данных по запросу',
    });
    expect(lookup).toEqual({ status: 'not_found' });
    expect(payerProblem(lookup)).toMatch(/не найден/);
  });

  it('refuses a liquidated payer', () => {
    const lookup = parsePayerRegistry(200, {
      row: {
        ...MULTITOOL.row,
        ckodsost: '3',
        vkods: 'Ликвидирован',
        dlikv: '2024-01-10',
      },
    });
    expect(lookup.status).toBe('found');
    expect(lookup.status === 'found' && lookup.payer.active).toBe(false);
    expect(payerProblem(lookup)).toBe(
      'ООО «МультиТул»: ликвидирован по данным реестра плательщиков — счёт выставить нельзя',
    );
  });

  it('falls back to the state text when there is no code', () => {
    const lookup = parsePayerRegistry(200, {
      row: { ...MULTITOOL.row, ckodsost: null, vkods: 'Исключён из ЕГР' },
    });
    expect(lookup.status === 'found' && lookup.payer.active).toBe(false);
  });

  it('never blocks on an answer it does not understand', () => {
    for (const [status, body] of [
      [500, { message: 'Internal' }],
      [400, { message: 'Parameter unp is required' }],
      [200, { row: {} }],
      [200, null],
      [200, '<html>maintenance</html>'],
    ] as const) {
      const lookup = parsePayerRegistry(status, body);
      expect(lookup).toEqual({ status: 'unavailable' });
      expect(payerProblem(lookup)).toBeNull();
    }
  });
});

describe('prettifyQuotes', () => {
  it('turns straight quotes into «ёлочки»', () => {
    expect(prettifyQuotes('ЧТУП "Ромашка" и ООО "Лютик"')).toBe(
      'ЧТУП «Ромашка» и ООО «Лютик»',
    );
  });
});
