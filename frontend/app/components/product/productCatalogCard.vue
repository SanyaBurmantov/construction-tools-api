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
const currency = computed(() => {
  const value = props.product.priceCurrency?.trim().toUpperCase()
  return value && /^[A-Z]{3}$/.test(value) ? value : 'BYN'
})
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

const specs = computed(() => props.product.productSpecs?.slice(0, 2) || [])
const availability = computed(() => {
  if (props.product.stockStatus === 'in_stock') return 'В наличии'
  if (props.product.stockStatus === 'out_of_stock') return 'Под заказ'
  return props.product.stockStatus || 'Уточняйте'
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
      <div v-else class="image-placeholder">Нет фото</div>
    </NuxtLink>

    <div class="card-body">
      <NuxtLink :to="`/product/${product.slug}`" class="title">
        {{ product.name }}
      </NuxtLink>

      <div class="meta-row">
        <span v-if="product.brand?.name">{{ product.brand.name }}</span>
        <span v-if="product.category?.name">{{ product.category.name }}</span>
      </div>

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
        <NuxtLink :to="`/product/${product.slug}`" class="details-link">Подробнее</NuxtLink>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.catalog-card {
  display: flex;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;

  &:hover {
    border-color: #c7d7fe;
    box-shadow: var(--shadow-card);
    transform: translateY(-2px);
  }
}

.image-link {
  display: grid;
  height: 210px;
  place-items: center;
  background: #f8fafc;
  text-decoration: none;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 16px;
  }
}

.image-placeholder {
  color: var(--color-subtle);
  font-size: 13px;
  font-weight: 700;
}

.card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}

.title {
  display: -webkit-box;
  overflow: hidden;
  min-height: 42px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: #101828;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  text-decoration: none;

  &:hover {
    color: var(--color-primary);
  }
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    overflow: hidden;
    max-width: 100%;
    border-radius: 999px;
    background: #f2f4f7;
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 700;
    padding: 4px 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.specs {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--color-muted);
    font-size: 12px;
  }

  strong {
    overflow: hidden;
    max-width: 45%;
    color: #344054;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.purchase-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;

  small {
    display: block;
    margin-top: 3px;
    color: var(--color-green);
    font-size: 12px;
    font-weight: 700;
  }
}

.price {
  display: block;
  color: #101828;
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.03em;
}

.details-link {
  flex: 0 0 auto;
  border-radius: 10px;
  background: #eef4ff;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 800;
  padding: 9px 11px;
  text-decoration: none;
}
</style>
