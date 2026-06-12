<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

type CategoryTreeNode = {
  id: string
  name: string
  slug: string
  productCount: number
  children: CategoryTreeNode[]
}

const NAV_CATEGORY_LIMIT = 8

const route = useRoute()
const search = ref('')
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const cart = useCartStore()

const { data: tree } = await useAsyncData<CategoryTreeNode[]>(
  'catalog-tree',
  () => $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`).catch(() => []),
  { default: () => [] }
)

const links = computed(() => [
  {
    label: 'Каталог',
    to: '/catalog/',
    active: route.path === '/catalog' || route.path === '/catalog/'
  },
  ...(tree.value || []).slice(0, NAV_CATEGORY_LIMIT).map(category => ({
    label: category.name,
    to: `/catalog/${category.slug}`,
    active: route.path.startsWith(`/catalog/${category.slug}`)
  })),
  { label: 'Бренды', to: '/brand/', active: route.path.startsWith('/brand') }
])

function submitSearch() {
  const query = search.value.trim()
  closeSuggest()
  navigateTo({ path: '/catalog/', query: query ? { search: query } : undefined })
}

// --- живые подсказки ---
type SuggestProduct = { id: string, name: string, slug: string, sku?: string | null, priceValue?: number | null, priceCurrency?: string | null, image?: string | null }
type SuggestLink = { id: string, name: string, slug: string }
type SuggestResponse = { products: SuggestProduct[], categories: SuggestLink[], brands: SuggestLink[] }

const { formatPrice } = useFormatPrice()
const suggest = ref<SuggestResponse | null>(null)
const suggestOpen = ref(false)
const searchForm = ref<HTMLElement | null>(null)
let suggestTimer: ReturnType<typeof setTimeout> | undefined

const hasSuggestions = computed(() =>
  Boolean(suggest.value && (suggest.value.products.length || suggest.value.categories.length || suggest.value.brands.length))
)

function closeSuggest() {
  suggestOpen.value = false
}

watch(search, value => {
  if (suggestTimer) clearTimeout(suggestTimer)
  const query = value.trim()
  if (query.length < 2) {
    suggest.value = null
    suggestOpen.value = false
    return
  }
  suggestTimer = setTimeout(async () => {
    try {
      const result = await $fetch<SuggestResponse>(`${config.public.apiBase}/products/suggest`, { params: { q: query } })
      // ответ мог устареть, пока пользователь печатал дальше
      if (search.value.trim() === query) {
        suggest.value = result
        suggestOpen.value = true
      }
    } catch {
      suggest.value = null
    }
  }, 250)
})

function onDocumentClick(event: MouseEvent) {
  if (searchForm.value && !searchForm.value.contains(event.target as Node)) closeSuggest()
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  if (suggestTimer) clearTimeout(suggestTimer)
})
</script>

<template>
  <header class="site-header">
    <div class="topbar">
      <span>Витебск</span>
      <a href="tel:+375298135797">+375 29 813-57-97</a>
      <a href="mailto:dm.krep@mail.ru">dm.krep@mail.ru</a>
    </div>

    <div class="header-shell">
      <NuxtLink to="/" class="brand" aria-label="Мультитул">
        <span class="brand-mark">М</span>
        <span>
          <strong>Мультитул</strong>
          <small>инструменты и крепеж</small>
        </span>
      </NuxtLink>

      <form
        ref="searchForm"
        class="header-search"
        role="search"
        @submit.prevent="submitSearch"
        @keydown.esc="closeSuggest"
      >
        <input
          v-model="search"
          type="search"
          placeholder="Искать инструмент, артикул, бренд"
          aria-label="Поиск по каталогу"
          @focus="hasSuggestions && (suggestOpen = true)"
        >
        <button type="submit">Найти</button>

        <div v-if="suggestOpen && hasSuggestions" class="suggest-panel">
          <div v-if="suggest?.products.length" class="suggest-group">
            <span class="suggest-title">Товары</span>
            <NuxtLink
              v-for="item in suggest.products"
              :key="item.id"
              :to="`/product/${item.slug}`"
              class="suggest-product"
              @click="closeSuggest"
            >
              <img v-if="item.image" :src="item.image" alt="" loading="lazy">
              <span v-else class="no-image" aria-hidden="true" />
              <span class="suggest-name">{{ item.name }}</span>
              <strong v-if="item.priceValue">{{ formatPrice(item.priceValue, item.priceCurrency) }}</strong>
            </NuxtLink>
          </div>

          <div v-if="suggest?.categories.length" class="suggest-group">
            <span class="suggest-title">Категории</span>
            <NuxtLink
              v-for="item in suggest.categories"
              :key="item.id"
              :to="`/catalog/${item.slug}`"
              class="suggest-link"
              @click="closeSuggest"
            >
              {{ item.name }}
            </NuxtLink>
          </div>

          <div v-if="suggest?.brands.length" class="suggest-group">
            <span class="suggest-title">Бренды</span>
            <NuxtLink
              v-for="item in suggest.brands"
              :key="item.id"
              :to="`/brand/${item.slug}/`"
              class="suggest-link"
              @click="closeSuggest"
            >
              {{ item.name }}
            </NuxtLink>
          </div>

          <button type="submit" class="suggest-all">Показать все результаты</button>
        </div>
      </form>

      <NuxtLink class="cart-button" to="/cart/" aria-label="Корзина">
        <span class="cart-icon" aria-hidden="true">🛒</span>
        <span class="cart-label">Корзина</span>
        <ClientOnly>
          <span v-if="cart.count" class="cart-badge">{{ cart.count }}</span>
        </ClientOnly>
      </NuxtLink>
    </div>

    <nav class="nav-row" aria-label="Основная навигация">
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
  </header>
</template>

<style scoped lang="scss">
.site-header {
  position: sticky;
  top: 0;
  z-index: 30;
  border-bottom: 1px solid var(--color-line);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
}

.topbar {
  display: none;
  width: min(1280px, calc(100% - 32px));
  min-height: 34px;
  align-items: center;
  gap: 18px;
  margin: 0 auto;
  color: var(--color-muted);
  font-size: 13px;

  a {
    text-decoration: none;
  }

  @include media-breakpoint-up(md) {
    display: flex;
  }
}

.header-shell {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  width: min(1280px, calc(100% - 32px));
  min-height: 68px;
  align-items: center;
  margin: 0 auto;

  @include media-breakpoint-up(md) {
    grid-template-columns: 260px minmax(0, 1fr) auto;
  }
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;

  strong,
  small {
    display: block;
  }

  strong {
    color: #101828;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.04em;
  }

  small {
    color: var(--color-muted);
    font-size: 12px;
  }
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 900;
}

.header-search {
  position: relative;
  display: none;
  height: 44px;
  border: 2px solid var(--color-primary);
  border-radius: 12px;
  background: white;

  @include media-breakpoint-up(md) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px;
  }

  input {
    min-width: 0;
    border: 0;
    border-radius: 9px 0 0 9px;
    outline: 0;
    padding: 0 14px;
  }

  > button {
    border: 0;
    border-radius: 0 9px 9px 0;
    background: var(--color-primary);
    color: white;
    cursor: pointer;
    font-weight: 800;
  }
}

.suggest-panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 8px);
  right: 0;
  left: 0;
  display: grid;
  gap: 12px;
  border: 1px solid var(--color-line);
  border-radius: 14px;
  background: white;
  box-shadow: 0 12px 32px rgba(16, 24, 40, 0.16);
  max-height: 70vh;
  overflow-y: auto;
  padding: 12px;
  text-align: left;
}

.suggest-group {
  display: grid;
  gap: 2px;
}

.suggest-title {
  color: var(--color-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 0 8px 4px;
  text-transform: uppercase;
}

.suggest-product {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  border-radius: 10px;
  color: #101828;
  padding: 6px 8px;
  text-decoration: none;

  img,
  .no-image {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: #f2f4f7;
    object-fit: contain;
  }

  strong {
    font-size: 13px;
    white-space: nowrap;
  }

  &:hover {
    background: #f8fafc;
  }
}

.suggest-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggest-link {
  border-radius: 10px;
  color: #344054;
  font-size: 14px;
  font-weight: 600;
  padding: 7px 8px;
  text-decoration: none;

  &:hover {
    background: #f8fafc;
    color: var(--color-primary);
  }
}

.suggest-all {
  border: 0;
  border-radius: 10px;
  background: #eef4ff;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  padding: 9px;
  text-align: center;
}

.cart-button {
  position: relative;
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  border-radius: 12px;
  background: #ffcf26;
  color: #101828;
  font-weight: 900;
  padding: 0 16px;
  text-decoration: none;
}

.cart-icon {
  font-size: 18px;
}

.cart-label {
  display: none;

  @include media-breakpoint-up(md) {
    display: inline;
  }
}

.cart-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  display: inline-flex;
  min-width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--color-primary);
  color: white;
  font-size: 12px;
  font-weight: 900;
  padding: 0 6px;
}

.nav-row {
  display: flex;
  gap: 4px;
  width: min(1280px, calc(100% - 32px));
  margin: 0 auto;
  overflow-x: auto;
  padding: 0 0 10px;
}

.nav-link {
  flex: 0 0 auto;
  border-radius: 999px;
  color: var(--color-muted);
  font-weight: 700;
  padding: 8px 12px;
  text-decoration: none;

  &.active,
  &:hover {
    background: #eef4ff;
    color: var(--color-primary);
  }
}

@media (max-width: 520px) {
  .brand small {
    display: none;
  }
}
</style>
