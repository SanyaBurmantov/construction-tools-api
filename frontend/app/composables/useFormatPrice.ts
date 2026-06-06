export function useFormatPrice() {
  function normalizeCurrency(currency?: string | null) {
    const value = currency?.trim().toUpperCase()
    return value && /^[A-Z]{3}$/.test(value) ? value : 'BYN'
  }

  function formatPrice(value?: number | null, currency?: string | null) {
    if (value === null || value === undefined) return 'Цена по запросу'
    return new Intl.NumberFormat('ru-BY', {
      style: 'currency',
      currency: normalizeCurrency(currency),
      maximumFractionDigits: 2,
    }).format(value)
  }

  return { formatPrice, normalizeCurrency }
}
