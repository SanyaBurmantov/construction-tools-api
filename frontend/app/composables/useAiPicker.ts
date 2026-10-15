import type { AiSelection } from '~/types/ai'

/**
 * Row selection for the AI pickers: explicit rows (kept across pages and
 * filter changes) or "everything the filter matches", which the backend
 * resolves itself when the task is created.
 */
export function useAiPicker(filterParams: () => Record<string, string>, total: () => number) {
  const picked = ref(new Map<string, string>())
  const allMatching = ref(false)

  const isPicked = (id: string) => allMatching.value || picked.value.has(id)

  function toggle(row: { id: string, name: string }, on: boolean) {
    allMatching.value = false
    const next = new Map(picked.value)
    if (on) next.set(row.id, row.name)
    else next.delete(row.id)
    picked.value = next
  }

  function togglePage(rows: Array<{ id: string, name: string }>, on: boolean) {
    allMatching.value = false
    const next = new Map(picked.value)
    for (const row of rows) {
      if (on) next.set(row.id, row.name)
      else next.delete(row.id)
    }
    picked.value = next
  }

  function clear() {
    picked.value = new Map()
    allMatching.value = false
  }

  const count = computed(() => (allMatching.value ? total() : picked.value.size))

  const selection = computed<AiSelection | null>(() => {
    if (allMatching.value) return { mode: 'filter', filter: filterParams(), count: total() }
    if (!picked.value.size) return null
    return { mode: 'ids', ids: [...picked.value.keys()], count: picked.value.size }
  })

  /** First picked row — what the wizard dry-runs the prompt on. */
  const sample = computed(() => {
    const first = picked.value.entries().next().value
    return first ? { id: first[0], name: first[1] } : null
  })

  return { picked, allMatching, isPicked, toggle, togglePage, clear, count, selection, sample }
}
