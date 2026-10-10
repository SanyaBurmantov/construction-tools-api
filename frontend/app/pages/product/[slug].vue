<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import { company } from '~/data/company'
import ProductGallery from '~/components/product/productGallery.vue'

type Product = CatalogProduct & {
  model?: string | null
  descriptionShort?: string | null
  descriptionFull?: string | null
  images?: Array<{ id?: string, url: string, alt?: string | null }>
  /** Aggregate only — supplier links and costs never leave the admin API. */
  offers?: { count: number, inStockCount: number }
}

const route = useRoute()
const config = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const { data: product, status, error } = await useAsyncData<Product>(
  () => `product:${slug.value}`,
  () => $fetch(`${apiBase}/products/${slug.value}`),
  { watch: [slug] }
)

if (error.value) {
  // A product merged into another answers 404 with the survivor's slug, so the
  // old URL keeps its links and search ranking instead of dying.
  const redirectTo = (error.value as { data?: { redirectTo?: string } }).data?.redirectTo
  if (redirectTo) {
    await navigateTo(`/product/${redirectTo}`, { redirectCode: 301, replace: true })
  } else {
    throw createError({ statusCode: 404, statusMessage: 'Товар не найден', fatal: true })
  }
}

const fallbackProduct: CatalogProduct = { id: '', slug: '', name: '' }
const {
  canBuy,
  inStock,
  availabilityLabel,
  hasMultipleOffers,
  hasDiscount,
  discountPercent,
  isFavourite,
  isComparing,
  inCart,
  addToCart,
  toggleWishlist,
  toggleCompare,
} = useProductActions(() => product.value ?? fallbackProduct)

// Feeds the "Вы смотрели" rail on the home page.
const recentlyViewed = useRecentlyViewed()
watch(() => product.value?.id, () => {
  const value = product.value
  if (!value) return
  recentlyViewed.track({
    slug: value.slug,
    name: value.name,
    image: value.images?.[0]?.url ?? null,
    price: value.priceValue ?? null,
    currency: value.priceCurrency || 'BYN',
  })
}, { immediate: true })

/* ---- Buy box ----------------------------------------------------------- */
const quantity = ref(1)
const currency = computed(() => product.value?.priceCurrency)

const savings = computed(() => {
  if (!hasDiscount.value || !product.value) return 0
  return (product.value.oldPrice as number) - (product.value.priceValue as number)
})

/**
 * Key specs surfaced next to the buy button. Burying every characteristic in a
 * tab means the buyer has to scroll and click before they can tell whether the
 * item fits — the references all show a short list up front instead.
 */
const KEY_SPEC_COUNT = 5
const keySpecs = computed(() => product.value?.productSpecs?.slice(0, KEY_SPEC_COUNT) ?? [])

const courierCost = computed(() => Number(config.public.deliveryCourier))
const postCost = computed(() => Number(config.public.deliveryPost))
const { formatPrice } = useFormatPrice()

/* ---- Description tabs -------------------------------------------------- */
const tab = ref<'description' | 'specs'>('description')
const hasDescription = computed(
  () => Boolean(product.value?.descriptionFull || product.value?.descriptionShort)
)
const specs = computed(() => product.value?.productSpecs ?? [])

watch(() => product.value?.id, () => {
  quantity.value = 1
  // Each product starts on a tab with content, even when the page is reused.
  tab.value = hasDescription.value ? 'description' : 'specs'
}, { immediate: true })

/* ---- Related ----------------------------------------------------------- */
const { data: related } = await useAsyncData(
  () => `related:${slug.value}`,
  async () => {
    const categorySlug = product.value?.category?.slug
    if (!categorySlug) return []
    const response = await $fetch<{ data: CatalogProduct[] }>(`${apiBase}/products`, {
      params: { categorySlug, limit: 5 },
    }).catch(() => ({ data: [] }))
    return response.data.filter((item) => item.id !== product.value?.id).slice(0, 4)
  },
  { watch: [product], default: () => [] as CatalogProduct[] }
)

/* ---- Breadcrumbs ------------------------------------------------------- */
const breadcrumbs = computed(() => {
  const crumbs: Array<{ label: string, to?: string }> = [
    { label: 'Главная', to: '/' },
    { label: 'Каталог', to: '/catalog/' },
  ]
  if (product.value?.category?.name) {
    crumbs.push({
      label: product.value.category.name,
      to: product.value.category.slug ? `/catalog/${product.value.category.slug}` : undefined,
    })
  }
  crumbs.push({ label: product.value?.name ?? 'Товар' })
  return crumbs
})

