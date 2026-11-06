<script setup lang="ts">
import type { CatalogProduct } from '~/composables/useProductActions'
import type { BreadcrumbItem, ProductDetail, ProductRecommendations } from '~/types/api'
import { company } from '~/data/company'
import { copyText } from '~/utils/clipboard'

/** «Арт. … ⧉» beside the brand: one click puts the article on the clipboard. */
const skuToast = useAppToast()
const skuCopied = ref(false)
async function copySku() {
  const sku = product.value?.sku
  if (!sku) return
  if (await copyText(sku)) {
    skuCopied.value = true
    skuToast.success(`Артикул ${sku} скопирован`)
    setTimeout(() => { skuCopied.value = false }, 2000)
  } else {
    skuToast.error('Не удалось скопировать — выделите артикул вручную')
  }
}

// Slugs are `[a-z0-9-]` (prod has no other), and anything else 404s before
// a fetch: `/product/..%2Fprice-list.xlsx` used to send SSR — unthrottled,
// from the private network — to any backend GET (audit 2026-10-30).
definePageMeta({
  validate: route => /^[a-z0-9-]{1,200}$/.test(String(route.params.slug)),
})

const route = useRoute()
const config = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))
const { apiBase, absoluteUrl, siteUrl } = useSite()

// The key follows the slug, so it alone re-runs the fetch on navigation.
const { data: product, status, error } = await useAsyncData<ProductDetail>(
  () => `product:${slug.value}`,
  () => $fetch(`${apiBase}/products/${encodeURIComponent(slug.value)}`)
)

if (error.value) {
  // An unreachable API is not a missing product: answering 404 for every URL
  // in the catalogue while the database is down is both a lie to the visitor
  // and a signal to search engines to drop the pages.
  if (isApiUnavailable(error.value)) throw apiUnavailableError()

  // A product merged into another answers 404 with the survivor's slug, so the
  // old URL keeps its links and search ranking instead of dying.
  const detail = (error.value as { data?: { redirectTo?: string, searchTo?: string } }).data
  const redirectTo = detail?.redirectTo
  if (redirectTo) {
    await navigateTo(`/product/${redirectTo}`, { redirectCode: 301, replace: true })
  } else if (detail?.searchTo) {
    // An address naming a pack we do not carry, of an item we do in other
    // packs (backend legacy-product-slug.ts): the search shows them all.
    // 302, not 301 — a search page is not where this address lives for good.
    await navigateTo({ path: '/catalog', query: { search: detail.searchTo } }, { redirectCode: 302, replace: true })
  } else {
    throw createError({ statusCode: 404, statusMessage: 'Товар не найден', fatal: true })
  }
}

const fallbackProduct: CatalogProduct = { id: '', slug: '', name: '' }
const {
  currency,
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
    currency: currency.value,
  })
}, { immediate: true })

/* ---- Buy box ----------------------------------------------------------- */
const quantity = ref(1)

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
const { terms } = useOrderTerms()
const postCost = computed(() => Number(config.public.deliveryPost))
const { formatPrice } = useFormatPrice()

/* ---- Description tabs -------------------------------------------------- */
type DetailsTab = 'description' | 'specs' | 'reviews'
const shortOpen = ref(false)
const hasDescription = computed(
  () => Boolean(product.value?.descriptionFull || product.value?.descriptionShort)
)
const specs = computed(() => product.value?.productSpecs ?? [])
/**
 * Описание / Характеристики / Отзывы. Every panel is rendered into the HTML
 * and only the inactive ones are hidden (`v-show`): with `v-if` the specs
 * were never in the page a search engine reads.
 */
const tab = ref<DetailsTab>(hasDescription.value ? 'description' : specs.value.length ? 'specs' : 'reviews')
const detailTabs = computed(() => [
  ...(hasDescription.value ? [{ value: 'description', label: 'Описание' }] : []),
  ...(specs.value.length ? [{ value: 'specs', label: 'Характеристики', count: specs.value.length }] : []),
  { value: 'reviews', label: 'Отзывы', count: product.value?.ratingCount || null },
])

