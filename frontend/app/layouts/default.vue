<template>
  <div class="app-layout">
    <LayoutHeader />
    <main class="main-content">
      <slot />
    </main>
    <LayoutFooter />
  </div>
</template>

<script setup></script>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.main-content {
  flex: 1;
  padding: 32px 16px 72px;
  max-width: 1360px;
  width: 100%;
  margin: 0 auto;
}

@media (min-width: 960px) {
  .main-content {
    padding: 44px 20px 88px;
  }
}
</style>
