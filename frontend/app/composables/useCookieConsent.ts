/**
 * Согласие на аналитические cookie (Яндекс.Метрика с вебвизором, с 16.11.2026
 * ещё Google Tag Manager).
 *
 * Необходимые для работы сайта данные (сессия, корзина, списки) работают
 * всегда; Метрика — только после «Принять». Выбор хранится в localStorage под
 * `cookie-consent` вместе с датой: сниппет в `nuxt.config.ts` читает тот же
 * ключ до гидратации и при `choice === 'all'` запускает счётчик сразу, без
 * ожидания Vue. Пока выбора нет, счётчик не грузится и цели
 * (`utils/metrika.ts`) молча пропускаются — `window.ym` не существует.
 *
 * Версия согласия (`v`): посетитель соглашается с конкретным текстом баннера.
 * Кто нажал «Принять все», когда там была только Метрика (`v` нет или 1),
 * снова видит баннер; Метрика у него работает как раньше, а GTM грузится
 * только после нового ответа (`v >= CONSENT_VERSION`).
 *
 * Отказ после согласия: загруженный счётчик выгрузить нельзя, поэтому его
 * cookie и записи в localStorage стираются, а страница перезагружается.
 */
import { readJson, writeJson } from '~/utils/safe-storage'

export type CookieChoice = 'all' | 'necessary'

/** Не переименовывать: тот же ключ читает сниппет Метрики в nuxt.config.ts. */
export const COOKIE_CONSENT_KEY = 'cookie-consent'

/**
 * Не менять без нужды: то же число стоит в `CONSENT_VERSION` в nuxt.config.ts.
 * Поднимать, когда баннер начинает называть новый сервис.
 */
export const CONSENT_VERSION = 2

type StoredConsent = { choice: CookieChoice; at: string; v?: number }

/**
 * Выбор, который ещё в силе. Согласие на старый текст баннера — не ответ на
 * новый: баннер покажется снова. Отказ остаётся отказом при любой версии.
 */
function readChoice(): CookieChoice | null {
  const stored = readJson<StoredConsent>(COOKIE_CONSENT_KEY)
  if (stored?.choice === 'necessary') return 'necessary'
  if (stored?.choice === 'all') return (stored.v ?? 1) >= CONSENT_VERSION ? 'all' : null
  return null
}

/** Префиксы cookie счётчиков: Метрика, Google Analytics / Ads. */
const TRACKER_COOKIE_PREFIXES = ['_ym', '_ga', '_gid', '_gat', '_gcl']

type TrackerWindow = Window & {
  __gostMetrika?: () => void
  __gostGtm?: () => void
  __gostGtmLoaded?: number
}

/** Счётчик уже загружен на этой странице — выгрузить его можно только перезагрузкой. */
const trackersLoaded = (w: TrackerWindow) => 'ym' in w || Boolean(w.__gostGtmLoaded)

/** Стирает first-party cookie и localStorage счётчиков. */
function clearTrackerTraces() {
  const host = location.hostname
  const parts = host.split('.')
  const domains = ['', host, `.${host}`]
  if (parts.length > 2) domains.push(`.${parts.slice(-2).join('.')}`)
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (!name || !TRACKER_COOKIE_PREFIXES.some(prefix => name.startsWith(prefix))) continue
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
    writeJson(COOKIE_CONSENT_KEY, {
      choice: next,
      at: new Date().toISOString(),
      v: CONSENT_VERSION,
    } satisfies StoredConsent)
    choice.value = next
    settingsOpen.value = false
    const w = window as TrackerWindow
    if (next === 'all') {
      w.__gostMetrika?.()
      w.__gostGtm?.()
    } else {
      // Not only after an «all» from this page: an old-version consent left
      // Metrika running while the banner asked again.
      clearTrackerTraces()
      if (trackersLoaded(w)) location.reload()
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
