/**
 * Form values → request bodies.
 *
 * Two traps every admin form fell into:
 * - an emptied `type="number"` input hands back `''`, and `Number('')` is `0`,
 *   so clearing «Лимит применений» sent `maxUses: 0`;
 * - turning a blank into `undefined` drops it from the JSON, and the backend
 *   reads an absent field as "no change", so a value could never be removed.
 *
 * On an update send `null` for a cleared field; update DTOs accept it.
 */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * ISO → `<input type="datetime-local">` value, in local time. Slicing the UTC
 * string shifted every date by the timezone offset on each save.
 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

/** `datetime-local` value (local time) → ISO, or `null` when blank. */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
