import {
  addSpecAliases,
  parseSpecAliases,
  resolveSpecAlias,
  unitOfKey,
} from './spec-aliases';

describe('spec aliases', () => {
  it('reads the stored map and drops junk and self-aliases', () => {
    expect(
      parseSpecAliases(
        JSON.stringify({
          'moshchnost-potreblyaemaya~w': {
            key: 'moshchnost~w',
            name: 'Мощность',
          },
          self: { key: 'self', name: 'x' },
          broken: 'nope',
          noName: { key: 'k' },
        }),
      ),
    ).toEqual({
      'moshchnost-potreblyaemaya~w': { key: 'moshchnost~w', name: 'Мощность' },
    });
    expect(parseSpecAliases('{not json')).toEqual({});
    expect(parseSpecAliases(null)).toEqual({});
  });

  it('follows a chain to the survivor and stops on a loop', () => {
    const aliases = {
      a: { key: 'b', name: 'B' },
      b: { key: 'c', name: 'C' },
      x: { key: 'y', name: 'Y' },
      y: { key: 'x', name: 'X' },
    };
    expect(resolveSpecAlias('a', aliases)).toEqual({ key: 'c', name: 'C' });
    expect(resolveSpecAlias('c', aliases)).toBeNull();
    expect(resolveSpecAlias('x', aliases)).toEqual({ key: 'y', name: 'Y' });
  });

  it('refuses to fold across units', () => {
    expect(unitOfKey('dlina~mm')).toBe('mm');
    expect(unitOfKey('cvet')).toBe('');
    expect(() =>
      addSpecAliases({}, ['dlina~m'], { key: 'dlina~mm', name: 'Длина' }),
    ).toThrow(/единицы/);
    expect(
      addSpecAliases({}, ['dlina-obshchaya~mm', 'dlina~mm'], {
        key: 'dlina~mm',
        name: 'Длина',
      }),
    ).toEqual({ 'dlina-obshchaya~mm': { key: 'dlina~mm', name: 'Длина' } });
  });
});
