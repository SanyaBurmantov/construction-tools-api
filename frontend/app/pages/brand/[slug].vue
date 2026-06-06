<script setup lang="ts">
type Brand = {
  id: string
  name: string
  slug?: string
}

type BrandCategory = {
  id: string
  name: string
  slug?: string
  count: number
}

type BrandCategoriesResponse = {
  brand: Brand
  categories: BrandCategory[]
}

type ProductResponse = {
  data: Array<{
    categoryId?: string | null
    category?: {
      id: string
      name: string
      slug?: string
    } | null
  }>
}

const route = useRoute()
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const slug = computed(() => String(route.params.slug || ''))

const emptyResponse: BrandCategoriesResponse = {
  brand: { id: '', name: '' },
  categories: []
}

const { data: brandData, pending, error } = await useAsyncData<BrandCategoriesResponse | null>(
  () => `brand-categories-${slug.value}`,
  async () => {
    const directResponse = await $fetch<BrandCategoriesResponse | null>(`${apiBase}/brands/${slug.value}/categories`).catch(() => null)

    if (directResponse?.brand) {
      return directResponse
    }

    const brands = await $fetch<Brand[]>(`${apiBase}/brands`).catch(() => [])
    const currentBrand = brands.find(item => item.id === slug.value || item.slug === slug.value)

    if (!currentBrand) {
      return null
    }

    const products = await $fetch<ProductResponse>(`${apiBase}/products`, {
      params: {
        brandId: currentBrand.id,
        limit: 1000,
        page: 1
      }
    }).catch(() => ({ data: [] }))

    const categoriesMap = (products.data || []).reduce<Record<string, BrandCategory>>((acc, product) => {
      if (!product.categoryId || !product.category?.name) {
        return acc
      }

      if (!acc[product.categoryId]) {
        acc[product.categoryId] = {
          id: product.category.id,
          name: product.category.name,
          slug: product.category.slug,
          count: 0
        }
      }

      acc[product.categoryId].count += 1
      return acc
    }, {})

    return {
      brand: currentBrand,
      categories: Object.values(categoriesMap)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
    }
  },
  { default: () => null, watch: [slug] }
)

const brand = computed(() => brandData.value?.brand || null)
const categories = computed(() => brandData.value?.categories || emptyResponse.categories)
const totalProducts = computed(() => categories.value.reduce((sum, category) => sum + category.count, 0))

function categoryLink(categoryId: string) {
  if (!brand.value?.id) return '/catalog/'
  return `/catalog/?brandId=${brand.value.id}&categoryId=${categoryId}`
}

useHead(() => ({
  title: brand.value ? `${brand.value.name} | Категории бренда` : 'Бренд | Мультитул',
  meta: [
    {
      name: 'description',
      content: brand.value
        ? `Категории и товары бренда ${brand.value.name} в каталоге Мультитул.`
        : 'Категории бренда в каталоге Мультитул.'
    }
  ]
}))
</script>

<template>
  <nav class="breadcrumbs" aria-label="Хлебные крошки">
    <NuxtLink to="/">Главная</NuxtLink>
    <span>/</span>
    <NuxtLink to="/brand/">Бренды</NuxtLink>

    11111111111111111111111111111111111
    <span v-if="brand">/</span>
    <strong v-if="brand">{{ brand.name }}</strong>
  </nav>

  <NuxtLink to="/brand/" class="back-link">Все бренды</NuxtLink>

  <div v-if="pending" class="state-card">Загружаем данные бренда...</div>
  <div v-else-if="error" class="state-card error">
    Ошибка: {{ error.message }}
  </div>
  <div v-else-if="!brand" class="state-card error">
    Бренд не найден.
  </div>
  <article v-else class="brand-page">
    <header class="brand-head">
      <div>
        <span class="eyebrow">Бренд</span>
        <h1>{{ brand.name }}</h1>
        <p>
          Выберите категорию, чтобы открыть каталог с товарами этого бренда.
        </p>
      </div>

      <div class="brand-badge">
        <strong>{{ categories.length }}</strong>
        <span>категорий</span>
      </div>
    </header>

    <section v-if="categories.length" class="brand-summary">
      <div class="summary-card accent">
        <strong>{{ totalProducts }}</strong>
        <span>товаров в категориях</span>
      </div>
      <div class="summary-card">
        <strong>{{ categories[0]?.name }}</strong>
        <span>самая заметная категория</span>
      </div>
    </section>

    <div v-if="!categories.length" class="state-card">
      У этого бренда пока нет товаров с категорией.
    </div>

    <section v-else class="categories-grid">
      <NuxtLink
        v-for="category in categories"
        :key="category.id"
        :to="categoryLink(category.id)"
        class="category-card"
      >
        <div class="category-card-glow" />

        <div class="category-card-label">
          <span>Категория</span>
          <strong>{{ category.count }}</strong>
        </div>

        <div class="category-card-top">
          <span class="category-mark">{{ category.name.charAt(0) }}</span>
          <div>
            <h2>{{ category.name }}</h2>
            <small>Товары бренда в этой категории</small>
          </div>
        </div>

        <p>
          Открыть каталог с уже выбранным брендом и перейти сразу к товарам в этой категории.
        </p>

        <div class="category-card-footer">
          <span>{{ category.count }} товаров</span>
          <i aria-hidden="true">↗</i>
        </div>
      </NuxtLink>
    </section>
  </article>
