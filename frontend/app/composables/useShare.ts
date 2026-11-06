/**
 * «Поделиться» for any page (owner, 2026-11-06: links were copied out of the
 * address bar). On a phone it opens the system share sheet — Telegram, Viber,
 * Instagram, whatever is installed; elsewhere the header shows its own menu
 * of messengers. Channel links carry `utm_source=<channel>&utm_medium=share`,
 * so an order from a shared link shows where it came from (attribution);
 * the copied link stays clean.
 */
import { copyText } from '~/utils/clipboard'

const TRACKING = /^(?:utm_[a-z]+|yclid|gclid|fbclid|_openstat|from)$/i

/** The page's address without tracking tags and the #fragment. */
export function shareableUrl(): string {
  if (!import.meta.client) return ''
  const url = new URL(window.location.href)
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key)
  }
  url.hash = ''
  return url.toString()
}

function tagged(url: string, source: string): string {
  const next = new URL(url)
  next.searchParams.set('utm_source', source)
  next.searchParams.set('utm_medium', 'share')
  return next.toString()
}

export type ShareChannel = { id: string, label: string, href: string }

export function shareChannels(url: string, title: string): ShareChannel[] {
  const enc = encodeURIComponent
  const via = (source: string) => tagged(url, source)
  return [
    { id: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${enc(via('telegram'))}&text=${enc(title)}` },
    { id: 'viber', label: 'Viber', href: `viber://forward?text=${enc(`${title} ${via('viber')}`)}` },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${title} ${via('whatsapp')}`)}` },
    { id: 'vk', label: 'ВКонтакте', href: `https://vk.com/share.php?url=${enc(via('vk'))}&title=${enc(title)}` },
    { id: 'email', label: 'Почта', href: `mailto:?subject=${enc(title)}&body=${enc(via('email'))}` },
  ]
}

export function useShare() {
  const toast = useAppToast()
  const menuOpen = ref(false)
  const url = ref('')
  const title = ref('')

  /** The system sheet on a touch device; the menu otherwise (or if it fails). */
  async function share() {
    url.value = shareableUrl()
    title.value = document.title
    const touch = window.matchMedia?.('(pointer: coarse)').matches
    if (touch && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: title.value, url: url.value })
        return
      } catch (error) {
        // The visitor closed the sheet: nothing to do.
        if ((error as { name?: string }).name === 'AbortError') return
      }
    }
    menuOpen.value = !menuOpen.value
  }

  async function copyLink() {
    const ok = await copyText(url.value || shareableUrl())
    menuOpen.value = false
    if (ok) toast.success('Ссылка скопирована')
    else toast.error('Не удалось скопировать — выделите адрес в строке браузера')
  }

  const channels = computed(() => (url.value ? shareChannels(url.value, title.value) : []))

  return { menuOpen, share, copyLink, channels, close: () => { menuOpen.value = false } }
}
