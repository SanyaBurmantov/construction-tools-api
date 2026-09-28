<script setup lang="ts">
import type { ProductData } from '~/types/product'

const { fetchProducts } = useApi()
const products = ref<ProductData[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const loadProducts = async () => {
  try {
    loading.value = true
    error.value = null
    const response = await fetchProducts({ limit: 20 })
    products.value = response.data
  } catch (e) {
    error.value = 'Не удалось загрузить товары. Попробуйте позже.'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadProducts()
})
</script>

<template>
  <div class="catalog-page">
    <h1 class="catalog-title">Каталог товаров</h1>
    
    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>Загрузка товаров...</p>
    </div>
    
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
      <UIButton @click="loadProducts" variant="primary">
        Попробовать снова
      </UIButton>
    </div>
    
    <div v-else-if="products.length === 0" class="empty">
      <p>Товары не найдены</p>
    </div>
    
    <div v-else class="grid">
      <ProductCard 
        v-for="product in products" 
        :key="product.id" 
        :product="product" 
      />
    </div>
  </div>
</template>

<style scoped>
.catalog-page {
  padding: 20px 0;
}

.catalog-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 24px;
}

.loading,
.error,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.loading p,
.error p,
.empty p {
  font-size: 18px;
  color: var(--color-gray-medium);
  margin-top: 16px;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--color-gray-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.grid {
  width: 100%;
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
</style>