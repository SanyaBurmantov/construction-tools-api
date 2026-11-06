/**
 * Согласие на аналитические cookie (Яндекс.Метрика с вебвизором).
 *
 * Необходимые для работы сайта данные (сессия, корзина, списки) работают
 * всегда; Метрика — только после «Принять». Выбор хранится в localStorage под
 * `cookie-consent` вместе с датой: сниппет в `nuxt.config.ts` читает тот же
 * ключ до гидратации и при `choice === 'all'` запускает счётчик сразу, без
 * ожидания Vue. Пока выбора нет, счётчик не грузится и цели
 * (`utils/metrika.ts`) молча пропускаются — `window.ym` не существует.
 *
 * Отказ после согласия: загруженный счётчик выгрузить нельзя, поэтому его
 * cookie и записи в localStorage стираются, а страница перезагружается.
 */
import { readJson, writeJson } from '~/utils/safe-storage'

export type CookieChoice = 'all' | 'necessary'

/** Не переименовывать: тот же ключ читает сниппет Метрики в nuxt.config.ts. */
export const COOKIE_CONSENT_KEY = 'cookie-consent'

type StoredConsent = { choice: CookieChoice; at: string }

function readChoice(): CookieChoice | null {
  const stored = readJson<StoredConsent>(COOKIE_CONSENT_KEY)
  return stored?.choice === 'all' || stored?.choice === 'necessary' ? stored.choice : null
}

/** Стирает first-party cookie и localStorage Метрики (`_ym_*`). */
function clearMetrikaTraces() {
  const host = location.hostname
  const parts = host.split('.')
  const domains = ['', host, `.${host}`]
  if (parts.length > 2) domains.push(`.${parts.slice(-2).join('.')}`)
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (!name || !name.startsWith('_ym')) continue
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`
    }
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('_ym')) localStorage.removeItem(key)
    }
  } catch {
    // Хранилище недоступно — стирать нечего.
  }
}

export function useCookieConsent() {
  /** `undefined` — ещё не прочитано (SSR, до монтирования). */
  const choice = useState<CookieChoice | null | undefined>('cookie-consent', () => undefined)
  const settingsOpen = useState('cookie-consent-open', () => false)

  function load() {
    if (import.meta.client && choice.value === undefined) choice.value = readChoice()
  }

  function save(next: CookieChoice) {
    const previous = choice.value
    writeJson(COOKIE_CONSENT_KEY, { choice: next, at: new Date().toISOString() } satisfies StoredConsent)
    choice.value = next
    settingsOpen.value = false
    if (next === 'all') {
      ;(window as unknown as { __gostMetrika?: () => void }).__gostMetrika?.()
    } else if (previous === 'all') {
      clearMetrikaTraces()
      if ('ym' in window) location.reload()
    }
  }

  return {
    choice,
    /** Баннер виден: выбора ещё не было или его открыли из подвала. */
    bannerVisible: computed(() => choice.value === null || settingsOpen.value),
    load,
    accept: () => save('all'),
    decline: () => save('necessary'),
    openSettings: () => {
      load()
      settingsOpen.value = true
    },
  }
}
