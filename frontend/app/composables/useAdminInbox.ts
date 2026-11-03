import type { AdminStats } from '~/types/api'

/**
 * Short polling of what an admin waits for: new leads and orders.
 *
 * An admin opens the panel and leaves it open; a lead used to appear only on
 * the next manual reload. `GET /admin/inbox` (four small counts, not the
 * heavy `/admin/stats`) is polled every `POLL_MS` while the tab is visible —
 * a hidden tab polls nothing and catches up the moment it is shown again.
 * The admin layout starts it once; pages react to `leadsVersion` /
 * `ordersVersion`, which move when a newer lead / order number shows up.
 */
export type AdminInbox = {
  newOrders: number
  newLeads: number
  lastOrder: { id: string, number: number, customerName: string, payerName: string | null, total: number, currency: string } | null
  lastLead: { id: string, number: number, kind: 'QUOTE' | 'QUESTION', companyName: string | null, contactName: string | null, phone: string | null } | null
}

const POLL_MS = 15_000

export function useAdminInbox() {
  const inbox = useState<AdminInbox | null>('admin-inbox', () => null)
  const leadsVersion = useState('admin-inbox-leads', () => 0)
  const ordersVersion = useState('admin-inbox-orders', () => 0)
  return { inbox, leadsVersion, ordersVersion }
}

/** Called once by `layouts/admin.vue`; stops with the layout's scope. */
export function startAdminInboxPolling(enabled: () => boolean) {
  const { adminFetch } = useAdminApi()
  const { stats } = useAdminStats()
  const { inbox, leadsVersion, ordersVersion } = useAdminInbox()
  const toast = useAppToast()

  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let stopped = false

  async function poll() {
    if (stopped || inFlight || !enabled() || document.visibilityState !== 'visible') return
    inFlight = true
    try {
      const next = await adminFetch<AdminInbox>('/inbox')
      const previous = inbox.value
      // The first answer is the baseline: nothing on screen is «new» yet.
      if (previous) {
        if (next.lastLead && next.lastLead.number > (previous.lastLead?.number ?? 0)) {
          leadsVersion.value++
          const lead = next.lastLead
          const who = lead.companyName || lead.contactName || lead.phone || ''
          toast.push(`${lead.kind === 'QUOTE' ? 'Скачано КП' : 'Вопрос с сайта'}${who ? ` — ${who}` : ''}`, {
            tone: 'info',
            title: `Новая заявка №${lead.number}`,
            timeout: 10_000,
          })
        }
        if (next.lastOrder && next.lastOrder.number > (previous.lastOrder?.number ?? 0)) {
          ordersVersion.value++
          const order = next.lastOrder
          toast.push(`${order.payerName || order.customerName} — ${formatPrice(order.total, order.currency)}`, {
            tone: 'success',
            title: `Новый заказ №${order.number}`,
            timeout: 10_000,
          })
        }
      }
      inbox.value = next
      // The sidebar badges come from /admin/stats; keep their two counters
      // current without re-running that query.
      if (stats.value) {
        stats.value = { ...stats.value, newOrders: next.newOrders, newLeads: next.newLeads } as AdminStats
      }
    }
    catch {
      // A missed poll is not worth a message; the next one tries again.
    }
    finally {
      inFlight = false
    }
  }

  function schedule() {
    clearTimeout(timer)
    if (!stopped) timer = setTimeout(async () => {
      await poll()
      schedule()
    }, POLL_MS)
  }

  function onVisibility() {
    if (document.visibilityState === 'visible') {
      void poll()
      schedule()
    }
  }

  onMounted(() => {
    void poll()
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
  })
  onScopeDispose(() => {
    stopped = true
    clearTimeout(timer)
    if (import.meta.client) document.removeEventListener('visibilitychange', onVisibility)
  })

  /** Re-check right now (after the admin's own action changed a status). */
  return { pollNow: poll }
}
