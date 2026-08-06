<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { useWishlistStore } from '~/stores/wishlist'
import { useCompareStore } from '~/stores/compare'
import { company } from '~/data/company'

type CategoryTreeNode = {
  id: string
  name: string
  slug: string
  productCount: number
  children: CategoryTreeNode[]
}

type SuggestProduct = {
  id: string
  name: string
  slug: string
  sku?: string | null
  priceValue?: number | null
  priceCurrency?: string | null
  image?: string | null
}
type SuggestLink = { id: string, name: string, slug: string }
type SuggestResponse = {
  products: SuggestProduct[]
  categories: SuggestLink[]
  brands: SuggestLink[]
}

const NAV_CATEGORY_LIMIT = 7

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

const cart = useCartStore()
const wishlist = useWishlistStore()
const compare = useCompareStore()
const { formatPrice } = useFormatPrice()

const { data: tree } = await useAsyncData<CategoryTreeNode[]>(
  'catalog-tree',
  () => $fetch<CategoryTreeNode[]>(`${apiBase}/categories/tree`).catch(() => []),
  { default: () => [] }
)

const topCategories = computed(() => (tree.value || []).slice(0, NAV_CATEGORY_LIMIT))

const navLinks = computed(() => [
  { label: 'Каталог', to: '/catalog/' },
  { label: 'Акции', to: '/sales' },
  { label: 'Бренды', to: '/brand/' },
  { label: 'Доставка', to: '/delivery' },
  { label: 'Контакты', to: '/contacts' },
])

/* ---- Search + live suggestions ---------------------------------------- */
const search = ref('')
const suggest = ref<SuggestResponse | null>(null)
const suggestOpen = ref(false)
const searchForm = ref<HTMLElement | null>(null)
let suggestTimer: ReturnType<typeof setTimeout> | undefined

const hasSuggestions = computed(() =>
  Boolean(
    suggest.value
    && (suggest.value.products.length
      || suggest.value.categories.length
      || suggest.value.brands.length)
  )
)

function closeSuggest() {
  suggestOpen.value = false
}

function submitSearch() {
  const query = search.value.trim()
  closeSuggest()
  navigateTo({ path: '/catalog/', query: query ? { search: query } : undefined })
}

