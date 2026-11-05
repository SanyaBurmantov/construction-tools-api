/** Formatting for the traffic screen and the dashboard tile. */
const number = new Intl.NumberFormat('ru-BY')
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_FULL = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

export const formatCount = (value: number) => number.format(value)

/** `2026-11` → «ноя» (with the year when `withYear`). */
export function monthLabel(key: string, withYear = false): string {
  const [year, month] = key.split('-').map(Number)
  const name = MONTHS[(month ?? 1) - 1] ?? key
  return withYear ? `${name} ${year}` : name
}

/** `2026-11` → «ноябрь 2026». */
export function monthTitle(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return `${MONTHS_FULL[(month ?? 1) - 1] ?? key} ${year}`
}

/** «+12%», «−5%», or «—» when there is nothing to compare with. */
export function formatChange(value: number | null): string {
  if (value === null) return '—'
  const pct = Math.round(value * 100)
  if (pct === 0) return '0%'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`
}

export function share(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : '—'
}

/**
 * A round axis maximum and its ticks: 0, step, … ≥ max. Always at least one
 * step, so an empty chart still has an axis.
 */
export function niceTicks(max: number, count = 4): number[] {
  const raw = Math.max(1, max) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= raw) ?? raw
  const top = Math.max(step, Math.ceil(Math.max(1, max) / step) * step)
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100)
  return ticks
}

export const DEVICE_LABELS = {
  mobile: 'Телефоны',
  desktop: 'Компьютеры',
  tablet: 'Планшеты',
} as const
