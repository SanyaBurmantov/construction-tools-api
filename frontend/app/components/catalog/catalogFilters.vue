<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type FacetItem = { id: string, name: string, slug?: string, code?: string }
type CategoryLink = { id: string, name: string, slug: string, count: number }
// eslint-disable-next-line no-unused-vars -- parameter name documents the signature
type CategoryTo = (categorySlug: string) => RouteLocationRaw

/**
 * The filter panel, rendered twice: as a sticky sidebar on desktop and inside
 * a drawer on mobile. Keeping one component means the two can't drift apart.
 *
 * All state lives in the URL (owned by CatalogView), so this is presentational:
 * it renders what it is given and emits intent.
 */
defineProps<{
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
}>()

const emit = defineEmits<{
  pushQuery: [Record<string, string | undefined>]
  toggleBrand: [string]
  toggleSource: [string | undefined]
  applyPrice: []
  clear: []
}>()

const brandQuery = defineModel<string>('brandQuery', { default: '' })
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
          v-for="item in categoryLinks"
          :key="item.id"
          :to="categoryTo(item.slug)"
          class="link"
        >
          <span>{{ item.name }}</span>
          <small>{{ item.count }}</small>
        </NuxtLink>
      </div>
      <p v-else-if="category" class="empty">Это конечная категория.</p>
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
          v-for="brand in visibleBrands"
          :key="brand.id"
          :model-value="selectedBrandIds.includes(brand.id)"
          :label="brand.name"
          :count="brandCounts[brand.id] || 0"
          @update:model-value="emit('toggleBrand', brand.id)"
        />
        <p v-if="!visibleBrands.length" class="empty">Нет брендов по запросу.</p>
      </div>
    </section>

    <section v-if="sources.length > 1" class="group">
      <h3>Поставщики</h3>
      <div class="links">
        <button
          v-for="source in sources"
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
  max-height: 260px;
  flex-direction: column;
  overflow-y: auto;
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
</style>