</template>

<style scoped lang="scss">
.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--color-muted);
  font-size: 14px;
  font-weight: 800;

  a,
  strong {
    color: inherit;
    text-decoration: none;
  }
}

.back-link {
  display: inline-flex;
  margin-bottom: 16px;
  color: var(--color-muted);
  font-weight: 900;
  text-decoration: none;
}

.brand-page {
  display: grid;
  gap: 20px;
}

.brand-head {
  display: grid;
  gap: 20px;
  align-items: end;
  border: 2px solid var(--color-ink);
  border-radius: 32px;
  background:
    radial-gradient(circle at top right, rgba(222, 77, 47, 0.18), transparent 30%),
    linear-gradient(135deg, rgba(255, 250, 240, 0.98), rgba(222, 77, 47, 0.1));
  box-shadow: 10px 10px 0 var(--color-ink);
  padding: clamp(20px, 4vw, 36px);

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  h1 {
    margin: 8px 0 12px;
    font-size: clamp(30px, 5vw, 54px);
    line-height: 0.95;
  }

  p {
    color: var(--color-muted);
    margin: 0;
  }
}

.brand-badge {
  display: inline-grid;
  gap: 4px;
  min-width: 150px;
  padding: 18px 20px;
  border: 2px solid var(--color-ink);
  border-radius: 24px;
  background: rgba(255, 250, 240, 0.86);
  box-shadow: 6px 6px 0 var(--color-ink);

  strong {
    font-size: clamp(26px, 4vw, 40px);
    line-height: 1;
  }

  span {
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
}

.brand-summary {
  display: grid;
  gap: 14px;

  @include media-breakpoint-up(md) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.summary-card {
  display: grid;
  gap: 6px;
  padding: 18px 20px;
  border: 2px solid var(--color-ink);
  border-radius: 24px;
  background: rgba(255, 250, 240, 0.94);
  box-shadow: 6px 6px 0 var(--color-ink);

  strong {
    font-size: clamp(24px, 4vw, 36px);
    line-height: 1.05;
  }

  span {
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
}

.summary-card.accent {
  background:
    linear-gradient(135deg, rgba(243, 182, 31, 0.24), rgba(255, 250, 240, 0.96));
}

.eyebrow {
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.state-card {
  border: 2px solid var(--color-ink);
  border-radius: 28px;
  background: var(--color-card);
  box-shadow: 8px 8px 0 var(--color-ink);
  color: var(--color-muted);
  font-weight: 800;
  padding: 24px;
}

.state-card.error {
  color: var(--color-accent-strong);
}

.categories-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}

.category-card {
  position: relative;
  overflow: hidden;
  display: grid;
  gap: 14px;
  border: 2px solid var(--color-ink);
  border-radius: 26px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.64), transparent 46%),
    rgba(255, 250, 240, 0.95);
  box-shadow: 8px 8px 0 var(--color-ink);
  color: inherit;
  min-height: 230px;
  padding: 18px;
  text-decoration: none;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;

  h2 {
    font-size: 22px;
    margin: 0;
  }

  p {
    margin: 0;
    color: var(--color-muted);
    line-height: 1.6;
  }

  &:hover {
    transform: translate(-3px, -3px) rotate(-0.35deg);
    box-shadow: 12px 12px 0 var(--color-ink);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.8), transparent 46%),
      rgba(255, 248, 235, 0.98);
  }
}

.category-card-glow {
  position: absolute;
  top: -24px;
  right: -20px;
  width: 100px;
  height: 100px;
  border-radius: 999px;
  background: rgba(222, 77, 47, 0.16);
  filter: blur(6px);
}

.category-card-label {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  padding: 7px 10px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: rgba(255, 250, 240, 0.92);
  box-shadow: 4px 4px 0 var(--color-ink);

  span,
  strong {
    display: block;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  strong {
    color: var(--color-accent-strong);
  }
}

.category-card-top {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;

  small {
    display: block;
    margin-top: 4px;
    color: var(--color-muted);
    font-size: 13px;
    font-weight: 700;
  }
}

.category-mark {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border: 2px solid var(--color-ink);
  border-radius: 18px;
  background: rgba(243, 182, 31, 0.9);
  box-shadow: 5px 5px 0 var(--color-ink);
  font-family: var(--font-heading);
  font-size: 22px;
  font-weight: 900;
  text-transform: uppercase;
}

.category-card-footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed rgba(22, 28, 45, 0.22);

  span {
    color: var(--color-accent-strong);
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  i {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 2px solid var(--color-ink);
    border-radius: 12px;
    background: var(--color-ink);
    color: var(--color-cream);
    font-style: normal;
    font-size: 16px;
    box-shadow: 3px 3px 0 var(--color-accent);
  }
}
</style>
