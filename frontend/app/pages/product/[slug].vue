<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

type Product = {
  id: string
  slug: string
  name: string
  sku?: string | null
  model?: string | null
  priceValue?: number | null
  priceCurrency?: string | null
  oldPrice?: number | null
  stockStatus?: string | null
  descriptionShort?: string | null
  descriptionFull?: string | null
  brand?: { id: string, name: string, slug?: string } | null
  category?: { id: string, name: string, slug?: string } | null
  images?: Array<{ id: string, url: string, alt?: string | null }>
  sourceProducts?: Array<{ id: string, url: string, name: string, price?: number | null, currency?: string | null }>
  productSpecs?: Array<{ name: string, value: string }>
}

const route = useRoute()
const config = useRuntimeConfig()
const cart = useCartStore()
const slug = computed(() => String(route.params.slug))
const productDataKey = computed(() => `product:${slug.value}`)
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const { data: product, pending, error } = await useAsyncData<Product>(
  productDataKey,
  () => $fetch(`${apiBase}/products/${slug.value}`),
  { watch: [slug] }
)

const activeImage = ref(0)
const images = computed(() => product.value?.images || [])
const selectedImage = computed(() => images.value[activeImage.value])
const currency = computed(() => {
  const value = product.value?.priceCurrency?.trim().toUpperCase()
  return value && /^[A-Z]{3}$/.test(value) ? value : 'BYN'
})
const price = computed(() => {
  if (!product.value || product.value.priceValue === null || product.value.priceValue === undefined) {
    return 'Цена по запросу'
  }

  return new Intl.NumberFormat('ru-BY', {
    style: 'currency',
    currency: currency.value,
    maximumFractionDigits: 2
  }).format(product.value.priceValue)
})

const availability = computed(() => {
  if (product.value?.stockStatus === 'in_stock') return 'В наличии'
  if (product.value?.stockStatus === 'out_of_stock') return 'Под заказ'
  return product.value?.stockStatus || 'Наличие уточняйте'
})

const canBuy = computed(
  () => !!product.value && product.value.priceValue != null && product.value.priceValue > 0
)
const quantity = ref(1)
const justAdded = ref(false)

function addToCart() {
  if (!product.value || !canBuy.value) return
  cart.add(
    {
      productId: product.value.id,
      slug: product.value.slug,
      name: product.value.name,
      sku: product.value.sku ?? null,
      image: images.value[0]?.url || null,
      price: product.value.priceValue as number,
      currency: currency.value
    },
    quantity.value
  )
  justAdded.value = true
  setTimeout(() => (justAdded.value = false), 2000)
}

watch(images, () => {
  activeImage.value = 0
})

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
  twitterImage: () => ogImage.value
})

useHead(() => {
  const p = product.value
  const ld: Record<string, unknown>[] = []

  if (p) {
    const productLd: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      url: canonicalUrl.value
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
        priceCurrency: currency.value,
        availability:
          p.stockStatus === 'out_of_stock'
            ? 'https://schema.org/BackOrder'
            : 'https://schema.org/InStock',
        url: canonicalUrl.value
      }
    }
    ld.push(productLd)

    const crumbs: Array<{ name: string, url: string }> = [
      { name: 'Главная', url: `${siteBase.value}/` },
      { name: 'Каталог', url: `${siteBase.value}/catalog` }
    ]
    if (p.category?.name) {
      crumbs.push({
        name: p.category.name,
        url: p.category.slug
          ? `${siteBase.value}/catalog/${p.category.slug}`
          : `${siteBase.value}/catalog?categoryId=${p.category.id}`
      })
    }
    crumbs.push({ name: p.name, url: canonicalUrl.value })
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.url
      }))
    })
  }

  return {
    link: [{ rel: 'canonical', href: canonicalUrl.value }],
    script: ld.map((node) => ({
      type: 'application/ld+json',
      innerHTML: JSON.stringify(node)
    }))
  }
})
</script>