/* ---- SEO --------------------------------------------------------------- */
const images = computed(() => product.value?.images ?? [])
const siteBase = computed(() => String(config.public.siteUrl).replace(/\/$/, ''))
const canonicalUrl = computed(() => `${siteBase.value}/product/${slug.value}`)
const ogImage = computed(() => images.value[0]?.url || undefined)
const metaDescription = computed(
  () => product.value?.descriptionShort || product.value?.name || 'Карточка товара Мультитул'
)

useSeoMeta({
  title: () => (product.value?.name ? `${product.value.name} | Мультитул` : 'Товар | Мультитул'),
  description: () => metaDescription.value,
  ogTitle: () => product.value?.name || 'Товар | Мультитул',
  ogDescription: () => metaDescription.value,
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
  ogImage: () => ogImage.value,
  twitterCard: 'summary_large_image',
  twitterTitle: () => product.value?.name || 'Товар | Мультитул',
  twitterDescription: () => metaDescription.value,
  twitterImage: () => ogImage.value,
})

useHead(() => {
  const p = product.value
  if (!p) return { link: [{ rel: 'canonical', href: canonicalUrl.value }] }

  const productLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url: canonicalUrl.value,
  }
  if (p.sku) productLd.sku = p.sku
  if (p.descriptionShort || p.descriptionFull) {
    productLd.description = p.descriptionShort || p.descriptionFull
  }
  if (images.value.length) productLd.image = images.value.map((image) => image.url)
  if (p.brand?.name) productLd.brand = { '@type': 'Brand', name: p.brand.name }
  if (p.priceValue != null && p.priceValue > 0) {
    productLd.offers = {
      '@type': 'Offer',
      price: p.priceValue,
      priceCurrency: p.priceCurrency || 'BYN',
      availability:
        p.stockStatus === 'out_of_stock'
          ? 'https://schema.org/BackOrder'
          : 'https://schema.org/InStock',
      url: canonicalUrl.value,
    }
  }
  // Only emit aggregateRating when there really are reviews — Google rejects
  // the markup otherwise.
  if (p.ratingCount && p.ratingAvg) {
    productLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: p.ratingAvg,
      reviewCount: p.ratingCount,
    }
  }

  return {
    link: [{ rel: 'canonical', href: canonicalUrl.value }],
    script: [{ type: 'application/ld+json', innerHTML: JSON.stringify(productLd) }],
  }
})
</script>

