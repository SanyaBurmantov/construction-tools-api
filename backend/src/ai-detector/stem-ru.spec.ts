import { stemRu } from './stem-ru';

describe('stemRu', () => {
  it('folds case, number and gender endings into one stem', () => {
    const same = (words: string[]) =>
      expect(new Set(words.map(stemRu)).size).toBe(1);
    same(['высокую', 'высокая', 'высокой', 'высокие']);
    same(['двигатель', 'двигателя', 'двигателем']);
    same(['трубки', 'трубка', 'трубкой']); // «трубок» stays apart: a fleeting vowel, as in Snowball
    same(['соединения', 'соединение']);
    same(['пластиковых', 'пластиковый']);
    same(['надежное', 'надёжный']);
    same(['бесщеточный', 'бесщёточного']);
  });

  it('leaves models, numbers and Latin alone', () => {
    expect(stemRu('CRH')).toBe('crh');
    expect(stemRu('1810')).toBe('1810');
  });
});
