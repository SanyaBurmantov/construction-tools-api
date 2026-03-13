<script setup lang="ts">
// Просто композиция уровней
</script>

<template>
  <header class="header">
    <LayoutTopHeader class="header__top" />
    <LayoutMainHeader class="header__main" />
    <LayoutCatalogHeader class="header__catalog" />
  </header>
</template>

<style scoped lang="scss">
.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px;
  width: 100%;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;

  &__top {
    padding: 8px 0;
    border-bottom: 1px solid #f0f0f0;
  }

  &__main {
    padding: 12px 0;
  }

  &__catalog {
    padding: 8px 0;
    background: #f9f9f9;
  }
}
</style>