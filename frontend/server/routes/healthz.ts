/**
 * Liveness of the storefront process for the container healthcheck
 * (docker-compose.prod.yml): answers when the event loop does. Deliberately
 * no API call — a database outage is the backend's problem, and restarting
 * a healthy frontend for it would only drop its page cache from memory.
 * Without this, a hung frontend stayed «Up» forever: the watchdog restarts
 * only containers that report unhealthy (audit 2026-11-03).
 */
export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return 'ok'
})
