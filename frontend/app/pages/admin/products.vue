<script setup lang="ts">
type Facet = { id: string, name: string, slug: string }
type SourceProduct = { id: string, url: string, source?: { id: string, name: string, code: string } | null }
type AdminProduct = { id: string, name: string, slug: string, sku?: string | null, model?: string | null, priceValue?: number | null, stockStatus?: string | null, status?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED', descriptionShort?: string | null, descriptionFull?: string | null, brandId?: string | null, categoryId: string, brand?: Facet | null, category?: Facet | null, sourceProducts?: SourceProduct[] }
type ProductResponse = { data: AdminProduct[], pagination: { page: number, limit: number, total: number, pages: number } }

const { token, loadToken, adminFetch } = useAdminApi()
const errorMessage = ref('')
const successMessage = ref('')
const editingId = ref('')
const isProductModalOpen = ref(false)
const previewProduct = ref<AdminProduct | null>(null)
const products = ref<AdminProduct[]>([])
const brands = ref<Facet[]>([])
const categories = ref<Facet[]>([])
const pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const filters = reactive({ search: '', categoryId: '', brandId: '', status: '', sortBy: 'name', sortOrder: 'asc' })
const productForm = reactive({ name: '', slug: '', sku: '', model: '', categoryId: '', brandId: '', priceValue: '', stockStatus: 'in_stock', status: 'PUBLISHED', descriptionShort: '', descriptionFull: '' })

function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '') }
function message(value: string, isError = false) { errorMessage.value = isError ? value : ''; successMessage.value = isError ? '' : value }
function queryString(params: Record<string, string | number | undefined>) { const query = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)) }); return query.toString() ? `?${query}` : '' }

async function loadProducts() {
  const response = await adminFetch<ProductResponse>(`/products${queryString({ ...filters, page: pagination.page, limit: pagination.limit })}`)
  products.value = response.data
  Object.assign(pagination, response.pagination)
}

async function loadData() {
  if (!token.value) return
  try {
    const [nextBrands, nextCategories] = await Promise.all([adminFetch<Facet[]>('/brands'), adminFetch<Facet[]>('/categories')])
    brands.value = nextBrands
    categories.value = nextCategories
    await loadProducts()
  } catch (error) {
    message(error instanceof Error ? error.message : 'Не удалось загрузить товары', true)
  }
}

function resetProductForm() { editingId.value = ''; Object.assign(productForm, { name: '', slug: '', sku: '', model: '', categoryId: '', brandId: '', priceValue: '', stockStatus: 'in_stock', status: 'PUBLISHED', descriptionShort: '', descriptionFull: '' }) }
function openCreateProduct() { resetProductForm(); isProductModalOpen.value = true }
function closeProductModal() { isProductModalOpen.value = false; resetProductForm() }
function editProduct(product: AdminProduct) { editingId.value = product.id; Object.assign(productForm, { name: product.name, slug: product.slug, sku: product.sku || '', model: product.model || '', categoryId: product.categoryId, brandId: product.brandId || '', priceValue: product.priceValue ?? '', stockStatus: product.stockStatus || 'in_stock', status: product.status || 'PUBLISHED', descriptionShort: product.descriptionShort || '', descriptionFull: product.descriptionFull || '' }); isProductModalOpen.value = true }
function productBody() { return { ...productForm, brandId: productForm.brandId || undefined, priceValue: productForm.priceValue !== '' ? Number(productForm.priceValue) : undefined } }
function productSources(product: AdminProduct) { return product.sourceProducts?.length ? product.sourceProducts.map(item => item.source?.name || item.url).join(', ') : 'Вручную' }

async function saveProduct() {
  try {
    if (editingId.value) await adminFetch(`/products/${editingId.value}`, { method: 'PATCH', body: productBody() })
    else await adminFetch('/products', { method: 'POST', body: productBody() })
    message(editingId.value ? 'Товар обновлен' : 'Товар создан')
    closeProductModal()
    await loadData()
  } catch (error) { message(error instanceof Error ? error.message : 'Не удалось сохранить товар', true) }
}

