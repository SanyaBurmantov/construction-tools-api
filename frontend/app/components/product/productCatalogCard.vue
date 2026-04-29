<script setup lang="ts">
const props = defineProps<{
  product: {
    id: string
    slug: string
    name: string
    priceValue?: number | null
    priceCurrency?: string | null
    stockStatus?: string | null
    brand?: { name: string } | null
    category?: { name: string } | null
    images?: Array<{ url: string, alt?: string | null }>
    productSpecs?: Array<{ name: string, value: string }>
  }
}>()

const image = computed(() => props.product.images?.[0])
const currency = computed(() => props.product.priceCurrency || 'BYN')
const price = computed(() => {
  if (props.product.priceValue === null || props.product.priceValue === undefined) {
    return 'Цена по запросу'
  }

  return new Intl.NumberFormat('ru-BY', {
    style: 'currency',
    currency: currency.value,
    maximumFractionDigits: 2
  }).format(props.product.priceValue)
})

const specs = computed(() => props.product.productSpecs?.slice(0, 3) || [])
const availability = computed(() => {
  if (props.product.stockStatus === 'in_stock') return 'В наличии'
  if (props.product.stockStatus === 'out_of_stock') return 'Под заказ'
  return props.product.stockStatus || 'Наличие уточняйте'
})
</script>

<template>
  <article class="catalog-card">
    <NuxtLink :to="`/product/${product.slug}`" class="image-link" :aria-label="product.name">
      <img
        v-if="image?.url"
        :src="image.url"
        :alt="image.alt || product.name"
        loading="lazy"
      >
      <div v-else class="image-placeholder">
        нет фото
      </div>
    </NuxtLink>

    <div class="card-body">
      <div class="meta-row">
        <span>{{ product.brand?.name || 'Без бренда' }}</span>
        <span>{{ product.category?.name || 'Каталог' }}</span>
      </div>

      <NuxtLink :to="`/product/${product.slug}`" class="title">
        {{ product.name }}
      </NuxtLink>

      <ul v-if="specs.length" class="specs">
        <li v-for="spec in specs" :key="`${product.id}-${spec.name}`">
          <span>{{ spec.name }}</span>
          <strong>{{ spec.value }}</strong>
        </li>
      </ul>

      <div class="purchase-row">
        <div>
          <strong class="price">{{ price }}</strong>
          <small>{{ availability }}</small>
        </div>
        <NuxtLink :to="`/product/${product.slug}`" class="details-link">
          Подробнее
        </NuxtLink>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.catalog-card {
  position: relative;
  display: flex;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 2px solid var(--color-ink);
  border-radius: 28px;
  background: var(--color-card);
  box-shadow: 8px 8px 0 rgba(22, 28, 45, 0.92);
  transition: 0.22s ease;

  &:hover {
    transform: translate(-3px, -3px);
    box-shadow: 12px 12px 0 rgba(22, 28, 45, 0.92);

    img {
      transform: scale(1.05) rotate(-1deg);
    }
  }
}

.image-link {
  display: grid;
  min-height: 220px;
  place-items: center;
  overflow: hidden;
  border-bottom: 2px solid var(--color-ink);
  background:
    linear-gradient(135deg, rgba(243, 182, 31, 0.26), rgba(255, 250, 240, 0.82)),
    repeating-linear-gradient(-45deg, transparent 0 12px, rgba(22, 28, 45, 0.05) 12px 14px);
  text-decoration: none;

  img {
    width: 100%;
    height: 240px;
    object-fit: contain;
    padding: 22px;
    transition: 0.25s ease;
  }
}

.image-placeholder {
  color: var(--color-subtle);
  font-family: var(--font-heading);
  font-size: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  span {
    padding: 6px 10px;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 800;
  }
}

.title {
  color: var(--color-ink);
  font-family: var(--font-heading);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
  text-decoration: none;
}

.specs {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--color-muted);
    font-size: 13px;
  }

  strong {
    color: var(--color-ink);
    text-align: right;
  }
}

.purchase-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  margin-top: auto;

  small {
    display: block;
    margin-top: 4px;
    color: var(--color-green);
    font-weight: 800;
  }
}

.price {
  display: block;
  color: var(--color-ink);
  font-size: 21px;
  line-height: 1;
}

.details-link {
  flex: 0 0 auto;
  padding: 11px 14px;
  border-radius: 999px;
  background: var(--color-ink);
  color: white;
  font-weight: 900;
  text-decoration: none;
}
</style>
