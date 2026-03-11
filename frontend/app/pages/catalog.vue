<script setup lang="ts">
import { productMock } from '~/data/mocks/products'
import type { ProductData } from '~/types/product'

const product: ProductData = productMock
</script>

<template>
  <div class="grid">
    <ProductCard :product="product" />
  </div>
</template>

<style scoped>
.grid {
  width: 100%;
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
</style>