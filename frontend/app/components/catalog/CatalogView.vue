<script setup lang="ts">
import type { CatalogProductsResponse, CategoryPage, FacetItem, SpecFacet } from '~/types/api'
import { toCardProduct } from '~/composables/useProductActions'

const props = defineProps<{ categorySlug?: string }>()
const { priceListUrl } = useB2b()
const { formatPrice } = useFormatPrice()

const PAGE_SIZE = 24
/**
 * Cards whose photo loads eagerly. `.product-grid` has 228px tracks, so the
 * widest common layout fits four per row — enough to cover what is actually
 * above the fold without pulling the whole page in at once.
 */
const LCP_CARD_COUNT = 4
// 'default' не шлёт sortBy: при активном поиске бэкенд сортирует по
// релевантности, без поиска — по названию
const SORT_OPTIONS = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'price-asc', label: 'Сначала дешевле' },
  { value: 'price-desc', label: 'Сначала дороже' },
  { value: 'new', label: 'Сначала новые' },
  { value: 'rating-desc', label: 'По рейтингу' },
  { value: 'name-asc', label: 'По названию (А-Я)' },
  { value: 'name-desc', label: 'По названию (Я-А)' }
]

/**
 * Grid or dense list. Kept in localStorage rather than the URL: it's a personal
 * viewing preference, not part of what the page shows, so it shouldn't end up
 * in shared links or split the ISR cache.
 */
const viewMode = useState<'grid' | 'list'>('catalog-view', () => 'grid')
onMounted(() => {
  const saved = localStorage.getItem('catalog-view')
  if (saved === 'grid' || saved === 'list') viewMode.value = saved
})
function setViewMode(mode: 'grid' | 'list') {
  viewMode.value = mode
  if (import.meta.client) localStorage.setItem('catalog-view', mode)
}

const route = useRoute()
const router = useRouter()
const { apiBase, absoluteUrl, siteUrl } = useSite()

function queryValue(value: unknown) {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : undefined
  return value ? String(value) : undefined
}

const cleanParams = (params: Record<string, string | number | boolean | undefined>) => {
  // The filter drops `undefined`/''/false, so what is left fits a route query.
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== false)
  ) as Record<string, string | number>
}

// --- filter state derived from the URL (URL is the source of truth) ---
const search = computed(() => queryValue(route.query.search) || '')
const selectedBrandIds = computed(() => {
  const raw = queryValue(route.query.brands) || queryValue(route.query.brandId) || ''
  return raw.split(',').map(id => id.trim()).filter(Boolean)
})
/**
 * The supplier filter, and **only for an admin**. The facet itself is hidden
 * from a customer, but the parameter kept filtering: `/catalog?source=tools-by`
 * pasted into a chat, or left in a cached link, quietly showed one supplier's
 * goods with nothing in the UI saying so — the chip that would have said it is
 * hidden too. For everyone else the parameter is ignored and the catalogue is
 * always the whole catalogue. `isAdmin` is false on the server (the session
 * cookie is `Path=/api`, so a page request never carries it), so SSR renders
 * the full listing and the admin's own browser re-fetches with the filter
 * after hydration.
 */
const { isAdmin, authFetch } = useAuth()
const selectedSource = computed(() =>
  isAdmin.value
    ? queryValue(route.query.source) || queryValue(route.query.sourceCode) || ''
    : ''
)
/** Same reasoning as `sort`: a non-numeric bound is dropped, not forwarded. */
function priceParam(value: unknown) {
  const raw = queryValue(value)
  if (!raw) return ''
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? raw : ''
}
const priceMin = computed(() => priceParam(route.query.priceMin))
const priceMax = computed(() => priceParam(route.query.priceMax))
const inStock = computed(() => queryValue(route.query.inStock) === '1')
const onSale = computed(() => queryValue(route.query.onSale) === '1')
/**
 * Unknown values fall back to 'default' instead of reaching the API. `sortBy`
 * is an enum there, so a stale or hand-typed `?sort=` answered 400 and the
 * whole catalogue rendered the "не удалось получить товары" alert over a
 * perfectly valid category.
 */
const sort = computed(() => {
  const raw = queryValue(route.query.sort) || 'default'
  return SORT_OPTIONS.some(option => option.value === raw) ? raw : 'default'
})