<template>
  <div v-if="pending" class="state-card">Загрузка товара...</div>
  <div v-else-if="error" class="state-card error">Ошибка: {{ error.message }}</div>
  <article v-else-if="product" class="product-page">
    <nav class="breadcrumbs" aria-label="Хлебные крошки">
      <NuxtLink to="/">Главная</NuxtLink>
      <span aria-hidden="true">/</span>
      <NuxtLink to="/catalog/">Каталог</NuxtLink>
      <template v-if="product.category">
        <span aria-hidden="true">/</span>
        <NuxtLink
          :to="product.category.slug ? `/catalog/${product.category.slug}` : `/catalog/?categoryId=${product.category.id}`"
        >
          {{ product.category.name }}
        </NuxtLink>
      </template>
      <span aria-hidden="true">/</span>
      <strong>{{ product.name }}</strong>
    </nav>

    <section class="product-hero">
      <div class="gallery">
        <div class="main-image">
          <img
            v-if="selectedImage?.url"
            :src="selectedImage.url"
            :alt="selectedImage.alt || product.name"
            fetchpriority="high"
            decoding="async"
          >
          <div v-else class="image-placeholder">нет фото</div>
        </div>

        <div v-if="images.length > 1" class="thumbs">
          <button
            v-for="(image, index) in images"
            :key="image.id"
            type="button"
            :class="{ active: activeImage === index }"
            @click="activeImage = index"
          >
            <img :src="image.url" :alt="image.alt || product.name" loading="lazy" decoding="async">
          </button>
        </div>
      </div>

      <div class="summary">
        <div class="chips">
          <NuxtLink
            v-if="product.category"
            :to="product.category.slug ? `/catalog/${product.category.slug}` : `/catalog/?categoryId=${product.category.id}`"
          >
            {{ product.category.name }}
          </NuxtLink>
          <NuxtLink v-if="product.brand" :to="`/catalog/?brands=${product.brand.id}`">
            {{ product.brand.name }}
          </NuxtLink>
        </div>

        <h1>{{ product.name }}</h1>
        <p v-if="product.descriptionShort" class="lead">{{ product.descriptionShort }}</p>

        <div class="buy-box">
          <div>
            <span class="label">Цена</span>
            <strong>{{ price }}</strong>
          </div>
          <div>
            <span class="label">Статус</span>
            <strong>{{ availability }}</strong>
          </div>
        </div>

        <div class="meta-grid">
          <div v-if="product.sku">
            <span>Артикул</span>
            <strong>{{ product.sku }}</strong>
          </div>
          <div v-if="product.model">
            <span>Модель</span>
            <strong>{{ product.model }}</strong>
          </div>
        </div>

        <div v-if="canBuy" class="cart-row">
          <div class="qty-control">
            <button type="button" aria-label="Меньше" @click="quantity = Math.max(1, quantity - 1)">−</button>
            <input v-model.number="quantity" type="number" min="1" max="999">
            <button type="button" aria-label="Больше" @click="quantity = Math.min(999, quantity + 1)">+</button>
          </div>
          <button class="primary-action" type="button" @click="addToCart">
            {{ justAdded ? 'Добавлено ✓' : 'В корзину' }}
          </button>
        </div>
        <button v-else class="primary-action" type="button">
          Запросить наличие
        </button>
      </div>
    </section>

    <section class="details-grid">
      <div v-if="product.productSpecs?.length" class="details-card">
        <span class="eyebrow">Характеристики</span>
        <h2>Что важно знать</h2>
        <dl>
          <template v-for="spec in product.productSpecs" :key="spec.name">
            <dt>{{ spec.name }}</dt>
            <dd>{{ spec.value }}</dd>
          </template>
        </dl>
      </div>

      <div class="details-card">
        <span class="eyebrow">Описание</span>
        <h2>О товаре</h2>
        <p>
          {{ product.descriptionFull || product.descriptionShort || 'Описание пока не заполнено.' }}
        </p>
      </div>
    </section>
  </article>
</template>

<style scoped lang="scss">
.state-card {
  border: 2px solid var(--color-ink);
  border-radius: 30px;
  background: var(--color-card);
  box-shadow: 7px 7px 0 var(--color-ink);
  color: var(--color-muted);
  font-weight: 900;
  padding: 42px;
}

.state-card.error {
  color: var(--color-accent-strong);
}

.product-page {
  display: grid;
  gap: 28px;
}

.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 600;

  a {
    color: inherit;
    text-decoration: none;

    &:hover {
      color: var(--color-primary);
    }
  }

  strong {
    overflow: hidden;
    max-width: 360px;
    color: #101828;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.product-hero,
.details-card {
  border: 2px solid var(--color-ink);
  border-radius: 38px;
  background: rgba(255, 250, 240, 0.94);
  box-shadow: 10px 10px 0 var(--color-ink);
}

.product-hero {
  display: grid;
  gap: 28px;
  padding: clamp(20px, 4vw, 44px);

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) 0.85fr;
    align-items: start;
  }
}

.gallery {
  display: grid;
  gap: 16px;
}

.main-image {
  display: grid;
  min-height: 360px;
  place-items: center;
  overflow: hidden;
  border: 2px solid var(--color-ink);
  border-radius: 30px;
  background:
    radial-gradient(circle at 50% 40%, rgba(243, 182, 31, 0.3), transparent 18rem),
    white;

  img {
    width: 100%;
    max-height: 520px;
    object-fit: contain;
    padding: 28px;
  }
}

.image-placeholder {
  color: var(--color-subtle);
  font-family: var(--font-heading);
  text-transform: uppercase;
}

.thumbs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 12px;

  button {
    overflow: hidden;
    height: 78px;
    border: 2px solid transparent;
    border-radius: 18px;
    background: white;
    cursor: pointer;

    &.active {
      border-color: var(--color-ink);
    }
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 8px;
  }
}

