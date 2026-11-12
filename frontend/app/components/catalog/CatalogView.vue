<script setup lang="ts">
import { reachGoal } from '~/utils/metrika'
import type { BreadcrumbItem, CatalogProductsResponse, CategoryPage, FacetItem, SpecFacet, CatalogLanding } from '~/types/api'
import { toCardProduct } from '~/composables/useProductActions'


const props = defineProps<{
  categorySlug?: string
  /**
   * A «категория + бренд» landing (`/catalog/<category>/<brand>`): its brand
   * is part of the address and always selected; its texts and canonical
   * replace the category's.
   */
  landing?: CatalogLanding | null
}>()
/** The brand the address itself selects (a landing), not the query. */
const pathBrandId = computed(() => props.landing?.brand.id ?? '')
const { priceListUrl } = useB2b()
const { formatPrice } = useFormatPrice()

const PAGE_SIZE = 24
/**
 * Cards whose photo loads eagerly: what is above the fold. On a desktop
 * `.product-grid`'s 228px tracks fit four per row; on a phone it is two to a
 * row, and the toolbar leaves room for about two rows — four again.
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
// Through safe-storage: with site data blocked a raw localStorage read throws
// during hydration, and Nuxt swapped the whole catalogue for its 500 page.
onMounted(() => {
  const saved = readJson<string>('catalog-view')
  if (saved === 'grid' || saved === 'list') viewMode.value = saved
})
function setViewMode(mode: 'grid' | 'list') {
  viewMode.value = mode
  writeJson('catalog-view', mode)
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
const queryBrandIds = computed(() => {
  const raw = queryValue(route.query.brands) || queryValue(route.query.brandId) || ''
  return raw.split(',').map(id => id.trim()).filter(Boolean)
})
const selectedBrandIds = computed(() =>
  [...new Set([pathBrandId.value, ...queryBrandIds.value].filter(Boolean))])
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
// Without the #fragment: «Подробнее о разделе» (#category-about) and the
// skip-link changed the key, refetched the grid and the jump landed in the
// wrong place while the skeletons stood in.
const catalogDataKey = computed(() => `catalog-products:${route.fullPath.split('#')[0]}`)

/**
 * New results fade in, one card after another — but only after the first
 * client-side change: animating the server-rendered page would hold back its
 * largest paint for nothing.
 */
const resultsAnimated = ref(false)

/**
 * The old address of a landing: the category filtered by exactly one brand
 * and nothing else (`?brands=<id>`, what the brand page used to link). With
 * a published landing it moves to the pretty `/catalog/<category>/<brand>`;
 * without one it stays a plain filtered view (canonical = category).
 */
const legacyLandingBrandId = computed(() => {
  if (props.landing || !props.categorySlug || queryBrandIds.value.length !== 1) return ''
  const other = Object.keys(route.query).filter(key => key !== 'brands')
  return other.length ? '' : queryBrandIds.value[0]!
})

