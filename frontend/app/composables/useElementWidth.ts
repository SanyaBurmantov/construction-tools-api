/**
 * The rendered width of an element, kept current by a ResizeObserver — what
 * the admin charts draw at, so their 11px labels stay 11px on a phone instead
 * of shrinking with a fixed viewBox. `fallback` is the width before mount
 * (and on the server).
 */
export function useElementWidth(target: Ref<HTMLElement | null>, fallback = 720) {
  const width = ref(fallback)
  let observer: ResizeObserver | null = null

  onMounted(() => {
    const el = target.value
    if (!el) return
    width.value = el.clientWidth || fallback
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0)
      if (next > 0) width.value = next
    })
    observer.observe(el)
  })
  onBeforeUnmount(() => observer?.disconnect())

  return width
}