/**
 * Specification filters live in one query parameter as
 * `<specId>:<value>,<value>;<specId>:<value>` — one key keeps the URL readable
 * however many specifications the category has.
 */
const specsRaw = computed(() => queryValue(route.query.specs) || '')
const selectedSpecs = computed<Record<string, string[]>>(() => {
  const result: Record<string, string[]> = {}
  for (const chunk of specsRaw.value.split(';')) {
    const separator = chunk.indexOf(':')
    if (separator <= 0) continue
    const id = chunk.slice(0, separator).trim()
    const values = chunk.slice(separator + 1).split(',').map(v => v.trim()).filter(Boolean)
    if (id && values.length) result[id] = values
  }
  return result
})
const specFacets = computed<SpecFacet[]>(() => products.value?.facets?.specs || [])

function serializeSpecs(map: Record<string, string[]>) {
  return Object.entries(map)
    .filter(([, values]) => values.length)
    .map(([id, values]) => `${id}:${values.join(',')}`)
    .join(';')
}

function toggleSpecValue(specId: string, value: string) {
  const next = { ...selectedSpecs.value }
  const current = next[specId] || []
  next[specId] = current.includes(value)
    ? current.filter(v => v !== value)
    : [...current, value]
  pushQuery({ specs: serializeSpecs(next) || undefined })
}

function clearSpec(specId: string) {
  const next = Object.fromEntries(
    Object.entries(selectedSpecs.value).filter(([id]) => id !== specId)
  )
  pushQuery({ specs: serializeSpecs(next) || undefined })
}
const page = computed(() => Math.max(1, Number(queryValue(route.query.page)) || 1))
const legacyCategoryId = computed(() => queryValue(route.query.categoryId))

// price inputs are the only "draft" inputs (applied on submit)
const priceDraft = reactive({ min: priceMin.value, max: priceMax.value })
watch([priceMin, priceMax], ([min, max]) => {
  priceDraft.min = min
  priceDraft.max = max
})

const sortParams = computed(() => {
  if (sort.value === 'default') return { sortBy: undefined, sortOrder: undefined }
  if (sort.value === 'new') return { sortBy: 'createdAt', sortOrder: 'desc' }
  const [sortBy, sortOrder] = sort.value.split('-')
  return { sortBy, sortOrder }
})

const queryParams = computed(() => cleanParams({
  search: search.value || undefined,
  categorySlug: props.categorySlug,
  categoryId: props.categorySlug ? undefined : legacyCategoryId.value,
  brandId: selectedBrandIds.value.join(',') || undefined,
  sourceCode: selectedSource.value || undefined,
  priceMin: priceMin.value || undefined,
  priceMax: priceMax.value || undefined,
  inStock: inStock.value ? '1' : undefined,
  onSale: onSale.value ? '1' : undefined,
  specs: specsRaw.value || undefined,
  sortBy: sortParams.value.sortBy,
  sortOrder: sortParams.value.sortOrder,
  page: page.value,
  limit: PAGE_SIZE
}))

// --- data ---
/**
 * A category that did not load is either a 404 (no such category) or the API
 * being down — and those must not look the same, or an outage is reported to
 * every visitor as «категория не найдена». The outage is kept on the side and
 * turned into the maintenance page below.
 */
const categoryUnavailable = ref(false)

// The four requests are independent — products are filtered by the slug in
// the URL, not by the category answer — so they start together and the render
// waits for the slowest instead of their sum.
const catalogDataKey = computed(() => `catalog-products:${route.fullPath}`)

/**
 * New results fade in, one card after another — but only after the first
 * client-side change: animating the server-rendered page would hold back its
 * largest paint for nothing.
 */
