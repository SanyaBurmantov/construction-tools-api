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
</script>

<template>
  <article class="product-row">
    <NuxtLink :to="link" class="media" :aria-label="product.name">
      <ProductThumb
        :src="image"
        :alt="product.images?.[0]?.alt || product.name"
        :width="140"
      />
      <UiBadge v-if="hasDiscount" tone="sale" size="sm" class="discount">
        −{{ discountPercent }}%
      </UiBadge>
    </NuxtLink>

    <div class="info">
      <!-- Admins only; a regular visitor sees nothing and fires no request. -->
      <AdminProductSourceNote :product-id="product.id" variant="line" />

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
        {{ pluralize(offerCount, 'offer') }}
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
          :aria-label="isFavourite ? 'Убрать из избранного' : 'В избранное'"
          :title="isFavourite ? 'Убрать из избранного' : 'В избранное'"
          @click="toggleWishlist"
        >
          <UiIcon name="heart" :size="17" :filled="isFavourite" />
        </button>
        <button
          type="button"
          :class="{ 'is-on': isComparing }"
          :aria-pressed="isComparing"
          :aria-label="isComparing ? 'Убрать из сравнения' : 'К сравнению'"
          :title="isComparing ? 'Убрать из сравнения' : 'К сравнению'"
          @click="toggleCompare"
        >
          <UiIcon name="compare" :size="17" :stroke-width="1.8" />
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
