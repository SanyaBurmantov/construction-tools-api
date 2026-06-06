<script setup lang="ts">
useHead({
  title: 'Оплата и доставка | Мультитул'
})
</script>

<template>
  <section class="info-page">
    <h1>Оплата и доставка</h1>
    <p>Страница в разработке. Условия оплаты и варианты доставки скоро появятся здесь.</p>
  </section>
</template>

<style scoped lang="scss">
.info-page {
  width: min(980px, calc(100% - 32px));
  margin: 40px auto 80px;

  h1 {
    margin-bottom: 14px;
  }

  p {
    color: var(--color-muted);
    line-height: 1.7;
  }
}
</style>