const resultsAnimated = ref(false)
const [
  { data: category },
  { data: products, pending, error },
  { data: tree },
  { data: brands },
] = await Promise.all([
  useAsyncData<CategoryPage | null>(
    () => `catalog-category:${props.categorySlug || ''}`,
    () => props.categorySlug
      ? $fetch<CategoryPage>(`${apiBase}/categories/${props.categorySlug}`).catch(error => {
          if (isApiUnavailable(error)) {
            categoryUnavailable.value = true
            return null
          }
          throw error
        })
      : Promise.resolve(null),
    { default: () => null }
  ),
  useAsyncData<CatalogProductsResponse>(
    catalogDataKey,
    () => $fetch<CatalogProductsResponse>(`${apiBase}/products`, { params: queryParams.value }),
    {
      default: () => ({ data: [], pagination: { page: 1, limit: PAGE_SIZE, total: 0, pages: 0 } }),
      transform: response => ({ ...response, data: response.data.map(toCardProduct) }),
      watch: [queryParams]
    }
  ),
  useCategoryTree(),
  // Only what the brand facet draws: `/brands` sends every column of every
  // brand, and the whole answer would otherwise ride along in the page payload.
  useAsyncData<FacetItem[]>(
    'catalog-brands',
    () => $fetch<FacetItem[]>(`${apiBase}/brands`).catch(() => []),
    {
      default: () => [],
      transform: list => (Array.isArray(list) ? list : [])
        .map(brand => ({ id: brand.id, name: brand.name, slug: brand.slug }))
    }
  ),
])

watch(catalogDataKey, () => {
  if (import.meta.client) resultsAnimated.value = true
})

if (categoryUnavailable.value) throw apiUnavailableError()

if (props.categorySlug && !category.value) {
  throw createError({ statusCode: 404, statusMessage: 'Категория не найдена', fatal: true })
}

if (category.value && props.categorySlug !== category.value.slug) {
  await navigateTo({ path: `/catalog/${category.value.slug}`, query: route.query }, { redirectCode: 301, replace: true })
}

/**
 * On the server an unreachable API means the technical-works page instead of
 * an empty catalogue. On the client the inline alert below is the better
 * answer: the page around it is already rendered and a transient blip must not
 * throw the visitor out of it.
 */
if (import.meta.server && isApiUnavailable(error.value)) throw apiUnavailableError()

/**
 * The «Поставщик» facet is **admin-only**: which supplier carries a product is
 * internal, the same rule as supplier URLs and our costs. `GET /sources` sits
 * behind `AdminGuard`, so the list is fetched only when an ADMIN session is
 * present — and never on the server, because catalogue HTML is ISR-cached and
 * served to every visitor alike. For everyone else `sources` stays empty, and
 * the filter panel's own `v-if` drops the whole section.
 */
const sources = ref<FacetItem[]>([])

watch(isAdmin, async admin => {
  if (!import.meta.client || !admin || sources.value.length) return
  try {
    sources.value = await authFetch<FacetItem[]>('/sources')
  } catch {
    sources.value = []
  }
}, { immediate: true })

// --- facet helpers ---
const brandCounts = computed(() => products.value?.facets?.brands || {})
const categoryFacet = computed(() => products.value?.facets?.categories || {})
const priceRange = computed(() => products.value?.facets?.priceRange || null)

/**
 * Product count for a sidebar category within the current filter context.
 *
 * The API already folds each rendered category's subtree into one number —
 * it used to send a count per leaf category and leave the fold to us, which
 * meant shipping the whole 1500-entry map on every request just so this
 * function could walk it. Categories that match nothing are absent from the
 * map rather than present as `0`.
 */
function contextCount(id: string) {
  return categoryFacet.value[id] || 0
}

/**
 * Subcategories worth offering: the children of the current category (or the
 * roots at the top level), each with the count it would yield *under the
 * filters currently applied*.
 *
 * Empty ones are dropped. A category whose count is 0 is not a choice — it is
 * a link to the "ничего не найдено" screen — and the catalogue used to render
 * a row of them: switch on "только со скидкой" at the top level and every
 * category without a discounted product stayed in the list reading "0".
 */
const categoryLinks = computed(() => {
  const items = category.value
    ? category.value.children
    : (tree.value || []).map(node => ({
        id: node.id,
        name: node.name,
        slug: node.slug,
        image: node.image,
        productCount: node.productCount
      }))
  return items
    .map(item => ({ ...item, count: contextCount(item.id) }))
    .filter(item => item.count > 0)
})


const parentLink = computed(() => {
  if (!category.value) return null
  const parent = category.value.ancestors.at(-1)
  return parent
    ? { to: categoryTo(parent.slug), label: parent.name }
    : { to: categoryTo(null), label: 'Все категории' }
})

