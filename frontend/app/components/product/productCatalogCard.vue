<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'

const props = withDefaults(
  defineProps<{
    product: CatalogProduct
    /** Compact cards drop the spec preview — used in carousels and sidebars. */
    compact?: boolean
    /**
     * Above-the-fold cards load their photo eagerly. Everything was `lazy`,
     * including the first row, which made the LCP image wait for the lazy
     * loader instead of starting with the document.
     */
    priority?: boolean
  }>(),
  { compact: false, priority: false }
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
      <!-- Admins only; renders nothing for a regular visitor, and overlays
           the photo so the card layout is identical for everyone. -->
      <AdminProductSourceNote :product-id="product.id" class="source-badge" />
      <NuxtLink :to="link" class="image-link" :aria-label="product.name">
        <ProductThumb
          :src="image"
          :alt="product.images?.[0]?.alt || product.name"
          :width="300"
          :priority="priority"
        />
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
          <UiIcon name="heart" :size="18" :filled="isFavourite" />
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
          <UiIcon name="compare" :size="18" :stroke-width="1.8" />
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
            {{ pluralize(offerCount, 'offer') }} поставщиков
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
.source-badge {
  position: absolute;
  z-index: 1;
  bottom: var(--space-2);
  left: var(--space-2);
}

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

/**
 * 4/3 matches the largest share of the catalogue: every content.tools.by photo
 * is 1200x900, and th-tool.by's own mix is 38% square / 18% 4:3 / 44% a long
 * tail that runs from 0.55 to 5.3. No single ratio fits, so `contain` always
 * leaves some photos smaller than their panel — making them genuinely uniform
 * needs a padded canvas from the image pipeline, not a different box here.
 */
.image-link {
  display: block;
  aspect-ratio: 4 / 3;
  padding: var(--space-4);
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

.icon-action:hover,
.icon-action.is-on {
  border-color: var(--brand);
  color: var(--brand);
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