.summary {
  display: grid;
  gap: 24px;

  h1 {
    font-size: clamp(32px, 5vw, 58px);
    line-height: 1.04;
  }
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  a {
    border: 1px solid var(--color-line);
    border-radius: 999px;
    background: white;
    color: var(--color-muted);
    font-weight: 900;
    padding: 8px 12px;
    text-decoration: none;
  }
}

.lead {
  color: var(--color-muted);
  font-size: 18px;
  line-height: 1.7;
}

.buy-box,
.meta-grid {
  display: grid;
  gap: 12px;

  @include media-breakpoint-up(md) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.buy-box > div,
.meta-grid > div {
  border: 1px solid var(--color-line);
  border-radius: 24px;
  background: white;
  padding: 18px;
}

.label,
.meta-grid span {
  display: block;
  margin-bottom: 8px;
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.buy-box strong {
  display: block;
  color: var(--color-ink);
  font-size: 24px;
}

.cart-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.qty-control {
  display: inline-flex;
  align-items: center;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  overflow: hidden;

  button {
    width: 44px;
    height: 48px;
    border: 0;
    background: white;
    cursor: pointer;
    font-size: 22px;
    font-weight: 900;
  }

  input {
    width: 56px;
    height: 48px;
    border: 0;
    border-left: 2px solid var(--color-ink);
    border-right: 2px solid var(--color-ink);
    text-align: center;
    font-weight: 900;
    font-size: 16px;
    outline: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
}

.primary-action {
  display: inline-flex;
  justify-content: center;
  width: max-content;
  max-width: 100%;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-ink);
  cursor: pointer;
  font-weight: 900;
  padding: 15px 22px;
  text-decoration: none;
  box-shadow: 5px 5px 0 var(--color-ink);
}

.details-grid {
  display: grid;
  gap: 28px;

  @include media-breakpoint-up(lg) {
    grid-template-columns: 1fr 1fr;
  }
}

.details-card {
  padding: clamp(24px, 4vw, 38px);

  h2 {
    margin: 8px 0 22px;
    font-size: clamp(24px, 3vw, 36px);
  }

  p {
    color: var(--color-muted);
    font-size: 17px;
    line-height: 1.8;
  }
}

.eyebrow {
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

dl {
  display: grid;
  gap: 0;
  margin: 0;
}

dt,
dd {
  margin: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-line);
}

dt {
  color: var(--color-muted);
  font-weight: 800;
}

dd {
  color: var(--color-ink);
  font-weight: 900;
}

@include media-breakpoint-up(md) {
  dl {
    grid-template-columns: minmax(160px, 0.7fr) 1fr;
  }
}
</style>

<style scoped lang="scss">
.state-card {
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: white;
  box-shadow: var(--shadow-card);
  color: var(--color-muted);
  padding: 32px;
}

.state-card.error {
  color: #b42318;
}

.product-page {
  gap: 18px;
}

.product-hero,
.details-card {
  border: 1px solid var(--color-line);
  border-radius: 24px;
  background: white;
  box-shadow: var(--shadow-card);
}

.product-hero {
  gap: 28px;
  padding: clamp(18px, 3vw, 32px);

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) 430px;
  }
}

.main-image {
  min-height: 420px;
  border: 1px solid var(--color-line);
  border-radius: 20px;
  background: #f8fafc;

  img {
    padding: 22px;
  }
}

.thumbs {
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 10px;

  button {
    height: 72px;
    border: 1px solid var(--color-line);
    border-radius: 12px;

    &.active {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.12);
    }
  }
}

.summary {
  align-content: start;
  gap: 18px;

  h1 {
    font-size: clamp(28px, 4vw, 42px);
    line-height: 1.12;
  }
}

.chips a {
  border-color: #d0d5dd;
  border-radius: 999px;
  background: #f8fafc;
  color: #344054;
  padding: 7px 10px;
}

.lead {
  color: var(--color-muted);
  font-size: 16px;
}

.buy-box,
.meta-grid {
  gap: 10px;
}

.buy-box > div,
.meta-grid > div {
  border-radius: 16px;
  background: #f8fafc;
  padding: 16px;
}

.label,
.meta-grid span {
  margin-bottom: 5px;
  color: var(--color-muted);
  font-size: 12px;
  letter-spacing: 0.04em;
}

.buy-box strong {
  font-size: 26px;
}

.primary-action {
  width: 100%;
  border: 0;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  box-shadow: none;
  padding: 14px 18px;
}

.details-grid {
  gap: 18px;
}

.details-card {
  padding: clamp(20px, 3vw, 30px);

  h2 {
    margin: 5px 0 16px;
    font-size: clamp(22px, 3vw, 30px);
  }

  p {
    color: #475467;
    font-size: 16px;
    line-height: 1.7;
  }
}

dl {
  border-top: 1px solid var(--color-line);
}

dt,
dd {
  border-bottom: 1px solid var(--color-line);
  padding: 12px 0;
}

dt {
  color: var(--color-muted);
}

dd {
  color: #101828;
}
</style>