<template>
  <div class="product-page">
    <div v-if="status === 'pending'" class="loading">
      <UiSkeleton height="420px" radius="var(--radius-lg)" />
      <div class="loading-side">
        <UiSkeleton :lines="6" height="18px" />
      </div>
    </div>

    <template v-else-if="product">
      <UiBreadcrumbs :items="breadcrumbs" />

      <div class="layout">
        <!-- Gallery -->
        <ProductGallery :images="product.images ?? []" :name="product.name">
          <UiBadge v-if="hasDiscount" tone="sale">−{{ discountPercent }}%</UiBadge>
        </ProductGallery>

        <!-- Summary + buy box -->
        <section class="summary">
          <div class="summary-head">
            <NuxtLink
              v-if="product.brand?.name"
              :to="product.brand.slug ? `/brand/${product.brand.slug}` : '/brand/'"
              class="brand"
            >
              {{ product.brand.name }}
            </NuxtLink>

            <h1>{{ product.name }}</h1>

            <div class="meta">
              <UiRating
                v-if="product.ratingCount"
                :value="product.ratingAvg"
                :count="product.ratingCount"
                size="sm"
                show-value
              />
              <a v-if="product.ratingCount" href="#reviews" class="meta-link">К отзывам</a>
              <span v-if="product.sku" class="meta-item">Арт. {{ product.sku }}</span>
              <span v-if="product.model" class="meta-item">Модель: {{ product.model }}</span>
            </div>
          </div>

          <p v-if="product.descriptionShort" class="short-description">
            {{ product.descriptionShort }}
          </p>

          <!-- Key specs before the buy box, so the fit question is answered
               without scrolling into a tab. -->
          <dl v-if="keySpecs.length" class="key-specs">
            <div v-for="spec in keySpecs" :key="spec.name">
              <dt>{{ spec.name }}</dt>
              <dd>{{ spec.value }}</dd>
            </div>
            <button
              v-if="(product.productSpecs?.length ?? 0) > KEY_SPEC_COUNT"
              type="button"
              class="all-specs"
              @click="tab = 'specs'"
            >
              Все характеристики ({{ product.productSpecs!.length }}) →
            </button>
          </dl>

          <div class="buy-box">
            <div class="price-row">
              <UiPrice
                :value="product.priceValue"
                :old-price="product.oldPrice"
                :currency="currency"
                :from="hasMultipleOffers"
                size="lg"
              />
              <p v-if="savings > 0" class="savings">
                Экономия {{ formatPrice(savings, currency) }}
              </p>
            </div>

            <p class="availability" :class="{ 'is-in-stock': inStock }">
              <span class="dot" aria-hidden="true" />
              {{ availabilityLabel }}
            </p>

            <div v-if="canBuy" class="buy-actions">
              <UiQuantity v-model="quantity" :max="999" />
              <UiButton size="lg" class="buy-button" @click="addToCart(quantity)">
                {{ inCart ? 'Добавить ещё' : 'В корзину' }}
              </UiButton>
            </div>
            <UiAlert v-else tone="warning">
              Цена уточняется — свяжитесь с нами, чтобы оформить заказ.
            </UiAlert>

            <div class="secondary-actions">
              <button
                type="button"
                class="text-action"
                :class="{ 'is-on': isFavourite }"
                :aria-pressed="isFavourite"
                @click="toggleWishlist"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z" :fill="isFavourite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                </svg>
                {{ isFavourite ? 'В избранном' : 'В избранное' }}
              </button>

              <button
                type="button"
                class="text-action"
                :class="{ 'is-on': isComparing }"
                :aria-pressed="isComparing"
                @click="toggleCompare"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 20V9m6 11V4m6 16v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
                {{ isComparing ? 'В сравнении' : 'Сравнить' }}
              </button>
            </div>

            <p v-if="(product.offers?.count ?? 0) > 1" class="offers-note">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              Лучшая цена из {{ pluralize(product.offers!.count, 'offer') }} поставщиков
            </p>

            <!-- Concrete terms, not adjectives: what it costs and where to collect. -->
            <dl class="terms">
              <div>
                <dt>Доставка</dt>
                <dd>
                  курьер {{ formatPrice(courierCost, 'BYN') }} ·
                  почта {{ formatPrice(postCost, 'BYN') }} ·
                  самовывоз бесплатно
                </dd>
              </div>
              <div>
                <dt>Оплата</dt>
                <dd>наличными, картой или по счёту для организаций</dd>
              </div>
              <div>
                <dt>Самовывоз</dt>
                <dd>{{ company.storeAddress }}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      <!-- Details -->
      <section v-if="hasDescription || specs.length" class="details">
        <UiTabs
          v-model="tab"
          :tabs="[
            ...(hasDescription ? [{ value: 'description', label: 'Описание' }] : []),
            ...(specs.length ? [{ value: 'specs', label: 'Характеристики', count: specs.length }] : [])
          ]"
        />

        <div v-if="tab === 'description' && hasDescription" class="description">
          <p>{{ product.descriptionFull || product.descriptionShort }}</p>
        </div>

        <div v-else-if="tab === 'specs' && specs.length" class="specs-table">
          <dl>
            <div v-for="spec in specs" :key="spec.name">
              <dt>{{ spec.name }}</dt>
              <dd>{{ spec.value }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <ProductReviews :slug="product.slug" :product-name="product.name" />

      <section v-if="related.length" class="related">
        <h2>Похожие товары</h2>
        <div class="related-grid">
          <ProductCatalogCard
            v-for="item in related"
            :key="item.id"
            :product="item"
            compact
          />
        </div>
      </section>

      <!-- Sticky buy bar: on a phone the buy box scrolls away long before the
           customer has finished reading, so price and action follow them. -->
      <div v-if="canBuy" class="mobile-buy">
        <div class="mobile-buy-price">
          <UiPrice
            :value="product.priceValue"
            :old-price="product.oldPrice"
            :currency="currency"
            :from="hasMultipleOffers"
            size="sm"
            :show-badge="false"
          />
          <span :class="{ 'is-in-stock': inStock }">{{ availabilityLabel }}</span>
        </div>
        <UiButton size="lg" @click="addToCart(quantity)">В корзину</UiButton>
      </div>

    </template>
  </div>
</template>

<style scoped>
.product-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.loading {
  display: grid;
  gap: var(--space-8);
  grid-template-columns: 1fr 1fr;
}

.layout {
  display: grid;
  align-items: start;
  gap: var(--space-8);
  grid-template-columns: minmax(0, 1fr) minmax(0, 460px);
}

/* ---- Summary ---- */
.summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.summary-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.brand {
  color: var(--brand);
  font-size: var(--text-xs);
  font-weight: 800;
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

.summary h1 {
  font-size: var(--text-2xl);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.meta-link {
  color: var(--text-link);
}

.meta-link:hover {
  text-decoration: underline;
}

.short-description {
  color: var(--text-muted);
}

.buy-box {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  gap: var(--space-4);
}

.price-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.savings {
  color: var(--success);
  font-size: var(--text-sm);
  font-weight: 700;
}

.availability {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.availability .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-subtle);
}

.availability.is-in-stock {
  color: var(--success);
  font-weight: 700;
}

.availability.is-in-stock .dot {
  background: var(--success);
}

.buy-actions {
  display: flex;
  gap: var(--space-3);
}

.buy-button {
  flex: 1;
}

.secondary-actions {
  display: flex;
  gap: var(--space-4);
}

.text-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 600;
  transition: color var(--duration-fast) var(--ease-out);
}

.text-action:hover,
.text-action.is-on {
  color: var(--brand);
}

.text-action svg {
  width: 18px;
  height: 18px;
}

.offers-note {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--success-soft);
  color: var(--success-soft-text);
  font-size: var(--text-sm);
  font-weight: 600;
  gap: var(--space-2);
}

