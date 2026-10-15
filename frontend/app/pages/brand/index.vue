<script setup lang="ts">
import type { Brand } from '~/types/api'

const route = useRoute()
const router = useRouter()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

/**
 * `/brands` answers every brand with every column (`description`, `seoTitle`,
 * `seoDescription` …), and whatever `useAsyncData` returns is serialised into
 * the page. The list draws four fields, so only those are kept — and only
 * brands that have something to show: a tile reading «0 товаров» is a link
 * to an empty page (the same rule as categories).
 *
 * The timeout bounds SSR: without one a backend that accepts the connection
 * and never answers holds the render (and its memory) open indefinitely. A
 * timed-out fetch counts as «API unavailable» → the 503 technical-works page.
 */
const { data: brands, status, error } = await useAsyncData<Brand[]>(
  'brand-list',
  () => $fetch<Brand[]>(`${apiBase}/brands`, { timeout: 15_000 }),
  {
    default: () => [],
    transform: list => (Array.isArray(list) ? list : [])
      .filter(brand => brand?.name && (brand._count?.products ?? 0) > 0)
      .map(brand => ({
        id: brand.id,
        name: brand.name,
        slug: brand.slug ?? null,
        logo: brand.logo ?? null,
        _count: { products: brand._count?.products ?? 0 },
      })),
  }
)

// An empty list and an unreachable API look the same on this page otherwise.
if (import.meta.server && isApiUnavailable(error.value)) throw apiUnavailableError()

/** The filter lives in the query so a filtered list stays shareable. */
const search = computed(() => {
  const raw = Array.isArray(route.query.search) ? route.query.search[0] : route.query.search
  return String(raw || '')
})
const searchInput = ref(search.value)
watch(search, value => { searchInput.value = value })

function applySearch(value: string) {
  const query = { ...route.query }
  if (value.trim()) query.search = value.trim()
  else delete query.search
  router.replace({ query })
}

const sortedBrands = computed(() =>
  [...brands.value].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
)

const filteredBrands = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return sortedBrands.value
  return sortedBrands.value.filter(brand => brand.name.toLowerCase().includes(query))
})

const totalProducts = computed(() =>
  sortedBrands.value.reduce((sum, brand) => sum + (brand._count?.products || 0), 0)
)

function brandLink(brand: Brand) {
  return `/brand/${brand.slug || brand.id}/`
}

const description
  = 'Все бренды инструмента и оборудования в каталоге Мультитул — категории и товары каждого производителя.'
const canonical = computed(
  () => `${String(config.public.siteUrl).replace(/\/$/, '')}/brand`
)

useSeoMeta({
  title: 'Бренды | Мультитул',
  description,
  ogTitle: 'Бренды | Мультитул',
  ogDescription: description,
  ogType: 'website',
  ogUrl: () => canonical.value,
})

useHead({ link: [{ rel: 'canonical', href: canonical.value }] })
</script>

<template>
  <div class="brands-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Бренды' }]" />

    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Бренды</span>
        <h1>Все бренды в каталоге</h1>
        <p>{{ description }}</p>
      </div>
      <div class="hero-stat">
        <strong>{{ sortedBrands.length }}</strong>
        <span>брендов</span>
      </div>
    </section>

    <div class="toolbar">
      <label class="sr-only" for="brand-search">Поиск по названию бренда</label>
      <UiInput
        id="brand-search"
        v-model="searchInput"
        class="toolbar-search"
        type="search"
        size="sm"
        placeholder="Поиск по названию бренда"
        aria-label="Поиск по названию бренда"
        @update:model-value="applySearch(String($event ?? ''))"
      />
      <span class="toolbar-count">
        {{ search ? `Найдено: ${filteredBrands.length}` : `${totalProducts} товаров` }}
      </span>
    </div>

    <div v-if="status === 'pending'" class="grid">
      <UiSkeleton v-for="i in 12" :key="i" height="196px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!sortedBrands.length"
      icon="box"
      title="Бренды пока не добавлены"
      description="Как только товары появятся в каталоге, здесь будут их производители."
    >
      <UiButton to="/catalog">Перейти в каталог</UiButton>
    </UiEmpty>

    <UiEmpty
      v-else-if="!filteredBrands.length"
      icon="search"
      :title="`По запросу «${search}» ничего не нашлось`"
      description="Проверьте написание или сбросьте поиск, чтобы увидеть весь список."
    >
      <UiButton variant="secondary" @click="applySearch('')">Сбросить поиск</UiButton>
    </UiEmpty>

    <section v-else class="grid">
      <NuxtLink
        v-for="brand in filteredBrands"
        :key="brand.id"
        :to="brandLink(brand)"
        class="brand-tile"
      >
        <span class="tile-media">
          <img
            v-if="brand.logo"
            :src="brand.logo"
            :alt="brand.name"
            loading="lazy"
            decoding="async"
          >
          <span v-else class="tile-initial" aria-hidden="true">{{ brand.name.charAt(0) }}</span>
        </span>

        <span class="tile-body">
          <span class="tile-name">{{ brand.name }}</span>
          <span class="tile-count">{{ pluralize(brand._count?.products || 0, 'product') }}</span>
        </span>
      </NuxtLink>
    </section>
  </div>
</template>

<style scoped>
.brands-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-card));
}

.hero-copy {
  display: flex;
  max-width: 60ch;
  flex-direction: column;
  gap: var(--space-2);
}

.hero .eyebrow {
  color: var(--brand);
}

.hero p {
  color: var(--text-muted);
}

.hero-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.hero-stat strong {
  color: var(--brand);
  font-size: var(--text-3xl);
  font-weight: 800;
  line-height: 1;
}

.hero-stat span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.toolbar-search {
  width: 320px;
  max-width: 100%;
}

.toolbar-count {
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: var(--space-4);
}

.brand-tile {
  display: flex;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  text-decoration: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.brand-tile:hover {
  border-color: var(--brand);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

/* Fixed ratio keeps the tiles on a rhythm whether a brand has a logo or not. */
.tile-media {
  display: grid;
  aspect-ratio: 3 / 2;
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  place-items: center;
}

.tile-media img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  mix-blend-mode: var(--image-blend);
}

.tile-initial {
  color: var(--text-subtle);
  font-family: var(--font-heading);
  font-size: var(--text-4xl);
  font-weight: 800;
  line-height: 1;
  text-transform: uppercase;
}

.tile-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
}

.tile-name {
  overflow: hidden;
  color: var(--text-strong);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-count {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

@media (max-width: 640px) {
  .hero {
    padding: var(--space-5);
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-search {
    width: 100%;
  }
}
</style>
