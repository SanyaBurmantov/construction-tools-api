/**
 * Copies text to the clipboard. `navigator.clipboard` needs a secure context
 * and a recent browser; the textarea + execCommand fallback covers the rest
 * (older Safari, an http preview). Never throws — false when nothing worked.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!import.meta.client) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or not focused — try the old way.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}
