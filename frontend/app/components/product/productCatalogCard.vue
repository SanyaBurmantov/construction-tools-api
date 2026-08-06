<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'

const props = withDefaults(
  defineProps<{
    product: CatalogProduct
    /** Compact cards drop the spec preview — used in carousels and sidebars. */
    compact?: boolean
  }>(),
  { compact: false }
)

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

const specs = computed(() =>
  props.compact ? [] : (props.product.productSpecs?.slice(0, 3) ?? [])
)
const link = computed(() => `/product/${props.product.slug}`)
</script>

<template>
  <article class="product-card" :class="{ 'is-compact': compact }">
    <div class="media">
      <NuxtLink :to="link" class="image-link" :aria-label="product.name">
        <img
          v-if="image"
          :src="image"
          :alt="product.images?.[0]?.alt || product.name"
          loading="lazy"
          decoding="async"
        >
        <span v-else class="placeholder" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 8l8-4 8 4v8l-8 4-8-4V8zm0 0l8 4m0 0l8-4m-8 4v8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
          </svg>
        </span>
      </NuxtLink>

      <div class="flags">
        <UiBadge v-if="hasDiscount" tone="sale" size="sm">−{{ discountPercent }}%</UiBadge>
      </div>

      <div class="quick-actions">
        <button
          type="button"
          class="icon-action"
          :class="{ 'is-on': isFavourite }"
          :aria-pressed="isFavourite"
          :aria-label="isFavourite ? 'Убрать из избранного' : 'В избранное'"
          :title="isFavourite ? 'Убрать из избранного' : 'В избранное'"
          @click="toggleWishlist"
        >
          <svg viewBox="0 0 24 24">
            <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z" :fill="isFavourite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-action"
          :class="{ 'is-on': isComparing }"
          :aria-pressed="isComparing"
          :aria-label="isComparing ? 'Убрать из сравнения' : 'К сравнению'"
          :title="isComparing ? 'Убрать из сравнения' : 'К сравнению'"
          @click="toggleCompare"
        >
          <svg viewBox="0 0 24 24">
            <path d="M6 20V9m6 11V4m6 16v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <div class="body">
      <span v-if="product.brand?.name" class="brand">{{ product.brand.name }}</span>

      <NuxtLink :to="link" class="title">{{ product.name }}</NuxtLink>

      <UiRating
        v-if="product.ratingCount"
        :value="product.ratingAvg"
        :count="product.ratingCount"
        size="sm"
      />

      <span v-if="product.sku" class="sku">Арт. {{ product.sku }}</span>

      <dl v-if="specs.length" class="specs">
        <div v-for="spec in specs" :key="spec.name">
          <dt>{{ spec.name }}</dt>
          <dd>{{ spec.value }}</dd>
        </div>
      </dl>

      <div class="footer">
        <div class="price-block">
          <UiPrice
            :value="product.priceValue"
            :old-price="product.oldPrice"
            :currency="product.priceCurrency"
            :from="hasMultipleOffers"
            size="sm"
            :show-badge="false"
          />
          <span class="availability" :class="{ 'is-in-stock': inStock }">
            <span class="dot" aria-hidden="true" />
            {{ availabilityLabel }}
          </span>
          <span v-if="hasMultipleOffers" class="offers">
            {{ offerCount }} предложения поставщиков
          </span>
        </div>

        <UiButton
          v-if="canBuy"
          :variant="inCart ? 'secondary' : 'primary'"
          size="sm"
          :aria-label="`Добавить «${product.name}» в корзину`"
          @click="addToCart()"
        >
          {{ inCart ? 'В корзине' : 'В корзину' }}
        </UiButton>
        <UiButton v-else variant="secondary" size="sm" :to="link">
          Подробнее
        </UiButton>
      </div>
    </div>
  </article>
</template>

<style scoped>
.product-card {
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  transition:
    border-color var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}

.product-card:hover {
  border-color: var(--border-default);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* ---- Media ---- */
.media {
  position: relative;
  background: var(--surface-card);
}

.image-link {
  display: block;
  aspect-ratio: 4 / 3;
  padding: var(--space-4);
}

.image-link img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: multiply;
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
  width: 40%;
  max-width: 56px;
  height: auto;
}

.flags {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.quick-actions {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
}

.product-card:hover .quick-actions,
.quick-actions:focus-within {
  opacity: 1;
}

/* Touch devices have no hover, so the actions must always be reachable. */
@media (hover: none) {
  .quick-actions {
    opacity: 1;
  }
}

.icon-action {
  display: grid;
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-muted);
  place-items: center;
  box-shadow: var(--shadow-xs);
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.icon-action:hover {
  border-color: var(--brand);
  color: var(--brand);
}

.icon-action.is-on {
  border-color: var(--brand);
  color: var(--brand);
}

.icon-action svg {
  width: 18px;
  height: 18px;
}

/* ---- Body ---- */
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.brand {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-base);
  font-weight: 700;
  line-height: var(--leading-snug);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.title:hover {
  color: var(--text-link);
}

.sku {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.specs {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) 0;
  margin: 0;
  border-top: 1px dashed var(--border-subtle);
  gap: var(--space-1);
}

.specs > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-xs);
}

.specs dt {
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.specs dd {
  margin: 0;
  color: var(--text-default);
  font-weight: 600;
  text-align: right;
}

.footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: auto;
  padding-top: var(--space-3);
  gap: var(--space-3);
}

.price-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.availability {
  display: flex;
  align-items: center;
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

.offers {
  color: var(--text-link);
  font-size: 11px;
}

.is-compact .image-link {
  aspect-ratio: 1;
  padding: var(--space-3);
}
</style>
