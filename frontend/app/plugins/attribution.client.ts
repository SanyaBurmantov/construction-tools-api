/**
 * Records where this visit came from (UTM tags, an ad click, the referrer),
 * once per page load — before the router can drop the query string. See
 * `utils/attribution.ts`.
 */
export default defineNuxtPlugin(() => {
  recordVisit()
})
