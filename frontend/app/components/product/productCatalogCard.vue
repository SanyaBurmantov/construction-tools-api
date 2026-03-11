<script setup>
import BaseButton from '~/components/ui/BaseButton.vue';

const props = defineProps({
  product: {
    type: Object,
    default: () => {}
  }
})
</script>


<template>
  <div class="catalog-card">
    <NuxtLink :to="`/product/${product.slug}`">
      <div v-if="product?.images?.length && product?.images[0]?.url" class="product-image">
        <img :src="product.images[0].url" :alt="sdfsdf" />
      </div>
      {{ product?.name }}
    </NuxtLink>
    <BaseButton>
      В корзину
    </BaseButton>
  </div>
</template>
<style scoped lang="scss">
.catalog-card {

}
.product-image {
  position: relative;
  width: 180px;
  height: 150px;
  @include media-breakpoint-up(lg){
    width: 300px;
    height: 200px;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
</style>
