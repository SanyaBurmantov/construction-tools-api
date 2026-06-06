const CURRENCY_ALIAS_MAP: Record<string, string> = {
  RUB: 'RUB',
  RUR: 'RUB',
  BYR: 'BYN',
  BYN: 'BYN',
  USD: 'USD',
  EUR: 'EUR',
}

export function normalizeCurrencyCode(value?: string | null, fallback = 'BYN') {
  if (!value) return fallback

  const raw = value.trim()
  const upper = raw.toUpperCase()

  if (upper === '\u20BD' || upper === '\u0420' || upper === 'P') {
    return 'RUB'
  }

  const aliased = CURRENCY_ALIAS_MAP[upper] || upper
  if (!/^[A-Z]{3}$/.test(aliased)) {
    return fallback
  }

  try {
    new Intl.NumberFormat('ru-BY', { style: 'currency', currency: aliased })
    return aliased
  } catch {
    return fallback
  }
}
