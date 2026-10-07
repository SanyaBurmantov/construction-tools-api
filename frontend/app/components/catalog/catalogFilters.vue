<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type FacetItem = { id: string, name: string, slug?: string, code?: string }
type CategoryLink = { id: string, name: string, slug: string, count: number }
// eslint-disable-next-line no-unused-vars -- parameter name documents the signature
type CategoryTo = (categorySlug: string) => RouteLocationRaw
type SpecFacet = {
  id: string
  name: string
  unit?: string | null
  values: Array<{ value: string, count: number }>
}

/**
 * The filter panel, rendered twice: as a full-height sidebar on desktop and inside
 * a drawer on mobile. Keeping one component means the two can't drift apart.
 *
 * All state lives in the URL (owned by CatalogView), so this is presentational:
 * it renders what it is given and emits intent.
 */
const props = defineProps<{
  category: { name: string } | null
  categoryLinks: CategoryLink[]
  parentLink: { to: RouteLocationRaw, label: string } | null
  categoryTo: CategoryTo
  inStock: boolean
  onSale: boolean
  priceRange: { min: number, max: number } | null
  brands: FacetItem[]
  visibleBrands: FacetItem[]
  brandCounts: Record<string, number>
  selectedBrandIds: string[]
  sources: FacetItem[]
  sourceCounts: Record<string, number>
  selectedSource: string
  activeFiltersCount: number
  specFacets: SpecFacet[]
  selectedSpecs: Record<string, string[]>
}>()

const emit = defineEmits<{
  pushQuery: [Record<string, string | undefined>]
  toggleBrand: [string]
  toggleSource: [string | undefined]
  applyPrice: []
  toggleSpec: [string, string]
  clearSpec: [string]
  clear: []
}>()

/**
 * Long value lists are collapsed to the first few options. Supplier feeds
 * produce dozens of near-duplicate values, and an unbounded list would push
 * every other filter off the screen.
 */
const VALUES_COLLAPSED = 5
const expanded = ref<Set<string>>(new Set())

