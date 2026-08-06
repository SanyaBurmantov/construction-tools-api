<template>
  <div class="app-layout">
    <LayoutHeader />
    <main class="main-content container">
      <slot />
    </main>
    <LayoutCompareBar />
    <LayoutMobileNav />
    <LayoutFooter />
    <UiToaster />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
}

.main-content {
  flex: 1;
  padding: var(--space-6) 0 var(--space-16);
}

/* Room for the fixed bottom navigation on phones. */
@media (max-width: 860px) {
  .app-layout {
    padding-bottom: 62px;
  }
}

@media (min-width: 960px) {
  .main-content {
    padding: var(--space-8) 0 var(--space-20);
  }
}
</style>
