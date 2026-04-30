<script setup lang="ts">
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
const slug = computed(() => String(route.params.slug))
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const { data: product, pending, error } = await useAsyncData<Product>(
  `product-${slug.value}`,
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

watch(images, () => {
  activeImage.value = 0
})

useHead(() => ({
  title: product.value?.name ? `${product.value.name} | Мультитул` : 'Товар | Мультитул',
  meta: [
    {
      name: 'description',
      content:
        product.value?.descriptionShort || product.value?.name || 'Карточка товара Мультитул'
    }
  ]
}))
</script>

<template>
  <div v-if="pending" class="state-card">Загрузка товара...</div>
  <div v-else-if="error" class="state-card error">Ошибка: {{ error.message }}</div>
  <article v-else-if="product" class="product-page">
    <NuxtLink to="/catalog/" class="back-link">Назад в каталог</NuxtLink>

    <section class="product-hero">
      <div class="gallery">
        <div class="main-image">
          <img
            v-if="selectedImage?.url"
            :src="selectedImage.url"
            :alt="selectedImage.alt || product.name"
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
            <img :src="image.url" :alt="image.alt || product.name">
          </button>
        </div>
      </div>

      <div class="summary">
        <div class="chips">
          <NuxtLink v-if="product.category" :to="`/catalog/?categoryId=${product.category.id}`">
            {{ product.category.name }}
          </NuxtLink>
          <NuxtLink v-if="product.brand" :to="`/catalog/?brandId=${product.brand.id}`">
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

        <a
          v-if="product.sourceProducts?.[0]?.url"
          class="primary-action"
          :href="product.sourceProducts[0].url"
          target="_blank"
          rel="noreferrer"
        >
          Открыть у поставщика
        </a>
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

.back-link {
  width: max-content;
  color: var(--color-muted);
  font-weight: 900;
  text-decoration: none;
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
