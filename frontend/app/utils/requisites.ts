/**
 * Belarusian company requisites — the same rules as the backend's
 * `common/utils/requisites.ts`, kept here for instant form feedback. The API
 * checks again; this copy only saves a round trip and a confusing 400.
 */

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
}

function compact(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[АВСЕНКМОРТХУ]/g, char => CYRILLIC_TO_LATIN[char] ?? char)
}

const UNP_WEIGHTS = [29, 23, 19, 17, 13, 7, 5, 3]

/** УНП: nine digits, the last one a mod-11 checksum; `AB1234567` by shape. */
export function isValidUnp(value: string): boolean {
  const unp = compact(value)
  if (/^[A-Z]{2}\d{7}$/.test(unp)) return true
  if (!/^\d{9}$/.test(unp)) return false
  const digits = [...unp].map(Number)
  const sum = UNP_WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i]!, 0)
  const check = sum % 11
  return check < 10 && check === digits[8]
}

/** BY IBAN, 28 characters, mod-97 checksum. */
export function isValidAccount(value: string): boolean {
  const iban = compact(value)
  if (!/^BY\d{2}[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const code = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

/** SWIFT BIC of a Belarusian bank: 8 or 11 characters. */
export function isValidBic(value: string): boolean {
  return /^[A-Z]{4}BY[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(value))
}

export type RequisitesForm = {
  taxId: string
  legalAddress: string
  bankAccount: string
  bankName: string
  bankBic: string
}

/** The organisation block of a form: its name plus the requisites. */
export type CompanyRequisitesModel = RequisitesForm & { companyName: string }

/**
 * The first problem with what was typed, or '' when it is fine. Blank fields
 * pass — whether one is required is the caller's decision.
 */
export function requisitesProblem(form: Partial<RequisitesForm>): string {
  const filled = (value?: string | null) => Boolean(value?.trim())
  if (filled(form.taxId) && !isValidUnp(form.taxId!))
    return 'УНП — 9 цифр; проверьте номер, контрольная цифра не сходится'
  if (filled(form.bankAccount) && !isValidAccount(form.bankAccount!))
    return 'Расчётный счёт — 28 символов в формате BY00XXXX0000…; проверьте номер'
  if (filled(form.bankBic) && !isValidBic(form.bankBic!))
    return 'БИК банка — 8 или 11 символов, например AKBBBY2X'
  return ''
}
