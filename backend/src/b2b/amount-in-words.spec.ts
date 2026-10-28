import { amountInWords, integerInWords } from './amount-in-words';

describe('amountInWords', () => {
  it('agrees the ruble and kopeck nouns with the number', () => {
    expect(amountInWords(1)).toBe('Один белорусский рубль 00 копеек');
    expect(amountInWords(2.01)).toBe('Два белорусских рубля 01 копейка');
    expect(amountInWords(5.02)).toBe('Пять белорусских рублей 02 копейки');
    expect(amountInWords(11.11)).toBe(
      'Одиннадцать белорусских рублей 11 копеек',
    );
    expect(amountInWords(123.45)).toBe(
      'Сто двадцать три белорусских рубля 45 копеек',
    );
  });

  it('makes thousands feminine and leaves out empty triads', () => {
    expect(integerInWords(1000)).toBe('одна тысяча');
    expect(integerInWords(2021)).toBe('две тысячи двадцать один');
    expect(integerInWords(15000)).toBe('пятнадцать тысяч');
    expect(integerInWords(1_000_001)).toBe('один миллион один');
    expect(amountInWords(3154.09)).toBe(
      'Три тысячи сто пятьдесят четыре белорусских рубля 09 копеек',
    );
  });

  it('survives float noise and zero', () => {
    expect(amountInWords(0.1 + 0.2)).toBe('Ноль белорусских рублей 30 копеек');
    expect(amountInWords(110.00000000000001)).toBe(
      'Сто десять белорусских рублей 00 копеек',
    );
  });
});
