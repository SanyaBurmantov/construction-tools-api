import { regexRisk } from './parser-settings.service';
import * as defaults from './parser-defaults';

describe('regexRisk', () => {
  it.each(['(a+)+$', '(\\w*)*x', '([a-z]+\\s?)*$'])(
    'refuses the backtracking pattern %s',
    (pattern) => {
      expect(regexRisk(pattern)).not.toBeNull();
    },
  );

  it.each([
    'косметик|велотехник',
    '^Аксессуары / (?!Измерительные)',
    'дача, отдых',
  ])('accepts the ordinary filter %s', (pattern) => {
    expect(regexRisk(pattern)).toBeNull();
  });

  // An admin must be able to save back exactly what ships as the default.
  it('accepts every built-in default filter', () => {
    const patterns = Object.values(defaults).flatMap((value) =>
      typeof value === 'string'
        ? [value]
        : value && typeof value === 'object'
          ? Object.values(value).filter(
              (v): v is string => typeof v === 'string',
            )
          : [],
    );
    for (const pattern of patterns) {
      expect([pattern, regexRisk(pattern)]).toEqual([pattern, null]);
    }
  });
});
