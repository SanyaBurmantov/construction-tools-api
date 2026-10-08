<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'

/**
 * Dense list row for the catalogue — the layout Onliner uses. Fits far more
 * decision-making information per screen than a card grid: key specs, rating,
 * availability and offer count all read at a glance.
 */
const props = defineProps<{ product: CatalogProduct }>()

const {
  image,
  canBuy,
  inStock,
  availabilityLabel,
  hasMultipleOffers,
  offerCount,
  hasDiscount,
  discountPercent,
  isFavourite,
  isComparing,
  inCart,
  addToCart,
  toggleWishlist,
  toggleCompare,
} = useProductActions(() => props.product)

// More specs than the card shows — there's room for them in a row.
const specs = computed(() => props.product.productSpecs?.slice(0, 4) ?? [])
const link = computed(() => `/product/${props.product.slug}`)
const imageFailed = ref(false)
const imageElement = ref<HTMLImageElement | null>(null)
onMounted(() => {
  const element = imageElement.value
  if (element?.complete && !element.naturalWidth) imageFailed.value = true
})
watch(image, () => { imageFailed.value = false })
</script>

<template>
  <article class="product-row">
    <NuxtLink :to="link" class="media" :aria-label="product.name">
      <img
        v-if="image && !imageFailed"
        ref="imageElement" :src="image"
        :alt="product.images?.[0]?.alt || product.name"
        loading="lazy"
        decoding="async"
        @error="imageFailed = true"
      >
      <span v-else class="placeholder" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4m0 0l8-4m-8 4v8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
        </svg>
      </span>
      <UiBadge v-if="hasDiscount" tone="sale" size="sm" class="discount">
        −{{ discountPercent }}%
      </UiBadge>
    </NuxtLink>

    <div class="info">
      <NuxtLink :to="link" class="title">{{ product.name }}</NuxtLink>

      <div class="meta">
        <UiRating
          v-if="product.ratingCount"
          :value="product.ratingAvg"
          :count="product.ratingCount"
          size="sm"
          show-value
        />
        <span v-if="product.brand?.name">{{ product.brand.name }}</span>
        <span v-if="product.sku">Арт. {{ product.sku }}</span>
      </div>

      <dl v-if="specs.length" class="specs">
        <div v-for="spec in specs" :key="spec.name">
          <dt>{{ spec.name }}:</dt>
          <dd>{{ spec.value }}</dd>
        </div>
      </dl>
    </div>

    <div class="buy">
      <UiPrice
        :value="product.priceValue"
        :old-price="product.oldPrice"
        :currency="product.priceCurrency"
        :from="hasMultipleOffers"
        size="md"
        :show-badge="false"
      />

      <span v-if="hasMultipleOffers" class="offers">
        {{ offerCount }} предложения
      </span>

      <span class="availability" :class="{ 'is-in-stock': inStock }">
        <span class="dot" aria-hidden="true" />
        {{ availabilityLabel }}
      </span>

      <UiButton
        v-if="canBuy"
        :variant="inCart ? 'secondary' : 'primary'"
        size="sm"
        block
        @click="addToCart()"
      >
        {{ inCart ? 'В корзине' : 'В корзину' }}
      </UiButton>
      <UiButton v-else variant="secondary" size="sm" block :to="link">Подробнее</UiButton>

      <div class="row-actions">
        <button
          type="button"
          :class="{ 'is-on': isFavourite }"
          :aria-pressed="isFavourite"
          :title="isFavourite ? 'Убрать из избранного' : 'В избранное'"
          @click="toggleWishlist"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z" :fill="isFavourite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          :class="{ 'is-on': isComparing }"
          :aria-pressed="isComparing"
          :title="isComparing ? 'Убрать из сравнения' : 'К сравнению'"
          @click="toggleCompare"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 20V9m6 11V4m6 16v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.product-row {
  display: grid;
  align-items: start;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-4);
  grid-template-columns: 140px minmax(0, 1fr) 200px;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.product-row:hover {
  border-color: var(--border-default);
}

/* ---- Media ---- */
.media {
  position: relative;
  display: block;
  aspect-ratio: 1;
}

.media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: var(--image-blend);
}

.placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-subtle);
  place-items: center;
}

.placeholder svg {
  width: 44px;
  height: 44px;
}

.discount {
  position: absolute;
  top: 0;
  left: 0;
}

/* ---- Info ---- */
.info {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-2);
}

.title {
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 700;
  line-height: var(--leading-snug);
}

.title:hover {
  color: var(--text-link);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.specs {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-2);
  margin: 0;
  border-top: 1px dashed var(--border-subtle);
  gap: 2px;
}

.specs > div {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-xs);
}

.specs dt {
  flex-shrink: 0;
  color: var(--text-muted);
}

.specs dd {
  overflow: hidden;
  margin: 0;
  color: var(--text-default);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Buy ---- */
.buy {
  display: flex;
  flex-direction: column;
  padding-left: var(--space-4);
  border-left: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.offers {
  color: var(--text-link);
  font-size: var(--text-xs);
}

.availability {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-1);
  gap: var(--space-1);
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.availability .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentcolor;
}

.availability.is-in-stock {
  color: var(--success);
  font-weight: 600;
}

.row-actions {
  display: flex;
  gap: var(--space-2);
}

.row-actions button {
  display: grid;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  place-items: center;
}

.row-actions button:hover,
.row-actions button.is-on {
  border-color: var(--brand);
  color: var(--brand);
}

.row-actions svg {
  width: 17px;
  height: 17px;
}

/* ---- Responsive ---- */
@media (max-width: 860px) {
  .product-row {
    grid-template-columns: 110px minmax(0, 1fr);
  }

  .buy {
    padding-left: 0;
    padding-top: var(--space-3);
    border-left: 0;
    border-top: 1px solid var(--border-subtle);
    grid-column: 1 / -1;
  }

  .specs {
    display: none;
  }
}
</style>
