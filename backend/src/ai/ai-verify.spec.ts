import { buildVerifyMessages, parseVerifyAnswer } from './ai-verify';

const parse = (fields: Record<string, unknown>) =>
  parseVerifyAnswer(new Map([['p1', { id: 'p1', fields }]])).get('p1');

describe('parseVerifyAnswer', () => {
  it('reads the structured verdict', () => {
    expect(
      parse({
        name: { ok: true },
        descriptionShort: {
          ok: false,
          problem: 'В данных сверло по бетону, не по металлу',
        },
      }),
    ).toEqual({ descriptionShort: 'В данных сверло по бетону, не по металлу' });
  });

  it('treats a bare «ok, всё верно» as ok, not as a problem', () => {
    expect(
      parse({ name: 'ok, всё соответствует', descriptionShort: 'Верно.' }),
    ).toBeUndefined();
  });

  it('keeps a free-text objection', () => {
    expect(parse({ name: 'Фасовка 50 шт, а не 4' })).toEqual({
      name: 'Фасовка 50 шт, а не 4',
    });
  });

  it('never objects for lack of an answer', () => {
    expect(
      parse({ name: null, descriptionShort: { problem: 'x' } }),
    ).toBeUndefined();
    expect(parseVerifyAnswer(new Map([['p1', { id: 'p1' }]])).size).toBe(0);
  });

  it('gives an objection without a reason a reason', () => {
    expect(parse({ name: { ok: false } })).toEqual({
      name: 'не прошло проверку смысла',
    });
  });
});

describe('buildVerifyMessages', () => {
  it('is the same system prompt for every batch (cache prefix)', () => {
    const a = buildVerifyMessages([
      { id: '1', data: { name: 'a' }, proposed: { name: 'A' } },
    ]);
    const b = buildVerifyMessages([
      { id: '2', data: { name: 'b' }, proposed: { name: 'B' } },
    ]);
    expect(a[0].content).toBe(b[0].content);
    expect(a[0].content).toMatch(/"ok":false/);
  });
});