// brand search inside the facet
const brandQuery = ref('')
const visibleBrands = computed(() => {
  const list = (brands.value || [])
    .filter(brand => (brandCounts.value[brand.id] || 0) > 0 || selectedBrandIds.value.includes(brand.id))
  const query = brandQuery.value.trim().toLowerCase()
  return query ? list.filter(brand => brand.name.toLowerCase().includes(query)) : list
})

const selectedBrands = computed(() =>
  (brands.value || []).filter(brand => selectedBrandIds.value.includes(brand.id))
)

// --- navigation ---
function currentQuery(overrides: Record<string, string | undefined>) {
  return cleanParams({
    search: search.value || undefined,
    brands: selectedBrandIds.value.join(',') || undefined,
    source: selectedSource.value || undefined,
    priceMin: priceMin.value || undefined,
    priceMax: priceMax.value || undefined,
    inStock: inStock.value ? '1' : undefined,
    onSale: onSale.value ? '1' : undefined,
    specs: specsRaw.value || undefined,
    sort: sort.value === 'default' ? undefined : sort.value,
    ...overrides
  })
}

function pushQuery(overrides: Record<string, string | undefined>) {
  // any filter change resets pagination
  router.push({ path: route.path, query: currentQuery({ page: undefined, ...overrides }) })
}

function categoryTo(slug: string | null) {
  return {
    path: slug ? `/catalog/${slug}` : '/catalog',
    query: currentQuery({ page: undefined })
  }
}

function toggleBrand(id: string) {
  const next = selectedBrandIds.value.includes(id)
    ? selectedBrandIds.value.filter(item => item !== id)
    : [...selectedBrandIds.value, id]
  pushQuery({ brands: next.join(',') || undefined })
}

function toggleSource(code?: string) {
  if (!code) return
  pushQuery({ source: selectedSource.value === code ? undefined : code })
}

function applyPrice() {
  pushQuery({
    priceMin: priceDraft.min ? String(priceDraft.min) : undefined,
    priceMax: priceDraft.max ? String(priceDraft.max) : undefined
  })
}

function setSort(value: string) {
  pushQuery({ sort: value === 'default' ? undefined : value, page: page.value > 1 ? String(page.value) : undefined })
}

function pageLocation(next: number) {
  return { path: route.path, query: currentQuery({ page: next > 1 ? String(next) : undefined }) }
}

/** The pager renders these as real links — crawlers only follow an href. */
function pageHref(next: number) {
  return router.resolve(pageLocation(next)).href
}