watch(search, (value) => {
  if (suggestTimer) clearTimeout(suggestTimer)
  const query = value.trim()
  if (query.length < 2) {
    suggest.value = null
    suggestOpen.value = false
    return
  }
  suggestTimer = setTimeout(async () => {
    try {
      const result = await $fetch<SuggestResponse>(
        `${config.public.apiBase}/products/suggest`,
        { params: { q: query } }
      )
      // The response may be stale if the user kept typing.
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
  if (searchForm.value && !searchForm.value.contains(event.target as Node)) {
    closeSuggest()
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  if (suggestTimer) clearTimeout(suggestTimer)
})

/* ---- Menus ------------------------------------------------------------- */
const mobileNavOpen = ref(false)
const catalogOpen = ref(false)

// Any navigation closes whatever is open.
watch(() => route.fullPath, () => {
  mobileNavOpen.value = false
  catalogOpen.value = false
  closeSuggest()
})
</script>

<template>
  <header class="site-header">
    <div class="topbar">
      <div class="container topbar-inner">
        <span class="topbar-note">Каталог инструмента от поставщиков — обновляется ежедневно</span>
        <div class="topbar-links">
          <a :href="company.phoneHref" class="phone">{{ company.phone }}</a>
          <NuxtLink to="/delivery">Доставка и оплата</NuxtLink>
          <NuxtLink to="/contacts">Контакты</NuxtLink>
        </div>
      </div>
    </div>

    <div class="mainbar">
      <div class="container mainbar-inner">
        <button
          type="button"
          class="burger"
          aria-label="Меню"
          :aria-expanded="mobileNavOpen"
          @click="mobileNavOpen = true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>

        <NuxtLink to="/" class="logo" aria-label="Мультитул — на главную">
          <BrandLogo />
        </NuxtLink>

        <UiButton
          class="catalog-trigger"
          variant="primary"
          :aria-expanded="catalogOpen"
          @click="catalogOpen = !catalogOpen"
        >
          <template #leading>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </template>
          Каталог
        </UiButton>

        <div ref="searchForm" class="search">
          <form role="search" @submit.prevent="submitSearch">
            <UiInput
              v-model="search"
              type="search"
              placeholder="Поиск по названию, бренду или артикулу"
              size="lg"
              aria-label="Поиск по каталогу"
              @focus="suggestOpen = hasSuggestions"
            >
              <template #leading>
                <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              </template>
              <template #trailing>
                <button type="submit" class="search-submit">Найти</button>
              </template>
            </UiInput>
          </form>

          <Transition name="fade">
            <div v-if="suggestOpen && hasSuggestions" class="suggest">
              <div v-if="suggest?.products.length" class="suggest-group">
                <p class="suggest-title">Товары</p>
                <NuxtLink
                  v-for="item in suggest.products"
                  :key="item.id"
                  :to="`/product/${item.slug}`"
                  class="suggest-product"
                  @click="closeSuggest"
                >
                  <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy">
                  <span v-else class="suggest-thumb" aria-hidden="true" />
                  <span class="suggest-body">
                    <span class="suggest-name">{{ item.name }}</span>
                    <span v-if="item.sku" class="suggest-sku">Арт. {{ item.sku }}</span>
                  </span>
                  <span class="suggest-price">
                    {{ formatPrice(item.priceValue, item.priceCurrency) }}
                  </span>
                </NuxtLink>
              </div>

              <div v-if="suggest?.categories.length" class="suggest-group">
                <p class="suggest-title">Категории</p>
                <div class="suggest-chips">
                  <NuxtLink
                    v-for="item in suggest.categories"
                    :key="item.id"
                    :to="`/catalog/${item.slug}`"
                    @click="closeSuggest"
                  >
                    {{ item.name }}
                  </NuxtLink>
                </div>
              </div>

              <div v-if="suggest?.brands.length" class="suggest-group">
                <p class="suggest-title">Бренды</p>
                <div class="suggest-chips">
                  <NuxtLink
                    v-for="item in suggest.brands"
                    :key="item.id"
                    :to="`/brand/${item.slug}`"
                    @click="closeSuggest"
                  >
                    {{ item.name }}
                  </NuxtLink>
                </div>
              </div>

              <button type="button" class="suggest-all" @click="submitSearch">
                Показать все результаты
              </button>
            </div>
          </Transition>
        </div>

        <nav class="actions" aria-label="Избранное, сравнение и корзина">
          <NuxtLink to="/compare" class="action" :class="{ 'is-active': compare.count }">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 20V9m6 11V4m6 16v-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
            <span class="action-label">Сравнение</span>
            <ClientOnly>
              <span v-if="compare.count" class="counter">{{ compare.count }}</span>
            </ClientOnly>
          </NuxtLink>

          <NuxtLink to="/favorites" class="action" :class="{ 'is-active': wishlist.count }">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20s-7-4.5-7-9.5A3.5 3.5 0 0 1 12 8a3.5 3.5 0 0 1 7 2.5C19 15.5 12 20 12 20z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
            </svg>
            <span class="action-label">Избранное</span>
            <ClientOnly>
              <span v-if="wishlist.count" class="counter">{{ wishlist.count }}</span>
            </ClientOnly>
          </NuxtLink>

          <NuxtLink to="/cart" class="action" :class="{ 'is-active': cart.count }">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16H17a2 2 0 0 0 1.95-1.55L20.5 8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="action-label">
              <ClientOnly>
                <template #fallback>Корзина</template>
                <template v-if="cart.count">{{ formatPrice(cart.totalPrice, cart.currency) }}</template>
                <template v-else>Корзина</template>
              </ClientOnly>
            </span>
            <ClientOnly>
              <span v-if="cart.count" class="counter">{{ cart.count }}</span>
            </ClientOnly>
          </NuxtLink>
        </nav>
      </div>
    </div>

    <nav class="navbar" aria-label="Основная навигация">
      <UiScroller class="container navbar-inner" label="Категории каталога">
        <NuxtLink
          v-for="category in topCategories"
          :key="category.id"
          :to="`/catalog/${category.slug}`"
          class="nav-link"
        >
          {{ category.name }}
        </NuxtLink>
        <NuxtLink to="/sales" class="nav-link is-sale">Акции</NuxtLink>
      </UiScroller>
    </nav>

    <!-- Catalog mega menu -->
    <Transition name="fade">
      <div v-if="catalogOpen" class="mega" @click.self="catalogOpen = false">
        <div class="container mega-inner">
          <div v-if="!topCategories.length" class="mega-empty">
            Каталог пока пуст.
          </div>
          <div v-else class="mega-grid">
            <div v-for="category in tree" :key="category.id" class="mega-column">
              <NuxtLink :to="`/catalog/${category.slug}`" class="mega-title">
                {{ category.name }}
                <span>{{ category.productCount }}</span>
              </NuxtLink>
              <NuxtLink
                v-for="child in category.children.slice(0, 6)"
                :key="child.id"
                :to="`/catalog/${child.slug}`"
                class="mega-link"
              >
                {{ child.name }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Mobile navigation -->
    <UiDrawer v-model:open="mobileNavOpen" title="Меню">
      <div class="mobile-nav">
        <NuxtLink v-for="link in navLinks" :key="link.to" :to="link.to" class="mobile-link">
          {{ link.label }}
        </NuxtLink>

        <p class="mobile-heading">Категории</p>
        <NuxtLink
          v-for="category in tree"
          :key="category.id"
          :to="`/catalog/${category.slug}`"
          class="mobile-link is-sub"
        >
          {{ category.name }}
          <span>{{ category.productCount }}</span>
        </NuxtLink>

        <a :href="company.phoneHref" class="mobile-phone">{{ company.phone }}</a>
      </div>
    </UiDrawer>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  z-index: var(--z-header);
  top: 0;
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-subtle);
}

.icon {
  width: 18px;
  height: 18px;
}

/* ---- Top bar ---- */
.topbar {
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  font-size: var(--text-xs);
}

.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  gap: var(--space-4);
}

.topbar-note {
  color: var(--text-muted);
}

.topbar-links {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--text-muted);
}

.topbar-links a:hover {
  color: var(--text-link);
}

.phone {
  color: var(--text-strong);
  font-weight: 700;
}

/* ---- Main bar ---- */
.mainbar-inner {
  display: flex;
  align-items: center;
  min-height: var(--header-height);
  gap: var(--space-4);
}

.burger {
  display: none;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  color: var(--text-strong);
  place-items: center;
}

.burger svg {
  width: 22px;
  height: 22px;
}

.logo {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: var(--space-2);
}


.catalog-trigger {
  flex-shrink: 0;
}

/* ---- Search ---- */
.search {
  position: relative;
  flex: 1;
  min-width: 0;
}

.search-submit {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.search-submit:hover {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}

.suggest {
  position: absolute;
  z-index: var(--z-dropdown);
  top: calc(100% + var(--space-2));
  right: 0;
  left: 0;
  max-height: min(70vh, 560px);
  overflow-y: auto;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  box-shadow: var(--shadow-lg);
}

.suggest-group + .suggest-group {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.suggest-title {
  margin-bottom: var(--space-2);
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.suggest-product {
  display: flex;
  align-items: center;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  gap: var(--space-3);
}

.suggest-product:hover {
  background: var(--surface-hover);
}

.suggest-product img,
.suggest-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.suggest-body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.suggest-name {
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggest-sku {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.suggest-price {
  flex-shrink: 0;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.suggest-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.suggest-chips a {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  color: var(--text-default);
  font-size: var(--text-sm);
}

.suggest-chips a:hover {
  background: var(--brand-soft);
  color: var(--brand-soft-text);
}

.suggest-all {
  width: 100%;
  padding: var(--space-3);
  margin-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 700;
}

/* ---- Actions ---- */
.actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-1);
}

.action {
  position: relative;
  display: flex;
  min-width: 62px;
  flex-direction: column;
  align-items: center;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  gap: 2px;
  transition: color var(--duration-fast) var(--ease-out);
}

.action:hover,
.action.is-active {
  color: var(--brand);
}

.action svg {
  width: 22px;
  height: 22px;
}

.action-label {
  font-size: 11px;
  font-weight: 600;
}

.counter {
  position: absolute;
  top: 0;
  right: 8px;
  display: grid;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--sale);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  place-items: center;
}

/* ---- Nav bar ---- */
.navbar {
  border-top: 1px solid var(--border-subtle);
}

.navbar-inner :deep(.viewport) {
  gap: var(--space-1);
}

.nav-link {
  padding: var(--space-3) var(--space-3);
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 600;
  white-space: nowrap;
  transition: color var(--duration-fast) var(--ease-out);
}

.nav-link:hover,
.nav-link.router-link-active {
  border-bottom-color: var(--brand);
  color: var(--text-strong);
}

.nav-link.is-sale {
  color: var(--sale);
  font-weight: 700;
}

/* ---- Mega menu ---- */
.mega {
  position: absolute;
  z-index: var(--z-dropdown);
  top: 100%;
  right: 0;
  left: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-card);
  box-shadow: var(--shadow-lg);
}

.mega-inner {
  max-height: 70vh;
  overflow-y: auto;
  padding: var(--space-6) 0;
}

.mega-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-6);
}

.mega-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
  color: var(--text-strong);
  font-weight: 700;
  gap: var(--space-2);
}

