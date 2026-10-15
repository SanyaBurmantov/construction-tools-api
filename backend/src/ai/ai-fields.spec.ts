import {
  AI_FIELDS,
  buildMessages,
  cleanValue,
  diffAnswer,
  fieldDefs,
  isKnownField,
  parseAnswer,
} from './ai-fields';

const seoTitle = AI_FIELDS.PRODUCT.find((field) => field.key === 'seoTitle')!;
const full = AI_FIELDS.PRODUCT.find(
  (field) => field.key === 'descriptionFull',
)!;

describe('parseAnswer', () => {
  it('reads a plain items object', () => {
    const map = parseAnswer('{"items":[{"id":"a","seoTitle":"T"}]}');
    expect(map.get('a')).toEqual({ id: 'a', seoTitle: 'T' });
  });

  it('tolerates code fences and chatter around the JSON', () => {
    const map = parseAnswer(
      'Вот ответ:\n```json\n{"items":[{"id":"a","seoTitle":"T"}]}\n```\nГотово',
    );
    expect(map.get('a')?.seoTitle).toBe('T');
  });

  it('accepts a bare array and numeric ids', () => {
    const map = parseAnswer('[{"id":7,"name":"X"}]');
    expect(map.get('7')?.name).toBe('X');
  });

  it('throws on something that is not JSON', () => {
    expect(() => parseAnswer('Извините, не могу')).toThrow('не JSON');
  });

  it('throws when there is no list', () => {
    expect(() => parseAnswer('{"ok":true}')).toThrow('items');
  });
});

describe('cleanValue', () => {
  it('never blanks a field', () => {
    expect(cleanValue(seoTitle, '   ')).toBeUndefined();
    expect(cleanValue(seoTitle, null)).toBeUndefined();
    expect(cleanValue(seoTitle, 42)).toBeUndefined();
  });

  it('strips HTML and collapses whitespace in one-line fields', () => {
    expect(cleanValue(seoTitle, '<b>Дрель</b>\n  Bosch')).toBe('Дрель Bosch');
  });

  it('keeps paragraphs in the full description', () => {
    expect(cleanValue(full, 'Абзац 1\n\n\n\nАбзац 2')).toBe(
      'Абзац 1\n\nАбзац 2',
    );
  });

  it('cuts an overlong value at a word boundary', () => {
    const value = cleanValue(seoTitle, 'слово '.repeat(40))!;
    expect(value.length).toBeLessThanOrEqual(seoTitle.maxLength);
    expect(value.endsWith('слово')).toBe(true);
  });
});

describe('diffAnswer', () => {
  it('reports only fields that actually change, and only the ones asked for', () => {
    const fields = fieldDefs('PRODUCT', ['seoTitle', 'descriptionShort']);
    const changes = diffAnswer(
      fields,
      { seoTitle: 'Старый', descriptionShort: 'Тот же', name: 'N' },
      {
        id: 'a',
        seoTitle: 'Новый',
        descriptionShort: 'Тот же',
        name: 'Не просили',
      },
    );
    expect(changes).toEqual({ seoTitle: { old: 'Старый', new: 'Новый' } });
  });

  it('treats a missing current value as null', () => {
    const changes = diffAnswer(
      fieldDefs('PRODUCT', ['seoTitle']),
      { seoTitle: null },
      { seoTitle: 'Новый' },
    );
    expect(changes.seoTitle.old).toBeNull();
  });
});

describe('fields', () => {
  it('never offers price or identity columns', () => {
    for (const key of ['priceValue', 'slug', 'sku', 'barcode', 'categoryId']) {
      expect(isKnownField('PRODUCT', key)).toBe(false);
    }
  });
});

describe('buildMessages', () => {
  it('lists the fields and embeds every context', () => {
    const [system, user] = buildMessages({
      entity: 'PRODUCT',
      fields: fieldDefs('PRODUCT', ['seoTitle']),
      instruction: 'Сделай SEO',
      contexts: [
        { id: 'p1', name: 'Дрель' },
        { id: 'p2', name: 'Пила' },
      ],
    });
    expect(system.content).toContain('"seoTitle"');
    expect(system.content).not.toContain('"descriptionFull"');
    expect(user.content).toContain('Сделай SEO');
    expect(user.content).toContain('"p2"');
  });
});