.offers-note svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.terms {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) 0 0;
  margin: 0;
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.terms > div {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 92px 1fr;
  font-size: var(--text-sm);
}

.terms dt {
  color: var(--text-muted);
}

.terms dd {
  margin: 0;
  color: var(--text-default);
}

/* ---- Key specs ---- */
.key-specs {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  margin: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-2);
}

.key-specs > div {
  display: grid;
  align-items: baseline;
  gap: var(--space-3);
  grid-template-columns: minmax(120px, 42%) 1fr;
  font-size: var(--text-sm);
}

.key-specs dt {
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.key-specs dd {
  margin: 0;
  color: var(--text-strong);
  font-weight: 600;
}

.all-specs {
  margin-top: var(--space-1);
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
  text-align: left;
}

.all-specs:hover {
  text-decoration: underline;
}

/* ---- Details ---- */
.details {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.description {
  max-width: 80ch;
  color: var(--text-default);
  line-height: var(--leading-normal);
  white-space: pre-line;
}

.specs-table dl {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: 0;
}

.specs-table dl > div {
  display: grid;
  padding: var(--space-3) var(--space-4);
  gap: var(--space-4);
  grid-template-columns: minmax(180px, 320px) 1fr;
}

.specs-table dl > div:nth-child(odd) {
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
}

.specs-table dt {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.specs-table dd {
  margin: 0;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
}

/* ---- Related ---- */
.related {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.related-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
}

/* ---- Sticky mobile buy bar ---- */
.mobile-buy {
  position: fixed;
  z-index: var(--z-sticky);
  right: 0;
  bottom: 0;
  left: 0;
  display: none;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-card);
  box-shadow: var(--shadow-lg);
  gap: var(--space-3);
  /* Sits above the bottom navigation, not under it. */
  bottom: calc(62px + env(safe-area-inset-bottom));
}

.mobile-buy-price {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.mobile-buy-price span {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.mobile-buy-price span.is-in-stock {
  color: var(--success);
  font-weight: 600;
}

/* ---- Responsive ---- */
@media (max-width: 1024px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .loading {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .mobile-buy {
    display: flex;
  }

  /* Room for the fixed bar so it never covers the last block. */
  .product-page {
    padding-bottom: 96px;
  }
}

@media (max-width: 640px) {
  .specs-table dl > div {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }

  .buy-actions {
    flex-wrap: wrap;
  }
}
</style>