function setPage(next: number) {
  router.push(pageLocation(next))
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

function clearFilters() {
  router.push({ path: route.path })
}

const activeFiltersCount = computed(() =>
  (search.value ? 1 : 0)
  + selectedBrandIds.value.length
  + (selectedSource.value ? 1 : 0)
  + ((priceMin.value || priceMax.value) ? 1 : 0)
  + (inStock.value ? 1 : 0)
  + (onSale.value ? 1 : 0)
  + Object.keys(selectedSpecs.value).length
)

/**
 * `/catalog` with nothing applied is the "browse by category" page, so the
 * categories are the content there, not a shortcut strip above it. Once a
 * filter, a search or a subcategory narrows the view the visitor is looking
 * for products, and the same links go back to being a compact strip.
 */
const showCategoryTiles = computed(
  () => !category.value && !activeFiltersCount.value && categoryLinks.value.length > 0
)

type Chip = { key: string, label: string, remove: () => void }
const filterChips = computed<Chip[]>(() => {
  const chips: Chip[] = []
  if (search.value) {
    chips.push({ key: 'search', label: `Поиск: ${search.value}`, remove: () => pushQuery({ search: undefined }) })
  }
  for (const brand of selectedBrands.value) {
    chips.push({
      key: `brand-${brand.id}`,
      label: brand.name,
      remove: () => toggleBrand(brand.id)
    })
  }
  // `selectedSource` is empty for a customer, so the chip — whose fallback
  // label is the supplier's own code — can never be built for one.
  if (selectedSource.value) {
    const source = (sources.value || []).find(item => item.code === selectedSource.value)
    chips.push({ key: 'source', label: `Поставщик: ${source?.name || selectedSource.value}`, remove: () => pushQuery({ source: undefined }) })
  }
  if (priceMin.value || priceMax.value) {
    const label = priceMin.value && priceMax.value
      ? `Цена: ${priceMin.value}–${priceMax.value} BYN`
      : priceMin.value ? `Цена от ${priceMin.value} BYN` : `Цена до ${priceMax.value} BYN`
    chips.push({ key: 'price', label, remove: () => pushQuery({ priceMin: undefined, priceMax: undefined }) })
  }
  if (inStock.value) {
    chips.push({ key: 'stock', label: 'В наличии', remove: () => pushQuery({ inStock: undefined }) })
  }
  if (onSale.value) {
    chips.push({ key: 'sale', label: 'Со скидкой', remove: () => pushQuery({ onSale: undefined }) })
  }
  for (const [specId, values] of Object.entries(selectedSpecs.value)) {
    const facet = specFacets.value.find(item => item.id === specId)
    chips.push({
      key: `spec-${specId}`,
      label: `${facet?.name || 'Характеристика'}: ${values.join(', ')}`,
      remove: () => clearSpec(specId)
    })
  }
  return chips
})

const breadcrumbItems = computed(() => {
  const items: Array<{ label: string, to?: string }> = [{ label: 'Главная', to: '/' }]
  if (!category.value) {
    items.push({ label: 'Каталог' })
    return items
  }
  items.push({ label: 'Каталог', to: '/catalog' })
  for (const ancestor of category.value.ancestors) {
    items.push({ label: ancestor.name, to: `/catalog/${ancestor.slug}` })
  }
  items.push({ label: category.value.name })
  return items
})

// --- filter panel (rendered twice: drawer on mobile, sidebar on desktop) ---
const filterProps = computed(() => ({
  brandQuery: brandQuery.value,
  priceMin: priceDraft.min,
  priceMax: priceDraft.max,
  category: category.value,
  categoryLinks: categoryLinks.value,
  categoryHasChildren: Boolean(category.value?.children.length),
  parentLink: parentLink.value,
  inStock: inStock.value,
  onSale: onSale.value,
  priceRange: priceRange.value,
  brandCount: brands.value.length,
  visibleBrands: visibleBrands.value,
  brandCounts: brandCounts.value,
  selectedBrandIds: selectedBrandIds.value,
  sources: sources.value,
  selectedSource: selectedSource.value,
  activeFiltersCount: activeFiltersCount.value,
  specFacets: specFacets.value,
  selectedSpecs: selectedSpecs.value,
  categoryTo
}))

const filterEvents = {
  'update:brandQuery': (value: string) => { brandQuery.value = value },
  'update:priceMin': (value: string) => { priceDraft.min = value },
  'update:priceMax': (value: string) => { priceDraft.max = value },
  pushQuery,
  toggleBrand,
  toggleSource,
  toggleSpec: toggleSpecValue,
  clearSpec,
  applyPrice,
  clear: clearFilters
}

// --- mobile filters drawer ---
// UiDrawer locks the page scroll itself (useModalA11y).
const filtersOpen = ref(false)
watch(() => route.fullPath, () => { filtersOpen.value = false })

// --- SEO ---
/**
 * `?page=N` of an unfiltered listing is its own page for a crawler: it is the
 * only route to the products past the first 24, so it gets a self-referencing
 * canonical (and a title of its own, or every page of a category would share
 * one). Page 1 stays canonical without the parameter. Filtered or re-sorted
 * views keep pointing at the plain category, as before.
 */
const canonicalPage = computed(() =>
  page.value > 1 && !activeFiltersCount.value && sort.value === 'default' ? page.value : 1
)
const pageSuffix = computed(() => (page.value > 1 ? ` — страница ${page.value}` : ''))
const pageTitle = computed(() => (category.value
  ? `${category.value.name} купить в Беларуси — цены`
  : 'Каталог инструмента и крепежа') + `${pageSuffix.value} | Gost.by`)
/**
 * A written description wins — the AI tasks fill `seoDescription` per
 * category. Until then the parser's copy is just the category name
 * («Замки велосипедные»), which is what every snippet showed; that counts as
 * no description, and the template says something a searcher can use.
 */
const pageDescription = computed(() => {
  const current = category.value
  if (!current) return 'Каталог инструментов, крепежа и расходников с фильтрами по категориям, брендам и цене.'
  const written = current.seoDescription?.trim()
  const pageNote = page.value > 1 ? ` Страница ${page.value}.` : ''
  if (written && written.toLowerCase() !== current.name.trim().toLowerCase() && written.length >= 40)
    return written + pageNote
  const from = priceRange.value?.min ? `, цены от ${formatPrice(priceRange.value.min, 'BYN')}` : ''
  return `${current.name} — ${pluralize(current.productCount, 'product')} в каталоге Gost.by${from}. `
    + `Оплата по счёту для организаций, доставка по Беларуси, самовывоз в Витебске.${pageNote}`
})
const listingUrl = computed(() =>
  absoluteUrl(category.value ? `/catalog/${category.value.slug}` : '/catalog'))
const canonicalUrl = computed(() =>
  canonicalPage.value > 1 ? `${listingUrl.value}?page=${canonicalPage.value}` : listingUrl.value
)

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogType: 'website',
  ogUrl: canonicalUrl,
  // A shared category link previews its first product rather than the logo.
  ogImage: () => ogImageUrl(siteUrl, products.value?.data?.[0]?.images?.[0]?.url),
  ogImageWidth: () => (products.value?.data?.[0]?.images?.[0]?.url ? OG_IMAGE_WIDTH : undefined),
  ogImageHeight: () => (products.value?.data?.[0]?.images?.[0]?.url ? OG_IMAGE_HEIGHT : undefined),
  twitterCard: 'summary_large_image',
  // A hidden branch (e.g. «Неразобранные товары поставщиков») stays reachable
  // by URL but must not compete in search with the real departments.
  robots: () => (category.value?.isVisible === false ? 'noindex, follow' : undefined)
})

