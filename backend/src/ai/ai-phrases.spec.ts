import { AI_FIELDS, cleanValue, diffAnswer } from './ai-fields';
import { protectPhrases, quotedPhrases, withoutPhrases } from './ai-phrases';
import { validateAnswer } from './ai-validate';

const field = (key: string) =>
  AI_FIELDS.PRODUCT.find((item) => item.key === key)!;

describe('quotedPhrases', () => {
  it('takes phrases of two words or more in any quotes, from the general text and every field', () => {
    expect(
      quotedPhrases({
        general: 'Везде добавляй «купить в Минске по низким ценам».',
        fields: {
          seoTitle: 'В конце "оптом и в розницу"',
          descriptionFull: 'Добавь “доставка по Беларуси” и „со склада“',
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        'купить в Минске по низким ценам',
        'оптом и в розницу',
        'доставка по Беларуси',
        'со склада',
      ]),
    );
  });

  it('skips single words (examples, prohibitions) and unfilled [placeholders]', () => {
    expect(
      quotedPhrases({
        general: 'Не пиши «лучший». Фраза: «[тип товара] купить в Минске».',
      }),
    ).toEqual([]);
  });

  it('is empty without parts', () => {
    expect(quotedPhrases(null)).toEqual([]);
    expect(quotedPhrases({})).toEqual([]);
  });

  it('lists the longest first', () => {
    expect(
      quotedPhrases({ general: '«в Минске» и «купить в Минске недорого»' }),
    ).toEqual(['купить в Минске недорого', 'в Минске']);
  });
});

describe('protectPhrases / withoutPhrases', () => {
  it('hides a phrase from a cleaner and puts it back as written', () => {
    const out = protectPhrases(
      'Бур SDS-plus. Купить в Минске по низким ценам.',
      ['купить в Минске по низким ценам'],
      (text) => text.replace(/Минске/g, ''),
    );
    expect(out).toBe('Бур SDS-plus. Купить в Минске по низким ценам.');
  });

  it('matches across case, extra spaces and ё/е', () => {
    expect(
      withoutPhrases('Тут КУПИТЬ  в   минске, да', ['купить в Минске']),
    ).toBe('Тут  , да');
    expect(withoutPhrases('Ещё раз', ['еще раз'])).toBe(' ');
  });
});

describe('the admin’s phrase reaches the card', () => {
  const phrases = ['купить в Минске по низким ценам'];
  const description =
    'Бур SDS-plus 10х160 мм для перфоратора, сверление бетона и кирпича. Купить в Минске по низким ценам.';

  it('used to be cut by the supplier-boilerplate cleaner', () => {
    expect(cleanValue(field('descriptionFull'), description)).not.toMatch(
      /низким ценам/,
    );
  });

  it('survives the cleaner when the task quoted it', () => {
    expect(cleanValue(field('descriptionFull'), description, phrases)).toBe(
      description,
    );
  });

  it('keeps «купить в Минске» at the end of an SEO title', () => {
    const changes = diffAnswer(
      [field('seoTitle')],
      { seoTitle: null },
      { seoTitle: 'Бур SDS-plus 10х160 мм STARTUL купить в Минске' },
      ['купить в Минске'],
    );
    expect(changes.seoTitle.new).toBe(
      'Бур SDS-plus 10х160 мм STARTUL купить в Минске',
    );
  });

  it('passes the checks: a number or a claim inside the phrase is the admin’s, not invented', () => {
    const input = {
      entity: 'PRODUCT' as const,
      source: 'Бур SDS-plus 10х160 мм STARTUL',
      oldName: 'Бур SDS-plus 10х160 мм STARTUL',
    };
    const value = {
      descriptionShort:
        'Бур SDS-plus 10х160 мм для бетона. Бесплатная доставка от 300 рублей по Минску.',
    };
    expect(validateAnswer(input, value).descriptionShort).toBeTruthy();
    expect(
      validateAnswer(
        { ...input, allowed: ['Бесплатная доставка от 300 рублей по Минску'] },
        value,
      ),
    ).toEqual({});
  });

  it('still refuses what the model invented next to the phrase', () => {
    expect(
      validateAnswer(
        {
          entity: 'PRODUCT',
          source: 'Бур SDS-plus 10х160 мм',
          oldName: 'Бур',
          allowed: ['купить в Минске по низким ценам'],
        },
        {
          descriptionShort:
            'Бур SDS-plus 10х160 мм, вес 12 кг. Купить в Минске по низким ценам.',
        },
      ).descriptionShort,
    ).toMatch(/число 12/);
  });

  it('lets a quoted selling phrase into a name, but not an unquoted one', () => {
    const input = {
      entity: 'PRODUCT' as const,
      source: 'Бур SDS-plus 10х160 мм STARTUL',
      oldName: 'Бур SDS-plus 10х160 мм STARTUL',
      brand: 'STARTUL',
    };
    const name = { name: 'Бур SDS-plus STARTUL 10х160 мм купить в Минске' };
    expect(validateAnswer(input, name).name).toMatch(/продающие/);
    expect(
      validateAnswer({ ...input, allowed: ['купить в Минске'] }, name),
    ).toEqual({});
  });
});