async function deleteProduct(id: string) { if (!confirm('Удалить товар?')) return; try { await adminFetch(`/products/${id}`, { method: 'DELETE' }); message('Товар удален'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось удалить товар', true) } }
async function applyFilters() { pagination.page = 1; await loadData() }
async function setPage(page: number) { pagination.page = page; await loadData() }

watch(() => productForm.name, value => { if (!editingId.value && !productForm.slug) productForm.slug = slugify(value) })
watch(isProductModalOpen, isOpen => {
  if (!import.meta.client) return
  document.body.style.overflow = isOpen ? 'hidden' : ''
})
onMounted(() => { loadToken(); void loadData() })
onBeforeUnmount(() => { if (import.meta.client) document.body.style.overflow = '' })
useHead({ title: 'Товары | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-page">
    <NuxtLink to="/admin" class="back-link">Админка</NuxtLink>
    <div class="page-head"><h1>Товары</h1><button type="button" @click="openCreateProduct">Новый товар</button></div>
    <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="notice success">{{ successMessage }}</div>

    <section class="admin-card">
      <div class="products-head"><div><h2>Список товаров</h2><p>{{ pagination.total }} всего, страница {{ pagination.page }} из {{ pagination.pages || 1 }}</p></div><form class="filters" @submit.prevent="applyFilters"><input v-model="filters.search" placeholder="Поиск"><select v-model="filters.categoryId"><option value="">Все категории</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select><select v-model="filters.brandId"><option value="">Все бренды</option><option v-for="brand in brands" :key="brand.id" :value="brand.id">{{ brand.name }}</option></select><select v-model="filters.status"><option value="">Все статусы</option><option value="DRAFT">Черновик</option><option value="PUBLISHED">Опубликован</option><option value="HIDDEN">Скрыт</option><option value="ARCHIVED">Архив</option></select><button type="submit">Найти</button></form></div>
      <div class="products-table"><div v-for="product in products" :key="product.id" class="product-row"><div><strong>{{ product.name }}</strong><span>{{ product.category?.name || 'Без категории' }} / {{ product.brand?.name || 'Без бренда' }} / {{ productSources(product) }}</span></div><span>{{ product.priceValue ?? 'без цены' }}</span><button type="button" class="ghost" @click="previewProduct = product">Просмотр</button><button type="button" class="ghost" @click="editProduct(product)">Править</button><button type="button" @click="deleteProduct(product.id)">Удалить</button></div></div>
      <div class="pagination"><button type="button" :disabled="pagination.page <= 1" @click="setPage(pagination.page - 1)">Назад</button><button type="button" :disabled="pagination.page >= pagination.pages" @click="setPage(pagination.page + 1)">Вперед</button></div>
    </section>

    <section v-if="previewProduct" class="admin-card preview-card">
      <div class="card-head"><h2>{{ previewProduct.name }}</h2><button type="button" class="ghost" @click="previewProduct = null">Закрыть</button></div>
      <div class="preview-grid"><div><span>slug</span><strong>{{ previewProduct.slug }}</strong></div><div><span>Категория</span><strong>{{ previewProduct.category?.name || 'Без категории' }}</strong></div><div><span>Бренд</span><strong>{{ previewProduct.brand?.name || 'Без бренда' }}</strong></div><div><span>Источник</span><strong>{{ productSources(previewProduct) }}</strong></div><div><span>Цена</span><strong>{{ previewProduct.priceValue ?? 'без цены' }}</strong></div><div v-if="previewProduct.sku"><span>Артикул</span><strong>{{ previewProduct.sku }}</strong></div><div v-if="previewProduct.model"><span>Модель</span><strong>{{ previewProduct.model }}</strong></div></div>
      <div v-if="previewProduct.sourceProducts?.length" class="source-links"><a v-for="item in previewProduct.sourceProducts" :key="item.id" :href="item.url" target="_blank" rel="noreferrer">{{ item.source?.name || item.url }}</a></div>
      <p>{{ previewProduct.descriptionShort || previewProduct.descriptionFull || 'Описание не заполнено.' }}</p>
      <NuxtLink :to="`/product/${previewProduct.slug}`" target="_blank">Открыть публичную карточку</NuxtLink>
    </section>

    <div v-if="isProductModalOpen" class="modal-backdrop" @click.self="closeProductModal">
      <form class="admin-card form-grid product-modal" @submit.prevent="saveProduct">
        <div class="card-head"><h2>{{ editingId ? 'Редактировать товар' : 'Новый товар' }}</h2><button type="button" class="ghost" @click="closeProductModal">Закрыть</button></div>
        <input v-model="productForm.name" required placeholder="Название"><input v-model="productForm.slug" required placeholder="slug">
        <div class="two-cols"><input v-model="productForm.sku" placeholder="Артикул"><input v-model="productForm.model" placeholder="Модель"></div>
        <select v-model="productForm.categoryId" required><option value="" disabled>Категория</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select>
        <select v-model="productForm.brandId"><option value="">Без бренда</option><option v-for="brand in brands" :key="brand.id" :value="brand.id">{{ brand.name }}</option></select>
        <div class="two-cols"><input v-model="productForm.priceValue" type="number" min="0" step="0.01" placeholder="Цена"><select v-model="productForm.stockStatus"><option value="in_stock">В наличии</option><option value="out_of_stock">Под заказ</option></select></div>
        <select v-model="productForm.status"><option value="DRAFT">Черновик</option><option value="PUBLISHED">Опубликован</option><option value="HIDDEN">Скрыт</option><option value="ARCHIVED">Архив</option></select>
        <textarea v-model="productForm.descriptionShort" placeholder="Короткое описание" /><textarea v-model="productForm.descriptionFull" placeholder="Полное описание" />
        <div class="modal-actions"><button type="button" class="ghost" @click="closeProductModal">Отмена</button><button type="submit">{{ editingId ? 'Сохранить' : 'Создать товар' }}</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped lang="scss">
.admin-page { display: grid; gap: 24px; } .back-link { width: max-content; font-weight: 900; text-decoration: none; } h1 { font-size: clamp(36px, 6vw, 68px); } .admin-card, .notice { border: 2px solid var(--color-ink); border-radius: 28px; background: rgba(255, 250, 240, 0.94); box-shadow: 7px 7px 0 var(--color-ink); padding: 22px; } .notice.error { color: var(--color-accent-strong); } .notice.success { color: var(--color-green); } .form-grid { display: grid; gap: 12px; } input, select, textarea { width: 100%; border: 1px solid var(--color-line); border-radius: 14px; background: white; padding: 12px 14px; } textarea { min-height: 92px; resize: vertical; } button { border: 2px solid var(--color-ink); border-radius: 999px; background: var(--color-accent); cursor: pointer; font-weight: 900; padding: 12px 16px; } button:disabled { cursor: not-allowed; opacity: 0.45; } .ghost { background: white; } .card-head, .products-head, .pagination { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; } .two-cols { display: grid; gap: 10px; @include media-breakpoint-up(md) { grid-template-columns: 1fr 1fr; } } .filters { display: grid; gap: 10px; width: min(100%, 760px); @include media-breakpoint-up(lg) { grid-template-columns: 1.4fr 1fr 1fr auto; } } .products-table { display: grid; gap: 10px; margin-top: 18px; } .product-row { display: grid; gap: 12px; align-items: center; border: 1px solid var(--color-line); border-radius: 18px; background: white; padding: 14px; @include media-breakpoint-up(lg) { grid-template-columns: minmax(0, 1fr) 120px auto auto auto; } span { display: block; margin-top: 4px; color: var(--color-muted); font-size: 13px; } a { font-weight: 900; text-decoration: none; } } .pagination { justify-content: center; margin-top: 18px; } .preview-card { display: grid; gap: 16px; } .preview-grid { display: grid; gap: 10px; @include media-breakpoint-up(md) { grid-template-columns: repeat(3, minmax(0, 1fr)); } div { border: 1px solid var(--color-line); border-radius: 16px; background: white; padding: 12px; } span { display: block; color: var(--color-muted); font-size: 12px; font-weight: 900; } strong { display: block; margin-top: 4px; } } .preview-card a { width: max-content; font-weight: 900; text-decoration: none; }
.page-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
.modal-backdrop { position: fixed; z-index: 50; inset: 0; display: grid; place-items: center; overflow: auto; background: rgba(22, 28, 45, 0.58); padding: 20px; }
.product-modal { width: min(100%, 820px); max-height: calc(100vh - 40px); overflow: auto; }
.modal-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.source-links { display: flex; flex-wrap: wrap; gap: 10px; }
.source-links a { border: 1px solid var(--color-line); border-radius: 999px; background: white; padding: 8px 12px; font-weight: 900; text-decoration: none; }
</style>
