<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
const slug = route.params.slug

const { data: product, pending, error } = useAsyncData(`product`, () => {
  return $fetch(`http://localhost:8000/products/${slug}`)
})
</script>

<template>
  <div v-if="pending">Загрузка...</div>
  <div v-else-if="error">Ошибка: {{ error.message }}</div>
  <div v-else>
    <div class="product-page">
      <div class="content-block">
        <div class="">
        <div v-for="image of product.images" :key="product.id" class="image-wrapper">
          <img :src="image.url" :alt="image.alt" />
        </div>
          тут типа слайдер
        </div>
      </div>
      <div class="content-block">
        <h1>{{ product.name }}</h1>
        <p>{{ product.description }}</p>
        <p>Цена: {{ product.priceValue }} {{ product.priceCurrency }}</p>


        {{product}}
      </div>
    </div>

  </div>
</template>

<style scoped lang="scss">
.product-page {
  display: flex;
  gap: 14px;
  .content-block {
    width: 50%;
  }
}
.image-wrapper {
  width: 140px;
  height: 140px;
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  &:first-child {
    width: 100%;
    height: 100%;
  }
}
</style>