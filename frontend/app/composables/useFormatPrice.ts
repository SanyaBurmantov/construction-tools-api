/** `Intl.NumberFormat` is costly to build and was built on every price render. */
const formatters = new Map<string, Intl.NumberFormat>()

export function normalizeCurrency(currency?: string | null) {
  const value = currency?.trim().toUpperCase()
  return value && /^[A-Z]{3}$/.test(value) ? value : 'BYN'
}

export function formatPrice(value?: number | null, currency?: string | null) {
  if (value === null || value === undefined) return 'Цена по запросу'
  const code = normalizeCurrency(currency)
  let formatter = formatters.get(code)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ru-BY', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    })
    formatters.set(code, formatter)
  }
  return formatter.format(value)
}

export function useFormatPrice() {
  return { formatPrice, normalizeCurrency }
}
