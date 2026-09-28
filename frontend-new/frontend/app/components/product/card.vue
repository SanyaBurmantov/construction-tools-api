<template>
  <div class="product-card">
    <NuxtLink :to="productUrl" class="image-wrapper">
      <img
          :src="mainImage"
          :alt="product.name"
      />
    </NuxtLink>

    <NuxtLink :to="productUrl" class="title">
      {{ product.name }}
    </NuxtLink>

    <div v-if="product.brand" class="brand">
      {{ product.brand }}
    </div>

    <div class="price">
      {{ formatPrice(product.price) }}
    </div>

    <div
        class="availability"
        :class="{ in_stock: product.inStock || product.availability_status === 'in_stock' }"
    >
      {{ product.availability || (product.inStock ? 'В наличии' : 'Нет в наличии') }}
    </div>

    <UIButton variant="primary" size="md" block>
      В корзину
    </UIButton>
  </div>
</template>

<script setup lang="ts">
import type { ProductData } from '~/types/product'

const props = defineProps<{
  product: ProductData
}>()

const productUrl = computed(() => {
  if (props.product.slug) {
    return `/product/${props.product.slug}`
  }
  if (props.product.url) {
    return props.product.url
  }
  return `/product/${props.product.id}`
})

const mainImage = computed(() => {
  const images = props.product.images
  if (!images || images.length === 0) {
    return '/placeholder.png'
  }
  if (typeof images[0] === 'string') {
    return images[0]
  }
  return images[0]?.src || '/placeholder.png'
})

const formatPrice = (price: any) => {
  if (!price) return '0 р.'
  if (typeof price === 'string') return price
  if (price.full) return price.full
  if (price.current) return `${price.current} ${price.currency || 'р.'}`
  return '0 р.'
}
</script>

<style scoped>
.product-card {
  background: var(--color-bg-light);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.08);
  transition: 0.2s ease;
}

.product-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.12);
}

.image-wrapper {
  display: block;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
}

.image-wrapper img {
  width: 100%;
  height: auto;
  display: block;
  transition: 0.3s ease;
}

.image-wrapper:hover img {
  transform: scale(1.05);
}

.title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: none;
  line-height: 1.35;
  min-height: 40px;
  display: block;
}

.title:hover {
  color: var(--color-accent);
}

.brand {
  font-size: 14px;
  color: var(--color-gray-dark);
}

.price {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-accent);
}

.availability {
  font-size: 13px;
  color: var(--color-gray-dark);
}

.availability.in_stock {
  color: #28a745;
}

.add-btn {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: none;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  background: var(--color-primary);
  color: var(--color-text-light);
  transition: background 0.2s ease;
}

.add-btn:hover {
  background: var(--color-primary-hover);
}
</style>
