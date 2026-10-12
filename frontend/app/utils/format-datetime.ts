/**
 * Dates and times, formatted the same way everywhere.
 *
 * Six screens each built their own `Intl.DateTimeFormat('ru-BY', …)` — same
 * locale, slightly different options, and each with its own idea of what to
 * print for a missing value. The variants below are the ones the screens
 * actually use; they all answer «—» for an absent date, so a caller never has
 * to guard.
 */
const LOCALE = 'ru-BY'

const date = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const day = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' })

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const dateTimeWithYear = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const dateTimeWithSeconds = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

type Iso = string | null | undefined

const format = (formatter: Intl.DateTimeFormat, iso: Iso) =>
  iso ? formatter.format(new Date(iso)) : '—'

/** «11 октября 2026» — profile fields and promo-code deadlines. */
export const formatDate = (iso: Iso) => format(date, iso)

/** «11 окт» — axis labels on the admin dashboard chart. */
export const formatDay = (iso: Iso) => format(day, iso)

/** «11 окт, 14:05» — the default for lists where the year is obvious. */
export const formatDateTime = (iso: Iso) => format(dateTime, iso)

/** «11 окт 2026, 14:05» — account and order history, which span years. */
export const formatDateTimeWithYear = (iso: Iso) => format(dateTimeWithYear, iso)

/** «11 окт, 14:05:09» — the audit trail and the error log, where order matters. */
export const formatDateTimeWithSeconds = (iso: Iso) =>
  format(dateTimeWithSeconds, iso)