function toggleExpanded(groupId: string) {
  const next = new Set(expanded.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  expanded.value = next
}

function visibleItems<T>(items: T[], groupId: string): T[] {
  return expanded.value.has(groupId) ? items : items.slice(0, VALUES_COLLAPSED)
}

const brandQuery = defineModel<string>('brandQuery', { default: '' })

function collapse(groupId: string) {
  const next = new Set(expanded.value)
  next.delete(groupId)
  expanded.value = next
}

watch(() => props.categoryLinks, () => collapse('categories'))
watch(brandQuery, () => collapse('brands'))
// Two-way: the draft price inputs are edited here and applied by the parent
// on submit, so they can't be plain props.
const priceMin = defineModel<string>('priceMin', { default: '' })
const priceMax = defineModel<string>('priceMax', { default: '' })
</script>

<template>
  <div class="filters">
    <header v-if="activeFiltersCount" class="filters-head">
      <span>Фильтров: {{ activeFiltersCount }}</span>
      <UiButton variant="link" size="sm" @click="emit('clear')">Сбросить</UiButton>
    </header>

    <section class="group">
      <h3>Категории</h3>
      <NuxtLink v-if="parentLink" :to="parentLink.to" class="parent">
        ← {{ parentLink.label }}
      </NuxtLink>
      <div v-if="categoryLinks.length" class="links">
        <NuxtLink
          v-for="item in visibleItems(categoryLinks, 'categories')"
          :key="item.id"
          :to="categoryTo(item.slug)"
          class="link"
        >
          <span>{{ item.name }}</span>
          <small>{{ item.count }}</small>
        </NuxtLink>
      </div>
      <p v-else-if="category" class="empty">Это конечная категория.</p>
      <button
        v-if="categoryLinks.length > VALUES_COLLAPSED"
        type="button"
        class="more"
        :aria-expanded="expanded.has('categories')"
        @click="toggleExpanded('categories')"
      >
        {{ expanded.has('categories') ? 'Свернуть' : `Ещё ${categoryLinks.length - VALUES_COLLAPSED}` }}
      </button>
    </section>

    <section class="group">
      <UiCheckbox
        :model-value="inStock"
        label="Только в наличии"
        @update:model-value="emit('pushQuery', { inStock: inStock ? undefined : '1' })"
      />
      <UiCheckbox
        :model-value="onSale"
        label="Только со скидкой"
        @update:model-value="emit('pushQuery', { onSale: onSale ? undefined : '1' })"
      />
    </section>

    <section class="group">
      <h3>Цена, BYN</h3>
      <form class="price" @submit.prevent="emit('applyPrice')">
        <UiInput
          v-model="priceMin"
          type="number"
          size="sm"
          min="0"
          :placeholder="priceRange ? String(priceRange.min) : 'от'"
          aria-label="Цена от"
        />
        <span class="dash" aria-hidden="true">—</span>
        <UiInput
          v-model="priceMax"
          type="number"
          size="sm"
          min="0"
          :placeholder="priceRange ? String(priceRange.max) : 'до'"
          aria-label="Цена до"
        />
        <UiButton type="submit" variant="secondary" size="sm">OK</UiButton>
      </form>
    </section>

    <section v-if="brands.length" class="group">
      <h3>
        Бренды
        <small v-if="selectedBrandIds.length">{{ selectedBrandIds.length }}</small>
      </h3>
      <UiInput
        v-if="brands.length > 8"
        v-model="brandQuery"
        type="search"
        size="sm"
        placeholder="Найти бренд"
      />
      <div class="checks">
        <UiCheckbox
          v-for="brand in visibleItems(visibleBrands, 'brands')"
          :key="brand.id"
          :model-value="selectedBrandIds.includes(brand.id)"
          :label="brand.name"
          :count="brandCounts[brand.id] || 0"
          @update:model-value="emit('toggleBrand', brand.id)"
        />
        <p v-if="!visibleBrands.length" class="empty">Нет брендов по запросу.</p>
      </div>
      <button
        v-if="visibleBrands.length > VALUES_COLLAPSED"
        type="button"
        class="more"
        :aria-expanded="expanded.has('brands')"
        @click="toggleExpanded('brands')"
      >
        {{ expanded.has('brands') ? 'Свернуть' : `Ещё ${visibleBrands.length - VALUES_COLLAPSED}` }}
      </button>
    </section>

    <section v-for="spec in specFacets" :key="spec.id" class="group">
      <h3>
        {{ spec.name }}<template v-if="spec.unit">, {{ spec.unit }}</template>
        <button
          v-if="selectedSpecs[spec.id]?.length"
          type="button"
          class="reset"
          @click="emit('clearSpec', spec.id)"
        >
          сбросить
        </button>
      </h3>
      <div class="checks">
        <UiCheckbox
          v-for="item in visibleItems(spec.values, `spec:${spec.id}`)"
          :key="item.value"
          :model-value="selectedSpecs[spec.id]?.includes(item.value) ?? false"
          :label="item.value"
          :count="item.count"
          @update:model-value="emit('toggleSpec', spec.id, item.value)"
        />
      </div>
      <button
        v-if="spec.values.length > VALUES_COLLAPSED"
        type="button"
        class="more"
        :aria-expanded="expanded.has(`spec:${spec.id}`)"
        @click="toggleExpanded(`spec:${spec.id}`)"
      >
        {{ expanded.has(`spec:${spec.id}`) ? 'Свернуть' : `Ещё ${spec.values.length - VALUES_COLLAPSED}` }}
      </button>
    </section>

    <section v-if="sources.length > 1" class="group">
      <h3>Поставщики</h3>
      <div class="links">
        <button
          v-for="source in visibleItems(sources, 'sources')"
          :key="source.id"
          type="button"
          class="link"
          :class="{ 'is-active': selectedSource === source.code }"
          :aria-pressed="selectedSource === source.code"
          :disabled="!source.code"
          @click="emit('toggleSource', source.code)"
        >
          <span>{{ source.name }}</span>
          <small>{{ sourceCounts[source.id] || 0 }}</small>
        </button>
      </div>
      <button
        v-if="sources.length > VALUES_COLLAPSED"
        type="button"
        class="more"
        :aria-expanded="expanded.has('sources')"
        @click="toggleExpanded('sources')"
      >
        {{ expanded.has('sources') ? 'Свернуть' : `Ещё ${sources.length - VALUES_COLLAPSED}` }}
      </button>
    </section>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.filters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.group h3 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.group h3 small {
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--brand-soft);
  color: var(--brand-soft-text);
  font-size: 11px;
}

.parent {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.parent:hover {
  color: var(--text-link);
}

.links,
.checks {
  display: flex;
  flex-direction: column;
}

.link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-1) 0;
  color: var(--text-default);
  font-size: var(--text-sm);
  gap: var(--space-2);
  text-align: left;
}

.link:hover {
  color: var(--text-link);
}

.link.is-active {
  color: var(--brand);
  font-weight: 700;
}

.link small {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.link:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.price {
  display: grid;
  align-items: center;
  gap: var(--space-2);
  grid-template-columns: 1fr auto 1fr auto;
}

.dash {
  color: var(--text-subtle);
}

.empty {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.reset {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  font-weight: 500;
}

.reset:hover {
  color: var(--danger);
}

.more {
  align-self: flex-start;
  color: var(--text-link);
  font-size: var(--text-xs);
  font-weight: 600;
}

.more:hover {
  text-decoration: underline;
}
</style>
