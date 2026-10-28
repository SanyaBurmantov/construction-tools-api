/**
 * Belarusian company requisites: УНП, settlement account (IBAN) and bank BIC.
 *
 * Pure, so the rules are unit-tested and the storefront keeps an identical
 * copy (`frontend/app/utils/requisites.ts`) for instant form feedback. A typo
 * in any of these only surfaced on the invoice, after a manager had already
 * spent time on the order.
 */

/** Cyrillic look-alikes a purchaser may type into a Latin code. */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
  У: 'Y',
};

function compact(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[АВСЕНКМОРТХУ]/g, (char) => CYRILLIC_TO_LATIN[char] ?? char);
}

const UNP_WEIGHTS = [29, 23, 19, 17, 13, 7, 5, 3];

/** `391 807 521` → `391807521`; Cyrillic letters become their Latin twins. */
export function normalizeUnp(value: string): string {
  return compact(value);
}

/**
 * УНП: nine digits whose last one is the checksum (weights 29…3, mod 11; a
 * remainder of 10 is never issued). Organisations and sole traders have the
 * numeric form. The two-letter form (`AB1234567`) belongs to private persons
 * and is accepted by shape only.
 */
export function isValidUnp(value: string): boolean {
  const unp = normalizeUnp(value);
  if (/^[A-Z]{2}\d{7}$/.test(unp)) return true;
  if (!/^\d{9}$/.test(unp)) return false;
  const digits = [...unp].map(Number);
  const sum = UNP_WEIGHTS.reduce(
    (acc, weight, i) => acc + weight * digits[i],
    0,
  );
  const check = sum % 11;
  return check < 10 && check === digits[8];
}

/** `by13 akbb 3012 …` → `BY13AKBB3012…`. */
export function normalizeAccount(value: string): string {
  return compact(value);
}

/**
 * Belarusian settlement account: a 28-character IBAN
 * (`BY` + 2 check digits + 4-letter bank code + 4-digit balance account +
 * 16 characters) with the ISO 13616 mod-97 checksum.
 */
export function isValidAccount(value: string): boolean {
  const iban = normalizeAccount(value);
  if (!/^BY\d{2}[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function normalizeBic(value: string): string {
  return compact(value);
}

/** SWIFT BIC of a Belarusian bank: `AKBBBY2X`, 8 or 11 characters. */
export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}BY[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));
}
