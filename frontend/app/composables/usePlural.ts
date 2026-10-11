/**
 * Russian plural agreement.
 *
 * Counts were paired with a single hardcoded noun form, so the storefront said
 * "1 предложения поставщиков", "1 отзывов", "1 товаров" and "21 товара" —
 * wrong for the majority of small numbers, and immediately visible to anyone
 * reading the page.
 *
 * Russian picks between three forms by the last digits: one (1, 21, 131), few
 * (2-4, 22-24) and many (0, 5-20, 25-30). The 11-14 band takes the "many" form
 * despite ending in 1-4, which is the case a naive `n === 1 ? a : b` misses
 * even when someone remembers the 2-4 form.
 */
export function pluralForm(count: number): 0 | 1 | 2 {
  const n = Math.abs(Math.trunc(count))
  // 11-14 behave like "many" even though they end in 1-4.
  if (n % 100 >= 11 && n % 100 <= 14) return 2
  const last = n % 10
  if (last === 1) return 0
  if (last >= 2 && last <= 4) return 1
  return 2
}

/** `plural(2, 'товар', 'товара', 'товаров') === 'товара'` */
export function plural(count: number, one: string, few: string, many: string) {
  return [one, few, many][pluralForm(count)] as string
}

/** The count and its noun together: `withPlural(2, …) === '2 товара'`. */
export function withPlural(
  count: number,
  one: string,
  few: string,
  many: string,
) {
  return `${count} ${plural(count, one, few, many)}`
}

/**
 * The nouns the storefront counts, so a form is written once rather than
 * guessed at each call site.
 */
export const PLURALS = {
  product: ['товар', 'товара', 'товаров'],
  offer: ['предложение', 'предложения', 'предложений'],
  review: ['отзыв', 'отзыва', 'отзывов'],
  position: ['позиция', 'позиции', 'позиций'],
  subcategory: ['подкатегория', 'подкатегории', 'подкатегорий'],
  difference: ['отличие', 'отличия', 'отличий'],
  supplierPage: ['страница поставщика', 'страницы поставщика', 'страниц поставщика'],
} as const satisfies Record<string, readonly [string, string, string]>

export type PluralNoun = keyof typeof PLURALS

/** `pluralize(2, 'product') === '2 товара'` */
export function pluralize(count: number, noun: PluralNoun) {
  const [one, few, many] = PLURALS[noun]
  return withPlural(count, one, few, many)
}

/** Composable form, so templates can use it without an explicit import. */
export function usePlural() {
  return { plural, withPlural, pluralize, pluralForm }
}
