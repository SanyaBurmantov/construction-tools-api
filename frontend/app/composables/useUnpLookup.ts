/**
 * What the tax ministry's payer registry says about a УНП as it is typed
 * (`GET /requisites/unp/:unp`, backend `requisites/`): the organisation's
 * registered name and address to fill the form, or why the УНП will be
 * refused. The site sells to organisations and ИП only, and registration /
 * `POST /orders` check the same registry — this just says it before submit.
 *
 * `unavailable` (registry down) is not an error: the API lets the УНП
 * through in that case too.
 */
import { isValidUnp } from '~/utils/requisites'

export type UnpPayer = {
  shortName: string
  name: string
  address: string | null
  state: string | null
  active: boolean
}

export type UnpLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; payer: UnpPayer }
  | { status: 'not_found' }
  | { status: 'unavailable' }

const answers = new Map<string, UnpLookupState>()

export function useUnpLookup(unp: Ref<string>) {
  const { apiBase } = useSite()
  const state = ref<UnpLookupState>({ status: 'idle' })
  let asked = ''

  async function look(value: string) {
    const digits = value.replace(/\s/g, '')
    asked = digits
    if (!/^\d{9}$/.test(digits) || !isValidUnp(digits)) {
      state.value = { status: 'idle' }
      return
    }
    const known = answers.get(digits)
    if (known) {
      state.value = known
      return
    }
    state.value = { status: 'loading' }
    let answer: UnpLookupState
    try {
      const res = await $fetch<{ status: string } & Partial<UnpPayer>>(
        `${apiBase}/requisites/unp/${digits}`,
      )
      answer
        = res.status === 'found'
          ? {
              status: 'found',
              payer: {
                shortName: res.shortName ?? '',
                name: res.name ?? res.shortName ?? '',
                address: res.address ?? null,
                state: res.state ?? null,
                active: res.active !== false,
              },
            }
          : res.status === 'not_found'
            ? { status: 'not_found' }
            : { status: 'unavailable' }
    } catch {
      answer = { status: 'unavailable' }
    }
    if (answer.status !== 'unavailable') answers.set(digits, answer)
    // A newer УНП was typed while this one was in flight.
    if (asked === digits) state.value = answer
  }

  if (import.meta.client) watch(unp, look, { immediate: true })

  /** A message for under the field, or '' when there is nothing against it. */
  const problem = computed(() => {
    const current = state.value
    if (current.status === 'not_found')
      return 'УНП не найден в реестре плательщиков МНС — проверьте номер'
    if (current.status === 'found' && !current.payer.active)
      return `${current.payer.shortName}: ${current.payer.state?.toLowerCase() || 'не действует'} — счёт выставить нельзя`
    return ''
  })

  /** «ООО «МультиТул» · Действующий» once found. */
  const hint = computed(() => {
    const current = state.value
    if (current.status === 'loading') return 'Проверяем в реестре плательщиков…'
    if (current.status === 'found' && current.payer.active)
      return `✓ ${current.payer.shortName}`
    return ''
  })

  return { state, problem, hint }
}
