<template>
  <div class="app-layout">
    <LayoutHeader />
    <main class="main-content">
      <slot />
    </main>
    <LayoutFooter />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
}

.main-content {
  width: min(1280px, calc(100% - 24px));
  flex: 1;
  margin: 0 auto;
  padding: 24px 0 56px;
}

@media (min-width: 960px) {
  .main-content {
    padding: 28px 0 72px;
  }
}
</style>