// The BreadcrumbList JSON-LD comes from <UiBreadcrumbs>.
useHead(() => ({
  link: [{ rel: 'canonical', href: canonicalUrl.value }]
}))

/**
 * A category text, split for the layout: its first paragraph is the intro
 * under the heading (two lines, clamped), the whole of it sits below the
 * product grid.
 */
const descriptionAll = computed(() =>
  (category.value?.description ?? '')
    .split(/\n\s*\n|\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
)
const descriptionIntro = computed(() => descriptionAll.value[0] ?? '')
/**
 * The full text under the grid — on the first page only, so the paginated
 * copies are not the same text again — whenever the intro cannot show it
 * all: more than one paragraph, or one longer than two lines.
 */
const INTRO_CHARS = 180
const showAbout = computed(() =>
  page.value === 1
  && (descriptionAll.value.length > 1 || descriptionIntro.value.length > INTRO_CHARS)
)
</script>

<template>
  <div class="catalog-page">
    <UiBreadcrumbs :items="breadcrumbItems" />

    <header class="catalog-head">
      <div>
        <h1>{{ category?.name || 'Каталог товаров' }}</h1>
        <!-- The link sits outside the clamped paragraph: inside, the clamp hid
             it exactly when the text was long enough to need it. -->
        <p v-if="descriptionIntro" class="intro">{{ descriptionIntro }}</p>
        <a v-if="showAbout" href="#category-about" class="more-link">Подробнее о разделе</a>
      </div>
      <div class="head-links">
        <!-- Purchasers compare in their own sheet; same URL for everyone, so
             the cached page can carry it. -->
        <a :href="priceListUrl({ categorySlug: category?.slug })" class="price-link" rel="nofollow" download>
          Прайс-лист{{ category ? ' раздела' : '' }} (Excel)
        </a>
        <NuxtLink v-if="parentLink" :to="parentLink.to" class="up-link">
          ← {{ parentLink.label }}
        </NuxtLink>
      </div>
    </header>

    <!-- Browsing the catalogue: at the top level the categories *are* the
         page, so they get the room. -->
    <section v-if="showCategoryTiles" class="category-browse" aria-label="Категории каталога">
      <div class="category-grid">
        <UiCategoryCard
          v-for="item in categoryLinks"
          :key="item.id"
          :name="item.name"
          :to="categoryTo(item.slug)"
          :count="item.count"
          :image="item.image"
          variant="tile"
        />
      </div>
    </section>

    <!-- Narrowed view: the same links as a compact strip, so the product grid
         stays in sight. -->
    <!-- `fade` is off on purpose: the edge gradient is painted in
         `--surface-card` and this strip sits on the page background. -->
    <UiScroller
      v-else-if="categoryLinks.length"
      class="subcategories"
      label="Подкатегории"
      :fade="false"
    >
      <UiCategoryCard
        v-for="item in categoryLinks"
        :key="item.id"
        :name="item.name"
        :to="categoryTo(item.slug)"
        :count="item.count"
        variant="chip"
      />
    </UiScroller>

    <div class="layout">
      <UiDrawer v-model:open="filtersOpen" title="Фильтры">
        <CatalogFilters v-bind="filterProps" v-on="filterEvents" />
        <template #footer>
          <UiButton block @click="filtersOpen = false">
            Показать {{ products?.pagination.total || 0 }}
          </UiButton>
        </template>
      </UiDrawer>

      <aside class="filters-desktop" aria-label="Фильтры каталога">
        <CatalogFilters v-bind="filterProps" v-on="filterEvents" />
      </aside>

      <div class="content">
        <h2 v-if="showCategoryTiles" class="content-title">Все товары каталога</h2>

        <div class="toolbar">
          <span class="total" aria-live="polite">
            Найдено <strong>{{ products?.pagination.total || 0 }}</strong>
          </span>

          <div class="toolbar-actions">
            <UiButton
              class="filters-toggle"
              variant="secondary"
              size="sm"
              @click="filtersOpen = true"
            >
              Фильтры<template v-if="activeFiltersCount"> · {{ activeFiltersCount }}</template>
            </UiButton>

            <UiSelect
              :model-value="sort"
              size="sm"
              class="sort"
              :options="SORT_OPTIONS"
              @update:model-value="setSort(String($event))"
            />

            <div class="view-switch" role="group" aria-label="Вид списка">
              <button
                type="button"
                :class="{ 'is-active': viewMode === 'grid' }"
                :aria-pressed="viewMode === 'grid'"
                aria-label="Плиткой"
                @click="setViewMode('grid')"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                :class="{ 'is-active': viewMode === 'list' }"
                :aria-pressed="viewMode === 'list'"
                aria-label="Списком"
                @click="setViewMode('list')"
              >
                <UiIcon name="menu" :stroke-width="2.4" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="filterChips.length" class="chips">
          <button
            v-for="chip in filterChips"
            :key="chip.key"
            type="button"
            class="chip"
            @click="chip.remove()"
          >
            {{ chip.label }}
            <UiIcon name="close" :stroke-width="2" />
          </button>
          <button type="button" class="chip is-clear" @click="clearFilters">Сбросить всё</button>
        </div>

        <div v-if="pending" :class="viewMode === 'grid' ? 'product-grid' : 'list'">
          <UiSkeleton
            v-for="i in 8"
            :key="i"
            :height="viewMode === 'grid' ? '330px' : '180px'"
            radius="var(--radius-md)"
          />
        </div>

        <UiAlert v-else-if="error" tone="danger">
          Не удалось получить товары. Обновите страницу или попробуйте позже.
        </UiAlert>

        <UiEmpty
          v-else-if="!products?.data.length"
          icon="search"
          title="По выбранным фильтрам ничего не найдено"
          description="Попробуйте изменить запрос, расширить диапазон цены или снять часть фильтров."
        >
          <UiButton variant="secondary" @click="clearFilters">Сбросить фильтры</UiButton>
        </UiEmpty>

        <template v-else>
          <div v-if="viewMode === 'grid'" class="product-grid" :class="{ 'is-animated': resultsAnimated }">
            <ProductCatalogCard
              v-for="(product, index) in products.data"
              :key="product.id"
              :product="product"
              :priority="index < LCP_CARD_COUNT"
            />
          </div>
          <div v-else class="list" :class="{ 'is-animated': resultsAnimated }">
            <ProductCatalogRow
              v-for="product in products.data"
              :key="product.id"
              :product="product"
            />
          </div>
        </template>

        <UiPagination
          :page="page"
          :pages="products?.pagination.pages || 0"
          :total="products?.pagination.total"
          :href-for="pageHref"
          @change="setPage"
        />

        <!-- The category text lives under the grid: three paragraphs above it
             pushed the products off the first screen. -->
        <section v-if="showAbout" id="category-about" class="category-about">
          <h2>О разделе «{{ category?.name }}»</h2>
          <p v-for="(paragraph, index) in descriptionAll" :key="index">{{ paragraph }}</p>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.catalog-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.catalog-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.head-links {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-4);
}

