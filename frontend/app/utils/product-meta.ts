import { company } from '~/data/company'

/**
 * Meta description of a product page, built from our own data only.
 *
 * It used to be the supplier's `descriptionShort`, which on some sources is
 * the supplier's own SEO blurb — «Купить … в Минске с гарантией… ☎ <their
 * phone>». That put another shop's phone and city into our search snippet and
 * our og:description, and duplicated their text. The template says what the
 * snippet is for: what it is, the price, whether it is in stock, and how to
 * get it — terms taken from the delivery page (courier, post across Belarus,
 * free pickup in Vitebsk), nothing promised that the site does not.
 */
export type ProductMetaInput = {
  name: string
  brand?: string | null
  price?: number | null
  currency?: string | null
  /** Several supplier offers: the price shown is the best one, «от X». */
  priceFrom?: boolean
  stockStatus?: string | null
}

const MAX_LENGTH = 160
const DELIVERY = 'Доставка по Беларуси, самовывоз в Витебске.'

function formatPrice(value: number, currency?: string | null) {
  const code = currency?.trim().toUpperCase()
  return new Intl.NumberFormat('ru-BY', {
    style: 'currency',
    currency: code && /^[A-Z]{3}$/.test(code) ? code : 'BYN',
    maximumFractionDigits: 2,
  }).format(value)
}

function truncateAtWord(text: string, max: number) {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`
}

export function buildProductMetaDescription(input: ProductMetaInput) {
  const name = input.name.trim().replace(/[\s.]+$/, '')

  const core: string[] = []
  if (input.price != null && input.price > 0) {
    core.push(`Цена ${input.priceFrom ? 'от ' : ''}${formatPrice(input.price, input.currency)}.`)
  }
  if (input.stockStatus === 'in_stock') core.push('В наличии.')
  else if (input.stockStatus === 'out_of_stock') core.push('Под заказ.')
  core.push(DELIVERY)

  const tail = core.join(' ')
  // The name always leads; it gives way to the facts, not the other way round.
  const shortName = truncateAtWord(name, Math.max(40, MAX_LENGTH - tail.length - 2))
  const lead = shortName.endsWith('…') ? shortName : `${shortName}.`
  let text = `${lead} ${tail}`

  // Extras only while they fit: the brand when the name does not already say
  // it, then our phone.
  const brand = input.brand?.trim()
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
    const withBrand = `${lead} Бренд ${brand}. ${tail}`
    if (withBrand.length <= MAX_LENGTH) text = withBrand
  }
  const withPhone = `${text} Тел. ${company.phone}`
  if (withPhone.length <= MAX_LENGTH) text = withPhone

  return text
}