.mega-title span {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 600;
}

.mega-title:hover {
  color: var(--text-link);
}

.mega-link {
  display: block;
  padding: 3px 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.mega-link:hover {
  color: var(--text-link);
}

.mega-empty {
  padding: var(--space-8);
  color: var(--text-muted);
  text-align: center;
}

/* ---- Mobile drawer ---- */
.mobile-nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.mobile-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-strong);
  font-weight: 600;
}

.mobile-link:hover {
  background: var(--surface-hover);
}

.mobile-link.is-sub {
  color: var(--text-muted);
  font-weight: 500;
}

.mobile-link span {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.mobile-heading {
  padding: var(--space-4) var(--space-3) var(--space-2);
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mobile-phone {
  padding: var(--space-4) var(--space-3);
  color: var(--brand);
  font-size: var(--text-lg);
  font-weight: 800;
}

/* ---- Transitions ---- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-fast) var(--ease-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---- Responsive ---- */
@media (max-width: 1080px) {
  .action-label {
    display: none;
  }

  .action {
    min-width: 44px;
  }
}

@media (max-width: 960px) {
  .topbar,
  .navbar,
  .catalog-trigger {
    display: none;
  }

  .burger {
    display: grid;
  }

  .mainbar-inner {
    flex-wrap: wrap;
    padding: var(--space-3) 0;
    gap: var(--space-3);
  }

  .search {
    order: 3;
    flex-basis: 100%;
  }

  .logo {
    margin-right: auto;
  }
}

@media (max-width: 480px) {
  .search-submit {
    display: none;
  }
}
</style>