.price-link {
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
}

.catalog-head h1 {
  font-size: var(--text-2xl);
}

.catalog-head p {
  max-width: 80ch;
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.catalog-head .intro {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}

.more-link {
  display: inline-block;
  margin-top: var(--space-1);
  color: var(--brand);
  font-size: var(--text-sm);
  font-weight: 600;
}

.category-about {
  max-width: 80ch;
  margin-top: var(--space-8);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.category-about h2 {
  margin-bottom: var(--space-3);
  color: var(--text-strong);
  font-size: var(--text-lg);
}

.category-about p + p {
  margin-top: var(--space-3);
}

/* Second way out of a category, for visitors who never look at the sidebar
   or the breadcrumbs. */
.up-link {
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.up-link:hover {
  color: var(--text-link);
}

/* ---- Categories ---- */
.category-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
}

.subcategories :deep(.viewport) {
  gap: var(--space-2);
}

.content-title {
  font-size: var(--text-lg);
}

/* ---- Layout ---- */
.layout {
  display: grid;
  align-items: start;
  gap: var(--space-5);
  grid-template-columns: 260px minmax(0, 1fr);
}

.filters-desktop {
  height: 100%;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-4);
}

/* ---- Toolbar ---- */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.total {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.total strong {
  color: var(--text-strong);
}

.toolbar-actions {
  display: flex;
  /* Without this the row cannot break and its last child — the view switch —
     is pushed straight out through the card's right edge on a phone. */
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.sort {
  width: 210px;
  /* A flex item defaults to `min-width: auto`, and a <select>'s min-content is
     its longest option ("По названию (А-Я)"), so the select refused to shrink
     and pushed the row ~70px wider than the toolbar. */
  min-width: 0;
}

.filters-toggle {
  display: none;
}

.view-switch {
  display: flex;
  /* 2x34px of icon button: it should never be the thing that gives way. */
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.view-switch button {
  display: grid;
  width: 34px;
  height: 34px;
  color: var(--text-muted);
  place-items: center;
}

.view-switch button:hover {
  background: var(--surface-hover);
}

.view-switch button.is-active {
  background: var(--brand);
  color: var(--text-inverse);
}

.view-switch svg {
  width: 16px;
  height: 16px;
}

/* ---- Chips ---- */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--brand-soft);
  color: var(--brand-soft-text);
  font-size: var(--text-xs);
  font-weight: 600;
  gap: var(--space-2);
}

.chip svg {
  width: 12px;
  height: 12px;
}

.chip:hover {
  background: var(--brand);
  color: var(--text-inverse);
}

.chip.is-clear {
  background: none;
  color: var(--text-muted);
}

.chip.is-clear:hover {
  background: var(--surface-active);
  color: var(--text-strong);
}

/* ---- Results ---- */
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* ---- Responsive ---- */
@media (max-width: 1024px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .filters-desktop {
    display: none;
  }

  .filters-toggle {
    display: inline-flex;
  }
}

@media (max-width: 560px) {
  .toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .toolbar-actions {
    justify-content: space-between;
  }

  /* The select is the widest control of the three and cannot be squeezed, so
     it takes a row of its own and the two small controls share the next one. */
  .sort {
    order: -1;
    width: auto;
    flex: 1 0 100%;
  }

  .filters-toggle {
    flex-shrink: 0;
  }
}

/* ---- Results arriving after a filter or search change ---- */
.is-animated > * {
  animation: results-in var(--duration-slow) var(--ease-out) both;
}

.is-animated > :nth-child(2) { animation-delay: 30ms; }
.is-animated > :nth-child(3) { animation-delay: 60ms; }
.is-animated > :nth-child(4) { animation-delay: 90ms; }
.is-animated > :nth-child(5) { animation-delay: 120ms; }
.is-animated > :nth-child(6) { animation-delay: 150ms; }
.is-animated > :nth-child(7) { animation-delay: 180ms; }
.is-animated > :nth-child(n + 8) { animation-delay: 210ms; }

@keyframes results-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-animated > * {
    animation: none;
  }
}
</style>