/** «Все характеристики →», «К отзывам»: open the tab and bring it into view. */
function openTab(value: DetailsTab) {
  tab.value = value
  nextTick(() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

// A link to …#reviews (a letter, a search snippet) lands on the open tab.
onMounted(() => {
  if (window.location.hash === '#reviews') openTab('reviews')
})

watch(() => product.value?.id, () => {
  quantity.value = 1
  // Each product starts on a tab with content, even when the page is reused.
  tab.value = hasDescription.value ? 'description' : 'specs'
}, { immediate: true })

/* ---- Recommendations ---------------------------------------------------- */
// One answer feeds the packs in the buy box and the blocks under the reviews.
// Rendered on the server (links for crawlers); client navigation stays lazy.
const {
  data: recommendations,
  error: recommendationsError,
  refresh: refreshRecommendations,
} = await useAsyncData<ProductRecommendations | null>(
  () => `recommendations:${product.value?.slug ?? ''}`,
  () =>
    product.value
      ? $fetch<ProductRecommendations>(
        `${apiBase}/products/${encodeURIComponent(product.value.slug)}/recommendations`
      )
      : Promise.resolve(null),
  { lazy: true }
)

/* ---- Breadcrumbs ------------------------------------------------------- */
const breadcrumbs = computed(() => {
  const crumbs: BreadcrumbItem[] = [
    { label: 'Главная', to: '/' },
    { label: 'Каталог', to: '/catalog', category: '' },
  ]
  // The whole path, as on the category page — it used to jump from
  // «Каталог» straight to the leaf.
  for (const ancestor of product.value?.categoryAncestors ?? []) {
    crumbs.push({ label: ancestor.name, to: `/catalog/${ancestor.slug}`, category: ancestor.slug })
  }
  if (product.value?.category?.name) {
    const slug = product.value.category.slug
    crumbs.push({
      label: product.value.category.name,
      to: slug ? `/catalog/${slug}` : undefined,
      ...(slug ? { category: slug } : {}),
    })
  }
  crumbs.push({ label: product.value?.name ?? 'Товар' })
  return crumbs
})

/* ---- SEO --------------------------------------------------------------- */
const images = computed(() => product.value?.images ?? [])
const canonicalUrl = computed(() => absoluteUrl(`/product/${slug.value}`))
const ogImage = computed(() => ogImageUrl(siteUrl, images.value[0]?.url))

/**
 * «Цена обновлена 28.10.2026» — the last time a supplier's price was read.
 * Prices are re-read daily, so the JSON-LD promises them for a week from
 * that check: honest, and still in the future for a live product. A product
 * whose offers stopped syncing shows an old date, which is the truth.
 */
const PRICE_VALID_DAYS = 7
const priceCheckedAt = computed(() => {
  const value = product.value?.priceCheckedAt
  return value ? new Date(value) : null
})
const priceCheckedLabel = computed(() =>
  priceCheckedAt.value
    ? new Intl.DateTimeFormat('ru-BY', { timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', year: 'numeric' }).format(priceCheckedAt.value)
    : ''
)
/**
 * Our own template, never the supplier's `descriptionShort` — on some sources
 * that is their SEO blurb with their phone and «в Минске» in it. See
 * utils/product-meta.ts.
 */
const metaDescription = computed(() => {
  const p = product.value
  if (!p?.name) return 'Карточка товара Gost.by'
  // Set only when we wrote it (AI task or admin): the API nulls the
  // supplier's own SEO text.
  if (p.seoDescription?.trim()) return p.seoDescription.trim()
  return buildProductMetaDescription({
    name: p.name,
    brand: p.brand?.name,
    price: p.priceValue,
    currency: p.priceCurrency,
    priceFrom: hasMultipleOffers.value,
    stockStatus: p.stockStatus,
  })
})

useSeoMeta({
  title: () => {
    const p = product.value
    const title = p?.seoTitle?.trim() || p?.name
    return title ? `${title} | Gost.by` : 'Товар | Gost.by'
  },
  description: () => metaDescription.value,
  ogTitle: () => product.value?.name || 'Товар | Gost.by',
  ogDescription: () => metaDescription.value,
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
  ogImage: () => ogImage.value,
  ogImageWidth: () => (ogImage.value ? OG_IMAGE_WIDTH : undefined),
  ogImageHeight: () => (ogImage.value ? OG_IMAGE_HEIGHT : undefined),
  ogImageAlt: () => product.value?.name,
  // Twitter falls back to the og:* tags for title, description and image.
  twitterCard: 'summary_large_image',
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
  if (p.model) productLd.mpn = p.model
  // The barcode is how Google matches this page to searches for the product
  // and to other shops' offers of it.
  const gtin = gtinFromBarcode(p.barcode)
  if (gtin) productLd[gtin.key] = gtin.value
  // The full description is the product text; `descriptionShort` may be the
  // supplier's advert (see metaDescription), so it is not used here.
  productLd.description = p.descriptionFull || metaDescription.value
  if (images.value.length) productLd.image = images.value.map((image) => image.url)
  if (p.brand?.name) productLd.brand = { '@type': 'Brand', name: p.brand.name }
  if (p.priceValue != null && p.priceValue > 0) {
    productLd.offers = {
      '@type': 'Offer',
      price: p.priceValue,
      priceCurrency: currency.value,
      availability:
        p.stockStatus === 'out_of_stock'
          ? 'https://schema.org/BackOrder'
          : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      url: canonicalUrl.value,
      seller: { '@type': 'Organization', name: 'Gost.by' },
      ...(priceCheckedAt.value
        ? {
            priceValidUntil: new Date(priceCheckedAt.value.getTime() + PRICE_VALID_DAYS * 86_400_000)
              .toISOString()
              .slice(0, 10),
          }
        : {}),
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: courierCost.value, currency: 'BYN' },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'BY' },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'BY',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnInStore',
      },
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
      <!-- Admins only: which supplier this card was parsed from. -->
      <AdminProductSourceNote :product-id="product.id" variant="banner" show-empty />

      <UiBreadcrumbs :items="breadcrumbs" />

      <div class="layout">
        <!-- Gallery: stays in view while the summary column scrolls (the
             sticky part is .product-gallery inside; this column only gives
             it the row's height to travel in). -->
        <div class="gallery-col">
          <ProductGallery :images="product.images ?? []" :name="product.name">
            <UiBadge v-if="hasDiscount" tone="sale">−{{ discountPercent }}%</UiBadge>
          </ProductGallery>
        </div>

        <!-- Summary + buy box -->
        <section class="summary">
          <div class="summary-head">
            <!-- Brand on the left, the article on the right — a purchaser
                 copies it into a request or a 1C order in one click. -->
            <div class="head-row">
              <NuxtLink
                v-if="product.brand?.name"
                :to="product.brand.slug ? `/brand/${product.brand.slug}` : '/brand'"
                class="brand"
              >
                {{ product.brand.name }}
              </NuxtLink>
              <button
                v-if="product.sku"
                type="button"
                class="sku-copy"
                :title="`Скопировать артикул ${product.sku}`"
                @click="copySku"
              >
                <span class="sku-label">Арт.</span>
                <span class="sku-value">{{ product.sku }}</span>
                <UiIcon :name="skuCopied ? 'check' : 'copy'" :size="15" :stroke-width="2" />
              </button>
            </div>

            <h1>{{ product.name }}</h1>

            <div class="meta">
              <UiRating
                v-if="product.ratingCount"
                :value="product.ratingAvg"
                :count="product.ratingCount"
                size="sm"
                show-value
              />
              <a v-if="product.ratingCount" href="#reviews" class="meta-link" @click.prevent="openTab('reviews')">К отзывам</a>
              <span v-if="product.model" class="meta-item">Модель: {{ product.model }}</span>
            </div>
          </div>

          <!-- Supplier texts run long: four lines, the rest one tap away. -->
          <div v-if="product.descriptionShort" class="short-description" :class="{ 'is-open': shortOpen }">
            <p>{{ product.descriptionShort }}</p>
            <button
              v-if="product.descriptionShort.length > 260"
              type="button"
              class="more-link"
              @click="shortOpen = !shortOpen"
            >
              {{ shortOpen ? 'Свернуть' : 'Читать полностью' }}
            </button>
          </div>

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
              @click="openTab('specs')"
            >
              Все характеристики ({{ product.productSpecs!.length }}) →
            </button>
          </dl>

          <!-- No supplier carries it right now: the page stays (search engines
               keep it, a visitor from a link sees the product), with a request
               to the manager and the alternatives below instead of a price. -->
          <div v-if="product.unavailable" class="buy-box">
            <p class="unavailable-badge">Нет в наличии</p>
            <p class="unavailable-text">
              Сейчас этого товара нет у наших поставщиков. Оставьте заявку —
              менеджер уточнит срок поставки или подберёт аналог.
            </p>
            <ClientOnly>
              <ProductAskManager
                :product-id="product.id"
                :product-name="product.name"
                :in-stock="false"
                prominent
              />
            </ClientOnly>
            <a href="#similar" class="unavailable-similar">Похожие товары в наличии ↓</a>
            <div class="secondary-actions">
              <button
                type="button"
                class="text-action"
                :class="{ 'is-on': isFavourite }"
                :aria-pressed="isFavourite"
                @click="toggleWishlist"
              >
                <UiIcon name="heart" :filled="isFavourite" />
                {{ isFavourite ? 'В избранном' : 'В избранное' }}
              </button>
            </div>
          </div>

          <div v-else class="buy-box">
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
              <span v-if="priceCheckedLabel" class="price-checked">· цена обновлена {{ priceCheckedLabel }}</span>
            </p>

            <ProductVariants v-if="recommendations?.variants?.length" :variants="recommendations.variants" />

            <ProductPacks v-if="recommendations?.packs?.length" :packs="recommendations.packs" />

            <div v-if="canBuy" class="buy-actions">
              <UiQuantity v-model="quantity" />
              <UiButton size="lg" class="buy-button" data-early-click="buy-box" @click="addToCart(quantity)">
                {{ inCart ? 'Добавить ещё' : 'В корзину' }}
              </UiButton>
            </div>
            <StorefrontRetailNote v-if="canBuy" />
            <UiAlert v-else tone="warning">
              Цена уточняется — свяжитесь с нами, чтобы оформить заказ.
            </UiAlert>

            <ProductBundle v-if="canBuy && recommendations" :product="product" :recommendations="recommendations" />

            <div class="secondary-actions">
              <button
                type="button"
                class="text-action"
                :class="{ 'is-on': isFavourite }"
                :aria-pressed="isFavourite"
                @click="toggleWishlist"
              >
                <UiIcon name="heart" :filled="isFavourite" />
                {{ isFavourite ? 'В избранном' : 'В избранное' }}
              </button>

              <button
                type="button"
                class="text-action"
                :class="{ 'is-on': isComparing }"
                :aria-pressed="isComparing"
                @click="toggleCompare"
              >
                <UiIcon name="compare" :stroke-width="1.8" />
                {{ isComparing ? 'В сравнении' : 'Сравнить' }}
              </button>

              <ClientOnly>
                <ProductAskManager :product-id="product.id" :product-name="product.name" :in-stock="inStock" />
              </ClientOnly>
            </div>

            <p v-if="(product.offers?.count ?? 0) > 1" class="offers-note">
              <UiIcon name="check" :stroke-width="2" />
              Лучшая цена из {{ pluralize(product.offers!.count, 'offerOf') }} поставщиков
            </p>

            <!-- Concrete terms, not adjectives: what it costs and where to collect. -->
            <dl class="terms">
              <div>
                <dt>Доставка</dt>
                <dd>
                  курьер {{ formatPrice(courierCost, 'BYN') }} ·
                  почта {{ formatPrice(postCost, 'BYN') }} ·
                  самовывоз бесплатно · организациям бесплатно от
                  {{ formatPrice(terms.freeDeliveryCompanyFrom, 'BYN') }}
                </dd>
              </div>
              <div>
                <dt>Оплата</dt>
                <dd>по счёту — для организаций и ИП</dd>
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
      <section id="details" class="details">
        <UiTabs v-model="tab" :tabs="detailTabs" />

        <div v-if="hasDescription" v-show="tab === 'description'" class="description">
          <p>{{ product.descriptionFull || product.descriptionShort }}</p>
        </div>

        <div v-if="specs.length" v-show="tab === 'specs'" class="specs-table">
          <dl>
            <div v-for="spec in specs" :key="spec.name">
              <dt>{{ spec.name }}</dt>
              <dd>{{ spec.value }}</dd>
            </div>
          </dl>
        </div>

        <div v-show="tab === 'reviews'">
          <ProductReviews :slug="product.slug" :product-name="product.name" in-tab />
        </div>
      </section>

      <ProductRecommendations
        id="similar"
        :key="product.id"
        :slug="product.slug"
        :initial="recommendations"
        :error="recommendationsError"
        @retry="refreshRecommendations()"
      />



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
        <UiButton size="lg" data-early-click="buy-sticky" @click="addToCart(quantity)">В корзину</UiButton>
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
  /* Photo and summary half and half on a computer (owner, 2026-11-05). */
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* ---- Summary ---- */
.summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-5);
}

.summary-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.head-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.sku-copy {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  margin-left: auto;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-muted);
  cursor: copy;
  font-size: var(--text-sm);
  gap: var(--space-1);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.sku-copy:hover,
.sku-copy:focus-visible {
  border-color: var(--brand);
  color: var(--brand);
}

.sku-value {
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: all;
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

.short-description p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.short-description.is-open p {
  display: block;
}

.more-link {
  margin-top: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
}

.gallery-col {
  /* Stretched to the row so the sticky gallery inside has room to travel.
     It used to be sticky itself at 24 px — under the 69 px header, inside
     another sticky box — so the photo slid under the header and parted from
     the summary while it scrolled. */
  align-self: stretch;
  min-width: 0;
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

.price-checked {
  color: var(--text-subtle);
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
  flex-wrap: wrap;
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
  scroll-margin-top: var(--space-20, 80px);
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
  /* `minmax(0, …)`: a bare `1fr` cannot shrink below its widest item, and one
     wide photo or unbroken code then pushed the whole page past the screen. */
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .gallery-col {
    align-self: start;
    width: 100%;
    max-width: 640px;
    margin-inline: auto;
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

/* ---- «Нет в наличии» ---- */
.unavailable-badge {
  align-self: flex-start;
  margin: 0;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.unavailable-text {
  margin: 0;
  color: var(--text-default);
  line-height: 1.5;
}

.unavailable-similar {
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
}
</style>
