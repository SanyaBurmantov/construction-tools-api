import { reachGoal } from '~/utils/metrika'

/**
 * Contact clicks as Metrika goals: the phone number and the messengers are
 * how most B2B buyers actually get in touch, and those leads never reach the
 * order or lead tables. One delegated listener for every link on every page.
 */
const MESSENGER = /^(viber:|whatsapp:|tg:)|^https?:\/\/(t\.me|wa\.me|api\.whatsapp\.com|invite\.viber\.com)\//i

export default defineNuxtPlugin(() => {
  document.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || window.location.pathname.startsWith('/admin')) return
      const href = link.getAttribute('href') || ''
      if (href.startsWith('tel:')) reachGoal('phone_click')
      else if (MESSENGER.test(href)) reachGoal('messenger_click')
    },
    { capture: true, passive: true },
  )
})
