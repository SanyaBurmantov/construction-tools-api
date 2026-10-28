/**
 * «Сто двадцать три белорусских рубля 45 копеек» — the amount in words an
 * invoice carries. Pure; Russian grammar: thousands and kopecks are feminine,
 * and the noun agrees with the last one or two digits.
 */

const ONES_M = [
  '',
  'один',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
];
const ONES_F = [
  '',
  'одна',
  'две',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

/** one / few / many: 1 рубль, 2 рубля, 5 рублей. */
export function plural(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 19) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function triad(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  words.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10]);
  } else {
    words.push(TENS[Math.floor(rest / 10)]);
    words.push((feminine ? ONES_F : ONES_M)[rest % 10]);
  }
  return words.filter(Boolean);
}

const SCALES: Array<{ forms: [string, string, string]; feminine: boolean }> = [
  { forms: ['', '', ''], feminine: false },
  { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
  { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
];

/** A whole number in words, masculine: 21 → «двадцать один». */
export function integerInWords(value: number, feminine = false): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'ноль';
  const parts: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) {
      const { forms, feminine: scaleFeminine } = SCALES[scale];
      const words = triad(chunk, scale === 0 ? feminine : scaleFeminine);
      if (scale > 0) words.push(plural(chunk, forms));
      parts.unshift(words.join(' '));
    }
    n = Math.floor(n / 1000);
    scale++;
  }
  return parts.join(' ');
}

/** 123.45 → «Сто двадцать три белорусских рубля 45 копеек». */
export function amountInWords(amount: number): string {
  const kopecksTotal = Math.round(Math.abs(amount) * 100);
  const rubles = Math.floor(kopecksTotal / 100);
  const kopecks = kopecksTotal % 100;
  const rubleWord = plural(rubles, [
    'белорусский рубль',
    'белорусских рубля',
    'белорусских рублей',
  ]);
  const kopeckWord = plural(kopecks, ['копейка', 'копейки', 'копеек']);
  const text = `${integerInWords(rubles)} ${rubleWord} ${String(kopecks).padStart(2, '0')} ${kopeckWord}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
