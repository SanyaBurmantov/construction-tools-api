<script setup lang="ts">
type Brand = {
  id: string
  name: string
  slug?: string
  _count?: { products: number }
}

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase

function routeSearch() {
  const value = route.query.search
  return String((Array.isArray(value) ? value[0] : value) || '')
}

const search = ref(routeSearch())
watch(() => route.query.search, () => { search.value = routeSearch() })

const { data: brands, pending, error } = await useAsyncData<Brand[]>(
  'brand-list',
  () => $fetch<Brand[]>(apiBase + '/brands'),
  { default: () => [] }
)

const sortedBrands = computed(() => [...brands.value].sort((a, b) => a.name.localeCompare(b.name, 'ru')))
const filteredBrands = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('ru')
  return query
    ? sortedBrands.value.filter(brand => brand.name.toLocaleLowerCase('ru').includes(query))
    : sortedBrands.value
})

const groupedBrands = computed(() => filteredBrands.value.reduce<Array<{ letter: string, items: Brand[] }>>(
  (groups, brand) => {
    const letter = brand.name.trim().charAt(0).toLocaleUpperCase('ru') || '#'
    const group = groups.at(-1)
    if (group?.letter === letter) group.items.push(brand)
    else groups.push({ letter, items: [brand] })
    return groups
  },
  []
))

function brandLink(brand: Brand) {
  return '/brand/' + (brand.slug || brand.id) + '/'
}

function productLabel(count: number) {
  const lastTwo = count % 100
  const last = count % 10
  return lastTwo >= 11 && lastTwo <= 14 ? 'товаров' : last === 1 ? 'товар' : last >= 2 && last <= 4 ? 'товара' : 'товаров'
}

useHead({
  title: 'Бренды | Мультитул',
  meta: [{
    name: 'description',
    content: 'Список всех брендов в каталоге Мультитул с переходом к категориям каждого бренда.'
  }]
})
</script>

<template>
  <div class="brands-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Бренды' }]" />

    <header class="brands-hero">
      <div class="hero-copy">
        <span class="eyebrow">Производители</span>
        <h1>Бренды</h1>
        <p>Выберите бренд и посмотрите его товары по категориям.</p>
      </div>
      <div class="hero-stat">
        <strong>{{ sortedBrands.length }}</strong>
        <span>брендов в каталоге</span>
      </div>
    </header>

    <div class="brands-toolbar">
      <div class="search-field">
        <label for="brand-search" class="sr-only">Поиск бренда</label>
        <UiInput id="brand-search" v-model="search" placeholder="Найти бренд">
          <template #leading>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm7.5 14.5L16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </template>
          <template v-if="search" #trailing>
            <button type="button" class="clear-search" aria-label="Очистить поиск" @click="search = ''">✕</button>
          </template>
        </UiInput>
      </div>
      <span class="result-count" aria-live="polite">Найдено: {{ filteredBrands.length }}</span>
    </div>

    <div v-if="pending" class="brands-grid" aria-label="Загружаем бренды">
      <UiSkeleton v-for="i in 8" :key="i" height="108px" radius="var(--radius-lg)" />
    </div>
    <UiAlert v-else-if="error" tone="danger" title="Не удалось загрузить бренды">
      Обновите страницу или попробуйте позже.
    </UiAlert>
    <UiEmpty v-else-if="!sortedBrands.length" title="Брендов пока нет" description="Они появятся здесь, когда в каталоге будут товары производителей." />
    <UiEmpty v-else-if="!filteredBrands.length" icon="search" title="Бренд не найден" description="Попробуйте другое название или очистите поиск.">
      <UiButton variant="secondary" @click="search = ''">Очистить поиск</UiButton>
    </UiEmpty>

    <template v-else>
      <nav class="letter-nav" aria-label="Бренды по алфавиту">
        <a v-for="group in groupedBrands" :key="group.letter" :href="'#brands-' + group.letter">{{ group.letter }}</a>
      </nav>

      <div class="brand-groups">
        <section v-for="group in groupedBrands" :id="'brands-' + group.letter" :key="group.letter" class="brand-group">
          <div class="group-head">
            <h2>{{ group.letter }}</h2>
            <span>{{ group.items.length }} брендов</span>
          </div>

          <div class="brands-grid">
            <NuxtLink v-for="brand in group.items" :key="brand.id" :to="brandLink(brand)" class="brand-card">
              <span class="brand-avatar" aria-hidden="true">{{ brand.name.trim().charAt(0).toLocaleUpperCase('ru') }}</span>
              <span class="brand-card-copy">
                <strong>{{ brand.name }}</strong>
                <small>{{ brand._count?.products || 0 }} {{ productLabel(brand._count?.products || 0) }}</small>
              </span>
              <svg class="card-arrow" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </NuxtLink>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.brands-page,
.brand-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.brands-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-8);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-card) 65%);
  gap: var(--space-6);
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hero-copy p {
  color: var(--text-muted);
}

.hero-stat {
  display: flex;
  min-width: 160px;
  flex-direction: column;
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

.hero-stat span,
.result-count {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.brands-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.search-field {
  width: min(100%, 360px);
}

.search-field svg {
  width: 18px;
  height: 18px;
}

.clear-search {
  padding: var(--space-1);
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.clear-search:hover {
  color: var(--text-strong);
}

.letter-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.letter-nav a {
  display: grid;
  min-width: 36px;
  height: 36px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 700;
  place-items: center;
}

.letter-nav a:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}

.brand-group {
  scroll-margin-top: 160px;
}

.group-head {
  display: flex;
  align-items: center;
  margin-bottom: var(--space-3);
  gap: var(--space-3);
}

.group-head h2 {
  display: grid;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--brand-soft);
  color: var(--brand);
  font-size: var(--text-lg);
  place-items: center;
}

.group-head span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.brands-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-4);
}

.brand-card {
  display: flex;
  min-width: 0;
  min-height: 108px;
  align-items: center;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  gap: var(--space-3);
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.brand-card:hover,
.brand-card:focus-visible {
  border-color: var(--brand);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.brand-avatar {
  display: grid;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--brand-soft);
  color: var(--brand);
  font-size: var(--text-xl);
  font-weight: 800;
  place-items: center;
}

.brand-card-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
}

.brand-card-copy strong {
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand-card-copy small {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.card-arrow {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-subtle);
}

.brand-card:hover .card-arrow {
  color: var(--brand);
}

@media (max-width: 640px) {
  .brands-hero {
    padding: var(--space-5);
  }

  .search-field {
    width: 100%;
  }
}
</style>
