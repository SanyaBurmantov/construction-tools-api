<template>
  <div class="app-layout">
    <!-- First focusable element: keyboard and screen-reader users skip the
         header and its mega-menu straight to the page. -->
    <a class="skip-link" href="#main">Перейти к содержимому</a>
    <LayoutHeader />
    <main id="main" class="main-content container" :class="{ 'ym-hide-content ym-disable-keys': privatePage }" tabindex="-1">
      <slot />
    </main>
    <LayoutCompareBar />
    <LayoutMobileNav />
    <LayoutFooter />
    <LayoutCookieConsent />
    <UiToaster />
  </div>
</template>

<script setup lang="ts">
/**
 * Pages with a customer's name, phone, address or company requisites (the
 * cart's «счёт без регистрации», the leads form on /organizaciyam). Webvisor
 * records the screen; these classes make Metrika leave the text and the
 * keystrokes inside out of the recording (audit 2026-10-30). The rest of the
 * storefront is still recorded as before.
 */
const PRIVATE_PAGE_RE = /^\/(?:cart|checkout|account|login|register|verify-email|organizaciyam)(?:\/|$)/

const route = useRoute()
const privatePage = computed(() => PRIVATE_PAGE_RE.test(route.path))
</script>

<style scoped>
.skip-link {
  position: absolute;
  z-index: var(--z-toast);
  top: var(--space-3);
  left: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--brand);
  color: var(--text-inverse);
  font-weight: 600;
  text-decoration: none;
  box-shadow: var(--shadow-lg);
  transform: translateY(calc(-100% - var(--space-6)));
}

.skip-link:focus,
.skip-link:focus-visible {
  transform: none;
}

.main-content:focus {
  outline: none;
}
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
