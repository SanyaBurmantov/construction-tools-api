import {
  categoryInstruction,
  nameHead,
  productInstruction,
  productTemplate,
} from './ai-templates';

const kind = (name: string, categoryPath = '') =>
  productTemplate({ name, categoryPath }).key;

describe('nameHead', () => {
  it('skips leading sizes and stops at a preposition', () => {
    expect(nameHead('10х100х160 мм бур (сверло) SDS-plus MAKITA')).toBe(
      'бур сверло',
    );
    expect(nameHead('Kлeщи для xoмутoв ШPУCa TOPTUL')).toBe('клещи');
    expect(nameHead('Аккум. перфоратор BOSCH GBH 18V-45 C в чем.')).toBe(
      'аккум. перфоратор',
    );
  });
});

describe('productTemplate', () => {
  it.each([
    [
      '10х100х160 мм бур (сверло) SDS-plus MAKITA',
      'Оснастка / Сверла по бетону для перфораторов SDS-plus',
      'drill_bits',
    ],
    [
      'Аккум. перфоратор BOSCH GBH 18V-45 C в чем.',
      'Электроинструмент / Аккумуляторные перфораторы',
      'cordless',
    ],
    [
      'Перфоратор MAKITA HR2470 в чем.',
      'Электроинструмент / Перфораторы',
      'power',
    ],
    [
      'Аккумулятор BULL AK 2001 18.0 В, 2.0 А/ч, Li-Ion XLTpro',
      'Аккумуляторный инструмент на 1 батарее BULL "XLTpro"',
      'battery',
    ],
    [
      'Аккум. газонокосилка MAKITA LXT DLM330Z в кор.',
      'Садовая техника / Газонокосилки',
      'garden',
    ],
    [
      'Анкер забиваемый М10х12х40 мм (4 шт в зип-локе) STARFIX',
      'Крепеж / Анкер забиваемый зип-лок',
      'fasteners',
    ],
    [
      'Вороток 1/2" 375мм с обрезиненной ручкой TOPTUL',
      'Ручной инструмент / Воротки',
      'bits_heads',
    ],
    [
      'Kлeщи для xoмутoв ШPУCa уcилeнныe TOPTUL',
      'Ручной инструмент / Автослесарный инструмент',
      'hand_tools',
    ],
    [
      'Алмазный круг 125х22 мм турбо-сегментный EXPERT STARTUL',
      'Оснастка / Алмазные круги Ф125мм',
      'abrasive',
    ],
    [
      'Набор головок 1/2" 24 предмета TOPTUL',
      'Наборы инструментов',
      'tool_set',
    ],
    [
      'Верстак складной BULL WB 2095 в кор. 200 кг',
      'Металлическая мебель / Верстаки',
      'storage',
    ],
    ['Компрессор BULL KT 2401 в кор.', 'Компрессоры', 'compressor'],
    ['Беруши STARTUL без шнурка', 'СИЗ / Наушники, беруши', 'ppe'],
    [
      'Брусок для шлифования 165х85мм STARTUL MASTER',
      'Отделка / Терки, гладилки',
      'abrasive',
    ],
    ['Что-то непонятное', '', 'generic'],
  ])('%s → %s', (name, path, expected) => {
    expect(kind(name, path)).toBe(expected);
  });
});

describe('instructions', () => {
  it('always carry the B2B payment line and the facts-only rule', () => {
    const text = productInstruction(
      productTemplate({ name: 'Анкер', categoryPath: '' }),
    );
    expect(text).toMatch(/оплата по безналу для организаций/);
    expect(text).toMatch(/только факты из входных данных/);
    expect(categoryInstruction()).toMatch(/оплата по безналу для организаций/);
  });
});
