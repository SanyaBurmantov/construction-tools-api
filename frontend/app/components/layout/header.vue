<script setup lang="ts">
const route = useRoute()

const links = computed(() => [
  { label: 'Каталог', to: '/catalog/', active: route.path.startsWith('/catalog') },
  { label: 'Бренды', to: '/catalog/?focus=brands', active: route.query.focus === 'brands' }
])
</script>

<template>
  <header class="site-header">
    <div class="header-shell">
      <NuxtLink to="/" class="brand">
        <span class="brand-mark">М</span>
        <span>
          <strong>Мультитул</strong>
          <small>инструменты и крепеж</small>
        </span>
      </NuxtLink>

      <nav class="navigation" aria-label="Основная навигация">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="nav-link"
          :class="{ active: link.active }"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="header-actions">
        <a class="phone" href="tel:+375298135797">+375 29 813-57-97</a>
        <NuxtLink class="catalog-cta" to="/catalog/">В каталог</NuxtLink>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid rgba(22, 28, 45, 0.08);
  background: rgba(248, 244, 235, 0.86);
  backdrop-filter: blur(18px);
}

.header-shell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: min(1320px, calc(100% - 32px));
  min-height: 82px;
  margin: 0 auto;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: var(--color-ink);
  text-decoration: none;

  strong,
  small {
    display: block;
  }

  strong {
    font-family: var(--font-heading);
    font-size: 21px;
    letter-spacing: -0.04em;
  }

  small {
    margin-top: 2px;
    color: var(--color-muted);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
}

.brand-mark {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 16px;
  background: var(--color-ink);
  color: var(--color-cream);
  font-family: var(--font-heading);
  font-size: 22px;
  font-weight: 800;
  box-shadow: 8px 8px 0 var(--color-accent);
}

.navigation {
  display: none;
  align-items: center;
  gap: 8px;

  @include media-breakpoint-up(lg) {
    display: flex;
  }
}

.nav-link {
  padding: 10px 14px;
  border-radius: 999px;
  color: var(--color-muted);
  font-weight: 700;
  text-decoration: none;
  transition: 0.2s ease;

  &:hover,
  &.active {
    background: rgba(15, 23, 42, 0.08);
    color: var(--color-ink);
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.phone {
  display: none;
  color: var(--color-ink);
  font-weight: 800;
  text-decoration: none;

  @include media-breakpoint-up(md) {
    display: inline-flex;
  }
}

.catalog-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 18px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: var(--color-accent);
  color: var(--color-ink);
  font-weight: 900;
  text-decoration: none;
  box-shadow: 4px 4px 0 var(--color-ink);
  transition: 0.18s ease;

  &:hover {
    transform: translate(-2px, -2px);
    box-shadow: 6px 6px 0 var(--color-ink);
  }
}

@media (max-width: 520px) {
  .header-shell {
    min-height: 72px;
  }

  .brand small {
    display: none;
  }

  .catalog-cta {
    min-height: 38px;
    padding: 0 14px;
  }
}
</style>
