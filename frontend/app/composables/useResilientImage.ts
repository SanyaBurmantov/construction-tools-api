import type { MaybeRefOrGetter } from 'vue'

/**
 * A catalogue photo goes through IPX (`/_ipx/…`): our frontend container
 * downloads the supplier original and resizes it. That makes the photo depend
 * on *our server* reaching the supplier, which the visitor's browser does not
 * need — th-tool.by stopped answering the prod box while it still answered
 * everyone else, and IPX turned that into a 500 after a ~21 s timeout: every
 * th-tool.by card in the catalogue sat empty while the product page (plain
 * `<img>`, fetched by the browser) showed the same photos fine.
 *
 * So the photo degrades in steps: IPX → the original URL straight from the
 * supplier (heavier, but it renders) → the placeholder. A card falls back on
 * an error, on a cached broken image, or when IPX has not delivered within
 * `IPX_TIMEOUT_MS` of the card becoming visible — waiting out the server's
 * timeout is the empty grid we are fixing.
 */
export type ImageStage = 'ipx' | 'direct' | 'failed'

const IPX_TIMEOUT_MS = 6000

/**
 * Hosts IPX has already failed on in this tab. One blocked supplier fails
 * every one of its photos the same way, so cards mounted afterwards (next
 * page, filter change) skip straight to the direct URL instead of each
 * waiting out the timeout again. Client-only state: on the server nothing
 * fails, and at hydration the set is still empty, so SSR and the first client
 * render agree. A plain Set: it is only read when a card picks its first
 * stage, never rendered, so reactivity would buy nothing.
 */
const brokenIpxHosts = new Set<string>()

/**
 * One IntersectionObserver for every card instead of one per card — a 24-card
 * grid used to create 24. Each observed image maps to its card's callback.
 */
let sharedObserver: IntersectionObserver | undefined
const onVisible = new WeakMap<Element, () => void>()

function observeOnce(img: Element, callback: () => void) {
  sharedObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const cb = onVisible.get(entry.target)
      unobserve(entry.target)
      cb?.()
    }
  })
  onVisible.set(img, callback)
  sharedObserver.observe(img)
}

function unobserve(img: Element) {
  onVisible.delete(img)
  sharedObserver?.unobserve(img)
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  }
  catch {
    return null // a relative path is ours and never goes over the network
  }
}

export function useResilientImage(src: MaybeRefOrGetter<string | null | undefined>) {
  const url = computed(() => toValue(src) || null)
  const initialStage = (): ImageStage => {
    const host = hostOf(url.value)
    return host && brokenIpxHosts.has(host) ? 'direct' : 'ipx'
  }
  const stage = ref<ImageStage>(initialStage())

  // NuxtImg renders an <img>, but a template ref on it points at the
  // component, so the element itself has to be reached through `$el`.
  const imageElement = ref<{ $el?: HTMLImageElement } | HTMLImageElement | null>(null)
  const element = () => {
    const ref_ = imageElement.value
    return (ref_ && '$el' in ref_ ? ref_.$el : ref_) as HTMLImageElement | undefined
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let observed: Element | undefined
  const stopWatching = () => {
    clearTimeout(timer)
    timer = undefined
    if (observed) unobserve(observed)
    observed = undefined
  }

  function fail() {
    stopWatching()
    if (stage.value === 'ipx') {
      const host = hostOf(url.value)
      if (host) brokenIpxHosts.add(host)
      stage.value = 'direct'
    }
    else {
      stage.value = 'failed'
    }
  }

  function onLoad() {
    stopWatching()
  }

  /** Starts the IPX deadline once the photo is actually on screen (lazy images do not load before). */
  function watchIpx() {
    stopWatching()
    const img = element()
    if (stage.value !== 'ipx' || !img) return
    // Rendered by SSR and already settled before hydration attached @error.
    if (img.complete) {
      if (!img.naturalWidth) fail()
      return
    }
    if (typeof IntersectionObserver === 'undefined') return
    observed = img
    observeOnce(img, () => {
      observed = undefined
      timer = setTimeout(() => {
        const current = element()
        if (stage.value === 'ipx' && !(current?.complete && current.naturalWidth)) fail()
      }, IPX_TIMEOUT_MS)
    })
  }

  onMounted(watchIpx)
  onBeforeUnmount(stopWatching)
  watch(url, () => {
    stage.value = initialStage()
    nextTick(watchIpx)
  })

  return { url, stage, imageElement, onLoad, onError: fail }
}
