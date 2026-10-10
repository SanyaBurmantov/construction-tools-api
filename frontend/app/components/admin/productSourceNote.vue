<script setup lang="ts">
/**
 * "Откуда спаршен" — shown **only to a signed-in admin**, everywhere a product
 * appears: the storefront product page, the catalogue cards, the admin product
 * list and an order's lines.
 *
 * The data comes from an admin-guarded endpoint, so for a regular visitor this
 * renders nothing at all and fires no request. Wrapped in `ClientOnly` because
 * the session is client-side — a server render could not know who is looking.
 */
const props = withDefaults(
  defineProps<{
    productId: string
    /**
     * `banner` — full box above a product page.
     * `badge` — one chip for a catalogue card.
     * `line` — compact text for a table cell or an order line.
     */
    variant?: 'banner' | 'badge' | 'line'
    /** Say so when there are no supplier offers at all. */
    showEmpty?: boolean
  }>(),
  { variant: 'badge', showEmpty: false }
)

const { isAdmin, queue, sourcesFor } = useProductSources()
const { formatPrice } = useFormatPrice()

onMounted(() => queue([props.productId]))
watch(() => props.productId, id => queue([id]))

const sources = computed(() => sourcesFor(props.productId))

const relativeFormatter = new Intl.RelativeTimeFormat('ru-BY', { numeric: 'auto' })

/** "2 часа назад" — how fresh the supplier snapshot behind the price is. */
function lastSyncLabel(iso: string) {
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hours < 1) return 'только что'
  if (hours < 24) return relativeFormatter.format(-hours, 'hour')
  return relativeFormatter.format(-Math.round(hours / 24), 'day')
}
</script>

<template>
  <ClientOnly>
    <template v-if="isAdmin">
      <!-- Product page: the first thing an admin sees. -->
      <div v-if="variant === 'banner' && (sources.length || showEmpty)" class="banner">
        <span class="banner-label">Источник парсинга</span>
        <ul v-if="sources.length" class="banner-list">
          <li v-for="source in sources" :key="source.sourceId + source.url">
            <strong>{{ source.sourceName }}</strong>
            <span class="muted">закупка {{ formatPrice(source.price, source.currency) }}</span>
            <span :class="source.stock ? 'in-stock' : 'out-of-stock'">
              {{ source.stock ? 'в наличии' : 'нет у поставщика' }}
            </span>
            <span class="muted">обновлено {{ lastSyncLabel(source.lastSync) }}</span>
            <a :href="source.url" target="_blank" rel="noopener noreferrer">
              страница поставщика ↗
            </a>
          </li>
        </ul>
        <span v-else class="muted">нет предложений поставщиков — товар добавлен вручную</span>
      </div>

      <!-- Catalogue card. -->
      <span v-else-if="variant === 'badge' && sources.length" class="badge">
        {{ sources.map(source => source.sourceName).join(', ') }}
      </span>

      <!-- Table cell / order line. -->
      <span v-else-if="variant === 'line' && (sources.length || showEmpty)" class="line">
        <template v-if="sources.length">
          <span
            v-for="source in sources"
            :key="source.sourceId + source.url"
            class="line-item"
          >
            <a :href="source.url" target="_blank" rel="noopener noreferrer">
              {{ source.sourceName }}
            </a>
            <span class="muted">{{ formatPrice(source.price, source.currency) }}</span>
          </span>
        </template>
        <span v-else class="muted">вручную</span>
      </span>
    </template>
  </ClientOnly>
</template>

<style scoped>
.banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
}

.banner-label {
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.banner-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-1);
  list-style: none;
}

.banner-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
}

.line-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.muted {
  color: var(--text-muted);
}

.in-stock {
  color: var(--success);
}

.out-of-stock {
  color: var(--danger);
}

a {
  color: var(--text-link);
}

a:hover {
  text-decoration: underline;
}
</style>
