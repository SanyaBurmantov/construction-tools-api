<script setup>

import ProductCatalogCard from '~/components/product/productCatalogCard.vue';

const { data: products } = useAsyncData('products', () =>
    $fetch('http://localhost:8000/products?limit=20')
)

</script>

<template>
  <div v-if="products?.data" class="products-listing">
    <div v-for="product of products.data">
      <ProductCatalogCard :product="product" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.products-listing {
  display: grid;
  grid-template-columns: 1fr 1fr;
  @include media-breakpoint-up(md){
    grid-template-columns: 1fr 1fr 1fr;
  }
  @include media-breakpoint-up(lg) {
    grid-template-columns: 1fr 1fr 1fr 1fr;
  }

}
</style>