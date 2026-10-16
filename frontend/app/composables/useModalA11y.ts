import type { Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

/**
 * Dialogs currently open, topmost last. Shared across every instance because
 * dialogs stack (a confirm over a modal, a modal over the mobile drawer): only
 * the top one may react to Escape and trap Tab, and the body stays locked until
 * the last one closes — with a per-dialog lock, closing the inner one unlocked
 * the page while the outer was still open.
 */
const openStack: symbol[] = []

function lockBody() {
  if (openStack.length === 1) document.body.style.overflow = 'hidden'
}

function unlockBody() {
  if (!openStack.length) document.body.style.overflow = ''
}

/**
 * Accessibility behaviour for a custom (non-component) modal:
 * - locks body scroll while open,
 * - closes on Escape,
 * - traps Tab focus inside the container and moves focus in on open,
 * - restores focus to the previously focused element on close.
 *
 * `container` must point at the modal's root element (the focus boundary).
 */
export function useModalA11y(
  isOpen: Ref<boolean>,
  container: Ref<HTMLElement | null>,
  onClose: () => void
) {
  if (import.meta.server) return

  const token = Symbol('dialog')
  let active = false
  let previouslyFocused: HTMLElement | null = null

  function focusable(): HTMLElement[] {
    if (!container.value) return []
    return Array.from(
      container.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => el.offsetParent !== null)
  }

  function onKeydown(event: KeyboardEvent) {
    if (openStack[openStack.length - 1] !== token) return
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const items = focusable()
    if (!items.length) return

    const first = items[0]!
    const last = items[items.length - 1]!
    const focused = document.activeElement

    if (event.shiftKey && focused === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && focused === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function release() {
    if (!active) return
    active = false
    openStack.splice(openStack.indexOf(token), 1)
    unlockBody()
    document.removeEventListener('keydown', onKeydown)
  }

  // `immediate`: a dialog mounted already open must lock and trap too.
  watch(isOpen, async (open) => {
    if (open) {
      if (active) return
      active = true
      previouslyFocused = document.activeElement as HTMLElement | null
      openStack.push(token)
      lockBody()
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      focusable()[0]?.focus()
    } else if (active) {
      release()
      previouslyFocused?.focus()
      previouslyFocused = null
    }
  }, { immediate: true })

  onScopeDispose(release)
}
