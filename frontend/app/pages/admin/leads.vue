<script setup lang="ts">
import type { Paginated } from '~/types/api'
import { formatDateTimeWithYear as formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/**
 * Leads: a downloaded commercial offer, «уточнить наличие / подобрать
 * аналог», the contact form for organisations. Not orders yet — someone to
 * call back. Each one also arrived in Telegram and the shop mailbox.
 */
type LeadStatus = 'NEW' | 'IN_WORK' | 'DONE' | 'REJECTED'
type Lead = {
  id: string
  number: number
  kind: 'QUOTE' | 'QUESTION'
  status: LeadStatus
  companyName: string | null
  taxId: string | null
  contactName: string | null
  phone: string | null
  email: string | null
  message: string | null
  productName: string | null
  productSlug: string | null
  items: Array<{ name: string, slug: string, sku: string | null, quantity: number, unitPrice: number, lineTotal: number }> | null
  total: number | null
  currency: string | null
  trafficSource: string | null
  /** The AI assistant's draft answer — the manager checks it and sends it. */
  aiDraft: {
    text: string
    products: Array<{ id: string, name: string, slug: string, priceValue: number | null, stockStatus: string | null }>
    model: string
  } | null
  createdAt: string
  user: { id: string, login: string } | null
}
type ListResponse = Paginated<Lead> & { newCount: number }

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()
const { formatPrice } = useFormatPrice()
const { load: loadStats } = useAdminStats()
const toast = useAppToast()
const { siteUrl } = useSite()

/** The draft with the product links, ready to paste into a reply. */
function draftText(lead: Lead) {
  const draft = lead.aiDraft
  if (!draft) return ''
  const links = draft.products.map(product =>
    `— ${product.name}${product.priceValue != null ? `, ${formatPrice(product.priceValue, 'BYN')}` : ''}: ${siteUrl}/product/${product.slug}`)
  return [draft.text, ...(links.length ? ['', ...links] : [])].join('\n')
}

async function copyDraft(lead: Lead) {
  try {
    await navigator.clipboard.writeText(draftText(lead))
    toast.success('Черновик скопирован')
  } catch {
    toast.error('Не удалось скопировать — выделите текст вручную')
  }
}

const tab = ref<LeadStatus | ''>('NEW')
const kind = ref<'' | 'QUOTE' | 'QUESTION'>('')
const search = ref('')
const newCount = ref(0)
const expanded = ref('')

const { rows: leads, pagination, loading, error: loadError, load, refresh, setPage } = useAdminList<Lead, ListResponse>(
  '/leads',
  {
    params: () => ({ status: tab.value, kind: kind.value, search: search.value }),
    debounce: 350,
    errorText: 'Не удалось загрузить заявки',
    onResponse: (response) => {
      newCount.value = response.newCount
    },
  }
)

/**
 * New leads arrive while the page stays open: the layout polls
 * `/admin/inbox` and bumps `leadsVersion`; the list reloads in the background
 * and the rows that were not there before glow for a while.
 */
const { leadsVersion } = useAdminInbox()
const freshIds = ref(new Set<string>())
const FRESH_MS = 20_000
watch(leadsVersion, async () => {
  const before = new Set(leads.value.map(lead => lead.id))
  await refresh()
  const arrived = leads.value.filter(lead => !before.has(lead.id)).map(lead => lead.id)
  if (!arrived.length) return
  freshIds.value = new Set([...freshIds.value, ...arrived])
  setTimeout(() => {
    const next = new Set(freshIds.value)
    arrived.forEach(id => next.delete(id))
    freshIds.value = next
  }, FRESH_MS)
})

const setStatus = (lead: Lead, status: LeadStatus) =>
  run(() => adminFetch(`/leads/${lead.id}`, { method: 'PATCH', body: { status } }), {
    key: lead.id,
    error: 'Не удалось изменить статус',
    success: STATUS_LABELS[status],
    after: () => {
      void load()
      void loadStats()
    },
  })

const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Новая',
  IN_WORK: 'В работе',
  DONE: 'Обработана',
  REJECTED: 'Отклонена',
}
const STATUS_TONES = { NEW: 'warning', IN_WORK: 'info', DONE: 'success', REJECTED: 'neutral' } as const
const KIND_LABELS = { QUOTE: 'КП скачано', QUESTION: 'Вопрос' } as const
const kindOptions = [
  { value: '', label: 'Все типы' },
  { value: 'QUOTE', label: 'КП' },
  { value: 'QUESTION', label: 'Вопросы' },
]
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Заявки"
      description="Скачанные КП и вопросы с сайта — ещё не заказы, а люди, которым стоит перезвонить"
    >
      <UiSelect v-model="kind" :options="kindOptions" size="sm" aria-label="Тип заявки" />
      <UiInput v-model="search" placeholder="Организация, УНП, телефон, товар" size="sm" class="search" />
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiTabs
      v-model="tab"
      :tabs="[
        { value: 'NEW', label: 'Новые', count: newCount },
        { value: 'IN_WORK', label: 'В работе' },
        { value: 'DONE', label: 'Обработанные' },
        { value: 'REJECTED', label: 'Отклонённые' },
        { value: '', label: 'Все' }
      ]"
    />

    <div v-if="loading" class="list">
      <UiSkeleton v-for="i in 3" :key="i" height="110px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!leads.length"
      icon="user"
      :title="tab === 'NEW' ? 'Новых заявок нет' : 'Заявки не найдены'"
      description="Здесь появятся скачанные коммерческие предложения и вопросы со страниц товаров и «Для организаций»."
    />

    <ul v-else class="list">
      <li v-for="lead in leads" :key="lead.id" class="lead" :class="{ 'is-fresh': freshIds.has(lead.id) }">
        <div class="lead-main">
          <div class="lead-head">
            <strong>№{{ lead.number }}</strong>
            <UiBadge size="sm">{{ KIND_LABELS[lead.kind] }}</UiBadge>
            <UiBadge :tone="STATUS_TONES[lead.status]" size="sm">{{ STATUS_LABELS[lead.status] }}</UiBadge>
            <time :datetime="lead.createdAt">{{ formatDateTime(lead.createdAt) }}</time>
            <span v-if="lead.trafficSource" class="source">{{ lead.trafficSource }}</span>
          </div>

          <div class="who">
            <span v-if="lead.companyName"><strong>{{ lead.companyName }}</strong><template v-if="lead.taxId"> · УНП {{ lead.taxId }}</template></span>
            <span v-if="lead.contactName">{{ lead.contactName }}</span>
            <a v-if="lead.phone" :href="`tel:${lead.phone}`">{{ lead.phone }}</a>
            <a v-if="lead.email" :href="`mailto:${lead.email}`">{{ lead.email }}</a>
            <NuxtLink v-if="lead.user" :to="`/admin/users/${lead.user.id}`">аккаунт {{ lead.user.login }}</NuxtLink>
            <span v-if="!lead.contactName && !lead.phone && !lead.email && !lead.user" class="admin-muted">
              гость без контактов — только для статистики
            </span>
          </div>

          <p v-if="lead.productName" class="product">
            Товар:
            <NuxtLink v-if="lead.productSlug" :to="`/product/${lead.productSlug}`" target="_blank">{{ lead.productName }}</NuxtLink>
            <template v-else>{{ lead.productName }}</template>
          </p>
          <p v-if="lead.message" class="message">{{ lead.message }}</p>

          <details v-if="lead.aiDraft" class="draft">
            <summary>Черновик ответа от ИИ<template v-if="lead.aiDraft.products.length"> · {{ lead.aiDraft.products.length }} тов.</template></summary>
            <p class="draft-text">{{ lead.aiDraft.text }}</p>
            <ul v-if="lead.aiDraft.products.length" class="draft-products">
              <li v-for="product in lead.aiDraft.products" :key="product.id">
                <NuxtLink :to="`/product/${product.slug}`" target="_blank">{{ product.name }}</NuxtLink>
                <span v-if="product.priceValue != null"> · {{ formatPrice(product.priceValue, 'BYN') }}</span>
                <span v-if="product.stockStatus === 'in_stock'" class="in-stock"> · в наличии</span>
              </li>
            </ul>
            <p class="draft-note">Цены и наличие проверьте перед отправкой — ИИ их не пишет.</p>
            <UiButton size="sm" variant="secondary" @click="copyDraft(lead)">Скопировать с ссылками</UiButton>
          </details>

          <div v-if="lead.items?.length" class="quote">
            <button type="button" class="toggle" @click="expanded = expanded === lead.id ? '' : lead.id">
              {{ lead.items.length }} поз. на {{ formatPrice(lead.total ?? 0, lead.currency || 'BYN') }}
              {{ expanded === lead.id ? '▲' : '▼' }}
            </button>
            <ul v-if="expanded === lead.id" class="quote-items">
              <li v-for="item in lead.items" :key="item.slug">
                <NuxtLink :to="`/product/${item.slug}`" target="_blank">{{ item.name }}</NuxtLink>
                <span>{{ item.quantity }} × {{ formatPrice(item.unitPrice, lead.currency || 'BYN') }}</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="lead-actions">
          <UiButton
            v-if="lead.status === 'NEW'"
            size="sm"
            :loading="busy === lead.id"
            @click="setStatus(lead, 'IN_WORK')"
          >
            Взять в работу
          </UiButton>
          <UiButton
            v-if="lead.status !== 'DONE'"
            size="sm"
            variant="success"
            :loading="busy === lead.id"
            @click="setStatus(lead, 'DONE')"
          >
            Обработана
          </UiButton>
          <UiButton
            v-if="lead.status !== 'REJECTED' && lead.status !== 'DONE'"
            size="sm"
            variant="ghost"
            :loading="busy === lead.id"
            @click="setStatus(lead, 'REJECTED')"
          >
            Отклонить
          </UiButton>
        </div>
      </li>
    </ul>

    <UiPagination :page="pagination.page" :pages="pagination.pages" :total="pagination.total" @change="setPage" />
  </div>
</template>

<style scoped>
.draft {
  display: flex;
  flex-direction: column;
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  font-size: var(--text-sm);
  gap: var(--space-2);
}

.draft summary {
  cursor: pointer;
  font-weight: 600;
}

.draft-text {
  white-space: pre-wrap;
}

.draft-products {
  margin: 0;
  padding-left: var(--space-4);
}

.draft-note {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.in-stock {
  color: var(--success-soft-text);
}

/* A lead that arrived while the page was open (see leadsVersion). */
.lead.is-fresh {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
  animation: lead-arrive 600ms var(--ease-out);
}

@keyframes lead-arrive {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .lead.is-fresh {
    animation: none;
  }
}

.search {
  width: min(280px, 100%);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.lead {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.lead-main {
  display: flex;
  flex: 1 1 420px;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.lead-head,
.who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.lead-head time,
.source,
.product {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.product,
.message {
  margin: 0;
}

.message {
  white-space: pre-line;
}

.toggle {
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
}

.quote-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: 0;
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  list-style: none;
}

.quote-items li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.lead-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-2);
}
</style>