const [
  { data: category },
  { data: products, pending, error },
  { data: tree },
  { data: brands },
  { data: legacyLanding },
] = await Promise.all([
  useAsyncData<CategoryPage | null>(
    () => `catalog-category:${props.categorySlug || ''}`,
    () => props.categorySlug
      ? $fetch<CategoryPage>(`${apiBase}/categories/${encodeURIComponent(props.categorySlug)}`).catch(error => {
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
  useAsyncData<CatalogLanding | null>(
    () => `catalog-landing:${props.categorySlug || ''}:${legacyLandingBrandId.value}`,
    () => legacyLandingBrandId.value
      ? $fetch<CatalogLanding>(`${apiBase}/storefront/landing`, {
          params: { category: props.categorySlug, brand: legacyLandingBrandId.value },
        }).catch(() => null)
      : Promise.resolve(null),
    { default: () => null, watch: [legacyLandingBrandId] }
  ),
])

watch(catalogDataKey, () => {
  if (import.meta.client) resultsAnimated.value = true
})

if (categoryUnavailable.value) throw apiUnavailableError()

if (props.categorySlug && !category.value) {
  throw createError({ statusCode: 404, statusMessage: 'Категория не найдена', fatal: true })
}

if (legacyLanding.value && category.value) {
  await navigateTo(`/catalog/${category.value.slug}/${legacyLanding.value.brand.slug}`, { redirectCode: 301, replace: true })
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

// A `?page=N` past the last page is a 404, not an empty «ничего не найдено»
// with 200 and a self-canonical — a soft 404 the cache kept and search
// engines indexed. Nitro never caches a 4xx.
if (import.meta.server && !error.value && page.value > Math.max(1, products.value?.pagination.pages ?? 1)) {
  throw createError({ statusCode: 404, statusMessage: 'Страница не найдена', fatal: true })
}

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
  // Biggest first by what the visitor would get under the current filters.
  return items
    .map(item => ({ ...item, count: contextCount(item.id) }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
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
/**
 * The query of the current filters. On a landing its brand is in the path,
 * so it is left out — unless the link leaves the landing (another category,
 * the brand switched off), where it has to travel as a filter.
 */
function currentQuery(overrides: Record<string, string | undefined>, withPathBrand = false) {
  const brandIds = withPathBrand ? selectedBrandIds.value : queryBrandIds.value.filter(id => id !== pathBrandId.value)
  return cleanParams({
    search: search.value || undefined,
    brands: brandIds.join(',') || undefined,
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
    query: currentQuery({ page: undefined }, true)
  }
}

/** The plain category this page belongs to — a landing's way out. */
const categoryPath = computed(() => (props.categorySlug ? `/catalog/${props.categorySlug}` : '/catalog'))

function toggleBrand(id: string) {
  const next = selectedBrandIds.value.includes(id)
    ? selectedBrandIds.value.filter(item => item !== id)
    : [...selectedBrandIds.value, id]
  if (pathBrandId.value && !next.includes(pathBrandId.value)) {
    // The landing's own brand switched off: back to the category.
    router.push({ path: categoryPath.value, query: currentQuery({ page: undefined, brands: next.join(',') || undefined }, true) })
    return
  }
  pushQuery({ brands: next.filter(item => item !== pathBrandId.value).join(',') || undefined })
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
  router.push({ path: props.landing ? categoryPath.value : route.path })
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
 * Subcategories get tiles while nothing is filtered (owner, 2026-11-05): the
 * shop-window `tile` on `/catalog`, where the categories are the page, and the
 * `compact` one on a category page, where they sit above the products. Artwork
 * is the category's typical product with a real photo. Once a filter or a
 * search narrows the view the same links shrink to a strip.
 */
const showCategoryTiles = computed(
  () => !activeFiltersCount.value && categoryLinks.value.length > 0
)
/**
 * On a category page the first eight only — two rows on a computer, four on a
 * phone — so the products stay near the top («Электроинструмент» has 48). The
 * rest are rendered and hidden, not left out: every link stays in the HTML.
 */
const TILE_PREVIEW = 8
const tilesExpanded = ref(false)
watch(() => category.value?.id, () => {
  tilesExpanded.value = false
})
const tileHidden = (index: number) => Boolean(category.value) && !tilesExpanded.value && index >= TILE_PREVIEW
const hiddenTiles = computed(() =>
  category.value && !tilesExpanded.value ? Math.max(0, categoryLinks.value.length - TILE_PREVIEW) : 0
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
  const items: BreadcrumbItem[] = [{ label: 'Главная', to: '/' }]
  if (!category.value) {
    items.push({ label: 'Каталог' })
    return items
  }
  // `category` opens the crumb's subcategories on hover ('' = the roots).
  items.push({ label: 'Каталог', to: '/catalog', category: '' })
  for (const ancestor of category.value.ancestors) {
    items.push({ label: ancestor.name, to: `/catalog/${ancestor.slug}`, category: ancestor.slug })
  }
  if (props.landing) {
    items.push({ label: category.value.name, to: categoryPath.value, category: category.value.slug })
    items.push({ label: props.landing.brand.name })
    return items
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
/** Filters beyond the address: a landing's own brand is not one. */
const extraFiltersCount = computed(() => activeFiltersCount.value - (pathBrandId.value ? 1 : 0))
const canonicalPage = computed(() =>
  page.value > 1 && !extraFiltersCount.value && sort.value === 'default' ? page.value : 1
)
const pageSuffix = computed(() => (page.value > 1 ? ` — страница ${page.value}` : ''))
const landing = computed(() => props.landing ?? null)
const pageTitle = computed(() => landing.value
  ? `${landing.value.seoTitle}${pageSuffix.value} | Gost.by`
  : (category.value
  ? `${category.value.name} купить в Беларуси — цены`
  : 'Каталог инструмента и крепежа') + `${pageSuffix.value} | Gost.by`)
/**
 * A written description wins — the AI tasks fill `seoDescription` per
 * category. Until then the parser's copy is just the category name
 * («Замки велосипедные»), which is what every snippet showed; that counts as
 * no description, and the template says something a searcher can use.
 */
const pageDescription = computed(() => {
  if (landing.value) return landing.value.seoDescription + (page.value > 1 ? ` Страница ${page.value}.` : '')
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
  absoluteUrl(category.value
    // A landing is its own page: the brand is part of its address.
    ? `/catalog/${category.value.slug}${landing.value ? `/${landing.value.brand.slug}` : ''}`
    : '/catalog'))
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
  (landing.value ? landing.value.description : category.value?.description ?? '')
    .split(/\n\s*\n|\n/)
    .map(paragraph => typograf(paragraph.trim()))
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

/**
 * «Подробнее о разделе» → the text under the grid. The plain #anchor jump
 * missed it by a different amount on every page: past 140px the header folds
 * its promo strip and category row, which shortens the document *above* the
 * target in the middle of the jump, and the sticky header then sat over the
 * heading. So the jump aims below the header as it will be once folded, and
 * checks once it has stopped (the fold animates for 200 ms). Measured
 * 2026-11-12, five categories at 390 and 1280 px: the old jump missed by
 * −834…+2 503 px, this one lands the card 16 px under the header on every one.
 * The URL is left alone — a #fragment in it used to refetch the grid. Without
 * JS the href still works; `scroll-margin-top` keeps the heading clear.
 */
/** Space between the sticky header and the «О разделе» card (= --space-4). */
const ABOUT_GAP = 16

function scrollToAbout(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const section = document.getElementById('category-about')
  if (!section) return
  event.preventDefault()

  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  // Measured, not the --header-height token: on a phone the folded header
  // keeps its search row (125px at 390, against 68 on a desktop).
  const header = document.querySelector<HTMLElement>('.site-header')
  const offset = () => section.getBoundingClientRect().top - ((header?.getBoundingClientRect().bottom ?? 0) + ABOUT_GAP)

  // The fold takes the same height out of the header and out of the page
  // above the section, so «section − header bottom» measured now is already
  // the distance it will be once folded.
  window.scrollTo({ top: Math.max(0, window.scrollY + offset()), behavior })

  // One correction at most, and only for this jump: a listener left waiting
  // must not yank the page on the visitor's next scroll.
  let done = false
  const settle = () => {
    if (done) return
    done = true
    window.removeEventListener('scrollend', onEnd)
    const miss = offset()
    if (Math.abs(miss) > 2) window.scrollTo({ top: window.scrollY + miss, behavior })
  }
  const onEnd = () => setTimeout(settle, 250)
  if ('onscrollend' in window) window.addEventListener('scrollend', onEnd, { once: true })
  setTimeout(settle, 1500)
}

/*
 * «Коротко» beside the category text (owner, 2026-11-12: «покрасивее»):
 * facts the page already loaded, as links a buyer can use — never filler.
 * A group with nothing in it is not drawn; counts of 0 never appear
 * (categoryLinks drops them, brands are filtered the same way).
 */
const ABOUT_CHIPS = 8
const aboutTotal = computed(() => products.value?.pagination.total ?? category.value?.productCount ?? 0)
const aboutSubcategories = computed(() => categoryLinks.value.slice(0, ABOUT_CHIPS))
const aboutBrands = computed(() => {
  // On a landing the brand is the page itself.
  if (landing.value) return []
  return (brands.value || [])
    .map(brand => ({ ...brand, count: brandCounts.value[brand.id] || 0 }))
    .filter(brand => brand.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
    .slice(0, ABOUT_CHIPS)
})

/* ---- Search journal (useSearchLog, /admin/search) ---- */
// A search the visitor actually saw: its first page, once the results are
// in. Filters on top of a search re-report it; the server counts a repeat
// from the same visitor within ten minutes once.
const searchLog = useSearchLog()
let lastLogged = ''
watch(
  () => [search.value, page.value, pending.value, products.value?.pagination.total] as const,
  ([term, currentPage, loading, total]) => {
    if (!term || currentPage !== 1 || loading || total === undefined) return
    const key = `${term}|${total}|${route.fullPath}`
    if (key === lastLogged) return
    lastLogged = key
    searchLog.logSearch(term, total, 'catalog')
  },
  { immediate: true }
)

/** A click on a product link in the results of a search (not the cart button). */
function onResultClick(event: MouseEvent, productId: string, index: number) {
  if (!search.value) return
  if (!(event.target as HTMLElement | null)?.closest('a')) return
  const position = (page.value - 1) * PAGE_SIZE + index + 1
  searchLog.logClick(search.value, productId, position, 'catalog')
}
</script>

<template>
  <div class="catalog-page">
    <UiBreadcrumbs :items="breadcrumbItems" />

    <header class="catalog-head">
      <div>
        <h1>{{ landing?.h1 || category?.name || 'Каталог товаров' }}</h1>
        <!-- The link sits outside the clamped paragraph: inside, the clamp hid
             it exactly when the text was long enough to need it. -->
        <p v-if="descriptionIntro" class="intro">{{ descriptionIntro }}</p>
        <a v-if="showAbout" href="#category-about" class="more-link" @click="scrollToAbout">Подробнее о разделе</a>
      </div>
      <div class="head-links">
        <!-- Purchasers compare in their own sheet; same URL for everyone, so
             the cached page can carry it. -->
        <a :href="priceListUrl({ categorySlug: category?.slug })" class="price-link" rel="nofollow" download @click="reachGoal('price_list')">
          Прайс-лист{{ category ? ' раздела' : '' }} (Excel)
        </a>
      </div>
    </header>

    <!-- Browsing: the categories get the room (tiles), as long as nothing is
         filtered. -->
    <section v-if="showCategoryTiles" class="category-browse" :aria-label="category ? 'Подкатегории' : 'Категории каталога'">
      <div class="category-grid" :class="{ 'is-compact': category }">
        <UiCategoryCard
          v-for="(item, index) in categoryLinks"
          v-show="!tileHidden(index)"
          :key="item.id"
          :name="item.name"
          :to="categoryTo(item.slug)"
          :count="item.count"
          :image="item.image"
          :variant="category ? 'compact' : 'tile'"
        />
      </div>
      <UiButton
        v-if="hiddenTiles || (category && tilesExpanded)"
        variant="secondary"
        size="sm"
        class="tiles-toggle"
        @click="tilesExpanded = !tilesExpanded"
      >
        {{ tilesExpanded ? 'Свернуть' : `Показать все подкатегории (${categoryLinks.length})` }}
      </UiButton>
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
        <h2 v-if="showCategoryTiles" class="content-title">{{ category ? 'Все товары раздела' : 'Все товары каталога' }}</h2>

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
              @click.capture="onResultClick($event, product.id, index)"
            />
          </div>
          <div v-else class="list" :class="{ 'is-animated': resultsAnimated }">
            <ProductCatalogRow
              v-for="(product, index) in products.data"
              :key="product.id"
              :product="product"
              @click.capture="onResultClick($event, product.id, index)"
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
      </div>
    </div>

    <!-- The category text lives under the grid (three paragraphs above it
         pushed the products off the first screen), across the whole page —
         under the filters too, not squeezed beside them (owner, 2026-11-06). -->
    <section v-if="showAbout" id="category-about" class="category-about">
      <div class="about-text">
        <p class="about-eyebrow">О разделе</p>
        <h2>{{ landing ? landing.h1 : category?.name }}</h2>
        <p v-for="(paragraph, index) in descriptionAll" :key="index" :class="{ 'about-lead': index === 0 }">
          {{ paragraph }}
        </p>
      </div>

      <aside class="about-facts" aria-label="Коротко о разделе">
        <p v-if="aboutTotal" class="facts-figure">
          <strong>{{ pluralize(aboutTotal, 'product') }}</strong>
          <span v-if="priceRange?.min">от {{ formatPrice(priceRange.min, 'BYN') }}</span>
        </p>

        <div v-if="aboutSubcategories.length" class="facts-group">
          <h3>Подразделы</h3>
          <div class="facts-chips">
            <NuxtLink v-for="item in aboutSubcategories" :key="item.id" :to="categoryTo(item.slug)" class="facts-chip">
              {{ item.name }}<span>{{ item.count }}</span>
            </NuxtLink>
          </div>
        </div>

        <div v-if="aboutBrands.length" class="facts-group">
          <h3>Бренды</h3>
          <div class="facts-chips">
            <!-- A filter of this category, not the brand's page: the buyer
                 stays with the goods he came for. nofollow — the filtered
                 address canonicalises to the category anyway. -->
            <NuxtLink
              v-for="brand in aboutBrands"
              :key="brand.id"
              :to="{ path: categoryPath, query: { brands: brand.id } }"
              rel="nofollow"
              class="facts-chip"
            >
              {{ brand.name }}<span>{{ brand.count }}</span>
            </NuxtLink>
          </div>
        </div>

        <ul class="facts-terms">
          <li><UiIcon name="check" :size="16" :stroke-width="2.2" /> Оплата по счёту для организаций</li>
          <li><UiIcon name="check" :size="16" :stroke-width="2.2" /> Доставка по Беларуси</li>
          <li><UiIcon name="check" :size="16" :stroke-width="2.2" /> Самовывоз в Витебске</li>
        </ul>

        <a :href="priceListUrl({ categorySlug: category?.slug })" class="facts-price" rel="nofollow" download @click="reachGoal('price_list')">
          Прайс-лист раздела (Excel)
        </a>
      </aside>
    </section>
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
  overflow-wrap: anywhere;
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

/* A card the width of the page, under the filters and the grid; the text
   inside keeps a readable line and wraps even an unbroken string (a pasted link, a run of
   characters) instead of pushing past the content area (owner, 2026-11-06). */
.category-about {
  display: grid;
  min-width: 0;
  margin-top: var(--space-4);
  /* Clear of the folded sticky header; scrollToAbout() reads it too. */
  scroll-margin-top: calc(var(--header-height) + var(--space-4));
  /* Text, then «Коротко» — the right half of the card used to be empty. */
  grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-base);
  line-height: 1.65;
  overflow: hidden;
}

.about-text {
  min-width: 0;
  padding: var(--space-6) var(--space-8);
}

.about-text h2,
.about-text p {
  max-width: 68ch;
  overflow-wrap: anywhere;
}

.about-eyebrow {
  margin: 0 0 var(--space-1);
  color: var(--brand);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.about-text h2 {
  margin: 0 0 var(--space-4);
  color: var(--text-strong);
  font-size: var(--text-2xl);
  line-height: 1.2;
}

.about-text p:not(.about-eyebrow) {
  margin: 0;
  white-space: pre-line;
}

.about-text p:not(.about-eyebrow) + p {
  margin-top: var(--space-3);
}

/* The first paragraph is the answer to «что здесь» — it reads first. */
.about-text .about-lead {
  color: var(--text-strong);
  font-size: var(--text-md);
  line-height: 1.6;
}

.about-facts {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: var(--space-6);
  border-left: 1px solid var(--border-subtle);
  background: var(--surface-page);
  gap: var(--space-5);
}

.facts-figure {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  gap: var(--space-1) var(--space-2);
}

.facts-figure strong {
  color: var(--text-strong);
  font-size: var(--text-lg);
}

.facts-group h3 {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.facts-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.facts-chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-default);
  font-size: var(--text-sm);
  line-height: 1.4;
  gap: var(--space-2);
  overflow-wrap: anywhere;
  transition: border-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.facts-chip span {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.facts-chip:hover,
.facts-chip:focus-visible {
  border-color: var(--brand);
  color: var(--brand);
}

.facts-terms {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  color: var(--text-default);
  font-size: var(--text-sm);
  gap: var(--space-2);
  list-style: none;
}

.facts-terms li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.facts-terms :deep(svg) {
  flex: none;
  color: var(--success);
}

.facts-price {
  align-self: flex-start;
  color: var(--brand);
  font-size: var(--text-sm);
  font-weight: 600;
}

@media (max-width: 900px) {
  .category-about {
    grid-template-columns: minmax(0, 1fr);
  }

  .about-facts {
    border-top: 1px solid var(--border-subtle);
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .category-about {
    font-size: var(--text-sm);
  }

  .about-text,
  .about-facts {
    padding: var(--space-4);
  }

  .about-text h2 {
    font-size: var(--text-xl);
  }

  .about-text .about-lead {
    font-size: var(--text-base);
  }
}

/* ---- Categories ---- */
.category-browse {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.category-browse .category-grid {
  align-self: stretch;
}

.category-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
}

/* A category page: compact tiles, four to a row on a computer. */
.category-grid.is-compact {
  gap: var(--space-2) var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
}

/* Phones: three shop-window tiles to a row (one 343px tile per row was a
   long scroll), compact ones two to a row. */
@media (max-width: 560px) {
  .category-grid {
    gap: var(--space-2);
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .category-grid.is-compact {
    gap: var(--space-2);
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
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

/* As tall as its filters, not the product grid: stretched to the grid it was
   a long empty white box beside the cards (owner, 2026-11-06). */
.filters-desktop {
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
