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
     * `line` — compact text for a table cell.
     * `order` — an order's line: «первоисточник» spelled out, with a link to
     *   every supplier page carrying the item, because this is the view an
     *   admin works from when the order has to be bought somewhere.
     */
    variant?: 'banner' | 'badge' | 'line' | 'order'
    /** Say so when there are no supplier offers at all. */
    showEmpty?: boolean
  }>(),
  { variant: 'badge', showEmpty: false }
)

const { isAdmin, queue, groupedFor, labelFor } = useProductSources()
const { formatPrice } = useFormatPrice()

onMounted(() => queue([props.productId]))
watch(() => props.productId, id => queue([id]))

/**
 * Folded by supplier, never one entry per offer: a product that a supplier
 * lists on two pages (merged into one card by its barcode) used to print that
 * supplier's name twice, which reads as a data error rather than as two pages.
 */
const groups = computed(() => groupedFor(props.productId))
const label = computed(() => labelFor(props.productId))

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
      <!-- Product page: the first thing an admin sees. One block per supplier,
           with every page of theirs that feeds this card under it. -->
      <div v-if="variant === 'banner' && (groups.length || showEmpty)" class="banner">
        <span class="banner-label">Источник парсинга</span>
        <ul v-if="groups.length" class="banner-list">
          <li v-for="group in groups" :key="group.sourceId" class="banner-source">
            <span class="banner-source-head">
              <strong>{{ group.sourceName }}</strong>
              <span v-if="group.offers.length > 1" class="banner-count">
                {{ pluralize(group.offers.length, 'supplierPage') }} на одной карточке
              </span>
            </span>
            <span v-for="offer in group.offers" :key="offer.url" class="banner-offer">
              <span class="muted">закупка {{ formatPrice(offer.price, offer.currency) }}</span>
              <span :class="offer.stock ? 'in-stock' : 'out-of-stock'">
                {{ offer.stock ? 'в наличии' : 'нет у поставщика' }}
              </span>
              <span class="muted">обновлено {{ lastSyncLabel(offer.lastSync) }}</span>
              <a :href="offer.url" target="_blank" rel="noopener noreferrer">
                страница поставщика ↗
              </a>
            </span>
          </li>
        </ul>
        <span v-else class="muted">нет предложений поставщиков — товар добавлен вручную</span>
      </div>

      <!-- Catalogue card. -->
      <span v-else-if="variant === 'badge' && groups.length" class="badge">
        {{ label }}
      </span>

      <!-- Order composition: the link an admin clicks to go and buy the
           item, one per supplier page, with the purchase price next to it. -->
      <span v-else-if="variant === 'order' && (groups.length || showEmpty)" class="order-source">
        <span class="order-source-label">Первоисточник</span>
        <template v-if="groups.length">
          <template v-for="group in groups" :key="group.sourceId">
            <a
              v-for="offer in group.offers"
              :key="offer.url"
              :href="offer.url"
              target="_blank"
              rel="noopener noreferrer"
              class="order-source-link"
            >
              <span>{{ group.sourceName }} ↗</span>
              <span class="muted">{{ formatPrice(offer.price, offer.currency) }}</span>
              <span v-if="!offer.stock" class="out-of-stock">нет у поставщика</span>
            </a>
          </template>
        </template>
        <span v-else class="muted">нет предложений поставщиков — товар добавлен вручную</span>
      </span>

      <!-- Table cell. -->
      <span v-else-if="variant === 'line' && (groups.length || showEmpty)" class="line">
        <template v-if="groups.length">
          <span v-for="group in groups" :key="group.sourceId" class="line-item">
            <a :href="group.offers[0]!.url" target="_blank" rel="noopener noreferrer">
              {{ group.sourceName }}
            </a>
            <span v-if="group.offers.length > 1" class="muted">×{{ group.offers.length }}</span>
            <span class="muted">
              {{ formatPrice(group.offers[0]!.price, group.offers[0]!.currency) }}
            </span>
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

.banner-source {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.banner-source-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

.banner-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.banner-offer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

/* A supplier with several pages indents them under its name. */
.banner-source:has(.banner-count) .banner-offer {
  padding-left: var(--space-3);
  border-left: 2px solid var(--border-subtle);
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

.order-source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
}

.order-source-label {
  color: var(--text-subtle);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.order-source-link {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  color: var(--text-link);
  font-weight: 600;
  gap: var(--space-2);
}

.order-source-link:hover {
  border-color: var(--brand);
  text-decoration: none;
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
