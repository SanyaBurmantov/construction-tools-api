<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type QueueStats ={ queued: number, visited: number, failed?: number, skipped?: number, total: number }
type SitemapEntry = { id: string, url: string, isVisited: boolean }
type DukonSitemapEntry = { id: string, url: string, status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED', attempts: number, lastError?: string | null, lastTriedAt?: string | null }
type Supplier7745SitemapEntry = DukonSitemapEntry
type ParserError = { url: string, message: string, createdAt: string }
type RuntimeStatus = { key: string, label: string, isRunning: boolean, startedAt: string | null, finishedAt: string | null, lastSuccessAt: string | null, lastErrorAt: string | null, lastError: string | null, runs: number, successes: number, failures: number }
type Source = { id: string, name: string, code: string, url: string }
type SupplierSummary = { source: { id: string, name: string, code: string }, total: number, published: number, draft: number, hidden: number, archived: number, withoutPrice: number, withoutImages: number, withoutSku: number }
type SitemapResponse = { data: SitemapEntry[], pagination: { page: number, limit: number, total: number, pages: number } }
type DukonSitemapResponse = { data: DukonSitemapEntry[], pagination: { page: number, limit: number, total: number, pages: number } }
type Supplier7745SitemapResponse = { data: Supplier7745SitemapEntry[], pagination: { page: number, limit: number, total: number, pages: number } }
type BulkRetryResponse = { count: number }
type ProductRef = { id: string, name: string, slug: string }
type DuplicateGroup = { key: string, products: Array<ProductRef & { sources: string[] }> }
type DataQualityReport = {
  generatedAt: string
  summary: { publishedProducts: number, totalProducts: number, withoutImages: number, withoutPrice: number, withoutSpecs: number, withoutBrand: number, inFallbackCategory: number, staleProducts: number, staleDays: number, duplicateGroups: number, allCapsNames: number }
  samples: { withoutImages: ProductRef[], withoutPrice: ProductRef[], withoutSpecs: ProductRef[], inFallbackCategory: ProductRef[], stale: ProductRef[], allCapsNames: ProductRef[], duplicates: DuplicateGroup[] }
}

const { token, loadToken, adminFetch } = useAdminApi()
const queueStats = ref<QueueStats | null>(null)
const dukonQueueStats = ref<QueueStats | null>(null)
const supplier7745QueueStats = ref<QueueStats | null>(null)
const errors = ref<ParserError[]>([])
const runtimeStatuses = ref<RuntimeStatus[]>([])
const supplierSummary = ref<SupplierSummary[]>([])
const sitemaps = ref<SitemapEntry[]>([])
const dukonSitemaps = ref<DukonSitemapEntry[]>([])
const supplier7745Sitemaps = ref<Supplier7745SitemapEntry[]>([])
const sources = ref<Source[]>([])
const errorMessage = ref('')
const successMessage = ref('')
const importing = ref(false)
const pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const dukonPagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const supplier7745Pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const filters = reactive({ search: '', isVisited: '' })
const dukonFilters = reactive({ search: '', status: 'PROBLEM' })
const supplier7745Filters = reactive({ search: '', status: 'PROBLEM' })
const importForm = reactive({ sourceId: '', url: '' })

function message(value: string, isError = false) { errorMessage.value = isError ? value : ''; successMessage.value = isError ? '' : value }
function queryString() { const query = new URLSearchParams(); if (filters.search) query.set('search', filters.search); if (filters.isVisited !== '') query.set('isVisited', filters.isVisited); query.set('page', String(pagination.page)); query.set('limit', String(pagination.limit)); return `?${query}` }
function dukonQueryString() { const query = new URLSearchParams(); if (dukonFilters.search) query.set('search', dukonFilters.search); if (dukonFilters.status) query.set('status', dukonFilters.status); query.set('page', String(dukonPagination.page)); query.set('limit', String(dukonPagination.limit)); return `?${query}` }
function supplier7745QueryString() { const query = new URLSearchParams(); if (supplier7745Filters.search) query.set('search', supplier7745Filters.search); if (supplier7745Filters.status) query.set('status', supplier7745Filters.status); query.set('page', String(supplier7745Pagination.page)); query.set('limit', String(supplier7745Pagination.limit)); return `?${query}` }

async function loadData() {
  if (!token.value) return
  try {
    const [nextQueue, nextDukonQueue, next7745Queue, nextErrors, nextRuntimeStatuses, nextSupplierSummary, nextSitemaps, nextDukonSitemaps, next7745Sitemaps, nextSources] = await Promise.all([
      adminFetch<QueueStats>('/queue'),
      adminFetch<QueueStats>('/queue/dukon'),
      adminFetch<QueueStats>('/queue/7745'),
      adminFetch<ParserError[]>('/queue/errors'),
      adminFetch<RuntimeStatus[]>('/queue/runtime-status'),
      adminFetch<SupplierSummary[]>('/queue/supplier-summary'),
      adminFetch<SitemapResponse>(`/queue/sitemaps${queryString()}`),
      adminFetch<DukonSitemapResponse>(`/queue/dukon/sitemaps${dukonQueryString()}`),
      adminFetch<Supplier7745SitemapResponse>(`/queue/7745/sitemaps${supplier7745QueryString()}`),
      adminFetch<Source[]>('/sources')
    ])
    queueStats.value = nextQueue
    dukonQueueStats.value = nextDukonQueue
    supplier7745QueueStats.value = next7745Queue
    errors.value = nextErrors
    runtimeStatuses.value = nextRuntimeStatuses
    supplierSummary.value = nextSupplierSummary
    sitemaps.value = nextSitemaps.data
    dukonSitemaps.value = nextDukonSitemaps.data
    supplier7745Sitemaps.value = next7745Sitemaps.data
    sources.value = nextSources
    if (!importForm.sourceId && nextSources.length === 1) importForm.sourceId = nextSources[0].id
    Object.assign(pagination, nextSitemaps.pagination)
    Object.assign(dukonPagination, nextDukonSitemaps.pagination)
    Object.assign(supplier7745Pagination, next7745Sitemaps.pagination)
  } catch (error) {
    message(error instanceof Error ? error.message : 'Не удалось загрузить парсинг', true)
  }
}

async function refreshSitemaps() { try { queueStats.value = await adminFetch<QueueStats>('/queue/refresh-sitemaps', { method: 'POST' }); message('Sitemap загружен'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить sitemap', true) } }
async function processQueue() { try { queueStats.value = await adminFetch<QueueStats>('/queue/process', { method: 'POST', body: { limit: 25 } }); message('Очередь обработана'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось обработать очередь', true) } }
async function refreshDukonSitemaps() { try { dukonQueueStats.value = await adminFetch<QueueStats>('/queue/dukon/refresh-sitemaps', { method: 'POST' }); message('Dukon sitemap загружен'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить Dukon sitemap', true) } }
async function processDukonQueue() { try { dukonQueueStats.value = await adminFetch<QueueStats>('/queue/dukon/process', { method: 'POST', body: { limit: 25 } }); message('Dukon очередь обработана'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось обработать Dukon очередь', true) } }
async function retryDukonSitemap(id: string) { try { await adminFetch(`/queue/dukon/sitemaps/${id}/retry`, { method: 'POST' }); message('Dukon URL возвращен в очередь'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось вернуть Dukon URL в очередь', true) } }
async function retryProblemDukonSitemaps() { try { const result = await adminFetch<BulkRetryResponse>('/queue/dukon/sitemaps/retry-problems', { method: 'POST' }); message(`В очередь возвращено Dukon URL: ${result.count}`); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось вернуть проблемные Dukon URL в очередь', true) } }
async function refresh7745Sitemaps() { try { supplier7745QueueStats.value = await adminFetch<QueueStats>('/queue/7745/refresh-sitemaps', { method: 'POST' }); message('7745 sitemap загружен'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить 7745 sitemap', true) } }
async function process7745Queue() { try { supplier7745QueueStats.value = await adminFetch<QueueStats>('/queue/7745/process', { method: 'POST', body: { limit: 25 } }); message('7745 очередь обработана'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось обработать 7745 очередь', true) } }
async function retry7745Sitemap(id: string) { try { await adminFetch(`/queue/7745/sitemaps/${id}/retry`, { method: 'POST' }); message('7745 URL возвращен в очередь'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось вернуть 7745 URL в очередь', true) } }
async function retryProblem7745Sitemaps() { try { const result = await adminFetch<BulkRetryResponse>('/queue/7745/sitemaps/retry-problems', { method: 'POST' }); message(`В очередь возвращено 7745 URL: ${result.count}`); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось вернуть проблемные 7745 URL в очередь', true) } }
async function clearErrors() { try { await adminFetch('/queue/errors', { method: 'DELETE' }); message('Ошибки очищены'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось очистить ошибки', true) } }
async function importProduct() { if (!importForm.sourceId || !importForm.url) return; importing.value = true; try { const result = await adminFetch<{ product: { name: string } }>('/source-products/import', { method: 'POST', body: importForm }); message(`Товар добавлен: ${result.product.name}`); importForm.url = ''; await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось добавить товар из источника', true) } finally { importing.value = false } }
const dataQuality = ref<DataQualityReport | null>(null)
const dataQualityLoading = ref(false)
// отчёт тяжёлый (скан имён всего каталога) — грузим отдельно от loadData
async function loadDataQuality() {
  if (!token.value) return
  dataQualityLoading.value = true
  try { dataQuality.value = await adminFetch<DataQualityReport>('/data-quality') } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить отчёт качества', true) } finally { dataQualityLoading.value = false }
}
const qualityMetrics = computed(() => {
  const summary = dataQuality.value?.summary
  if (!summary) return []
  return [
    { key: 'withoutImages', label: 'Без фото', count: summary.withoutImages, items: dataQuality.value!.samples.withoutImages },
    { key: 'withoutPrice', label: 'Без цены', count: summary.withoutPrice, items: dataQuality.value!.samples.withoutPrice },
    { key: 'withoutSpecs', label: 'Без характеристик', count: summary.withoutSpecs, items: dataQuality.value!.samples.withoutSpecs },
    { key: 'inFallbackCategory', label: 'Неразобранная категория', count: summary.inFallbackCategory, items: dataQuality.value!.samples.inFallbackCategory },
    { key: 'stale', label: `Не обновлялись > ${summary.staleDays} дн.`, count: summary.staleProducts, items: dataQuality.value!.samples.stale },
    { key: 'allCaps', label: 'Название КАПСОМ', count: summary.allCapsNames, items: dataQuality.value!.samples.allCapsNames }
  ]
})

async function applyFilters() { pagination.page = 1; await loadData() }
async function setPage(page: number) { pagination.page = page; await loadData() }
async function applyDukonFilters() { dukonPagination.page = 1; await loadData() }
async function setDukonPage(page: number) { dukonPagination.page = page; await loadData() }
async function apply7745Filters() { supplier7745Pagination.page = 1; await loadData() }
async function set7745Page(page: number) { supplier7745Pagination.page = page; await loadData() }

onMounted(() => { loadToken(); void loadData(); void loadDataQuality() })
useHead({ title: 'Парсинг | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-page">
    <NuxtLink to="/admin" class="back-link">Админка</NuxtLink>
    <h1>Парсинг</h1>
    <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>
    <div v-if="successMessage" class="notice success">{{ successMessage }}</div>

    <section class="stats-grid">
      <div><strong>{{ queueStats?.total || 0 }}</strong><span>всего ссылок</span></div>
      <div><strong>{{ queueStats?.queued || 0 }}</strong><span>в очереди</span></div>
      <div><strong>{{ queueStats?.visited || 0 }}</strong><span>обработано</span></div>
      <div><strong>{{ errors.length }}</strong><span>ошибок</span></div>
    </section>

    <section class="admin-card actions">
      <button type="button" @click="refreshSitemaps">Загрузить sitemap</button>
      <button type="button" @click="processQueue">Обработать 25 товаров</button>
      <button type="button" class="ghost" @click="clearErrors">Очистить ошибки</button>
    </section>

    <section class="admin-card">
      <div class="section-head"><div><h2>Cron status</h2><p class="muted">Последние runtime-запуски парсеров в текущем backend процессе.</p></div></div>
      <div class="list"><div v-for="item in runtimeStatuses" :key="item.key" class="dukon-row"><div><strong>{{ item.label }}</strong><small v-if="item.lastError">{{ item.lastError }}</small><small v-else>last success: {{ item.lastSuccessAt || 'еще не было' }}</small></div><span :class="{ done: !item.isRunning && !item.lastError }">{{ item.isRunning ? 'RUNNING' : item.lastError ? 'ERROR' : 'OK' }}</span><small>{{ item.successes }}/{{ item.runs }} успешных</small></div><p v-if="!runtimeStatuses.length" class="muted">Cron еще не запускался после старта backend.</p></div>
    </section>

    <section class="admin-card">
      <div class="section-head">
        <div><h2>Качество данных</h2><p class="muted">Опубликовано {{ dataQuality?.summary.publishedProducts ?? '—' }} из {{ dataQuality?.summary.totalProducts ?? '—' }} товаров. Отчёт: {{ dataQuality ? new Date(dataQuality.generatedAt).toLocaleString('ru') : '…' }}</p></div>
        <button type="button" class="ghost" :disabled="dataQualityLoading" @click="loadDataQuality">{{ dataQualityLoading ? 'Считаем…' : 'Обновить отчёт' }}</button>
      </div>
      <div v-if="dataQuality" class="quality-grid">
        <details v-for="metric in qualityMetrics" :key="metric.key" class="quality-item" :class="{ ok: metric.count === 0 }">
          <summary><strong>{{ metric.count }}</strong><span>{{ metric.label }}</span></summary>
          <ul v-if="metric.items.length">
            <li v-for="item in metric.items" :key="item.id">
              <a :href="`/product/${item.slug}`" target="_blank" rel="noreferrer">{{ item.name }}</a>
            </li>
            <li v-if="metric.count > metric.items.length" class="muted">… и ещё {{ metric.count - metric.items.length }}</li>
          </ul>
          <p v-else class="muted">Проблем нет.</p>
        </details>
        <details class="quality-item" :class="{ ok: !dataQuality.summary.duplicateGroups }">
          <summary><strong>{{ dataQuality.summary.duplicateGroups }}</strong><span>Возможные дубли</span></summary>
          <ul v-if="dataQuality.samples.duplicates.length">
            <li v-for="group in dataQuality.samples.duplicates" :key="group.key" class="dup-group">
              <strong>{{ group.key }}</strong>
              <a v-for="item in group.products" :key="item.id" :href="`/product/${item.slug}`" target="_blank" rel="noreferrer">
                {{ item.name }} <small v-if="item.sources.length">({{ item.sources.join(', ') }})</small>
              </a>
            </li>
          </ul>
          <p v-else class="muted">Дубликатов не найдено.</p>
        </details>
      </div>
      <p v-else class="muted">{{ dataQualityLoading ? 'Считаем отчёт…' : 'Отчёт ещё не загружен.' }}</p>
    </section>

    <section class="admin-card">
      <div class="section-head"><div><h2>Качество каталога по источникам</h2><p class="muted">Сколько товаров поставщика видно на витрине и где не хватает базовых данных.</p></div></div>
      <div class="list"><div v-for="item in supplierSummary" :key="item.source.id" class="dukon-row"><div><strong>{{ item.source.name }} ({{ item.source.code }})</strong><small>{{ item.total }} всего, {{ item.published }} опубликовано, {{ item.draft }} черновиков, {{ item.hidden }} скрыто, {{ item.archived }} архив</small></div><span :class="{ done: item.draft === 0 && item.withoutImages === 0 }">{{ item.draft === 0 ? 'VISIBLE' : 'DRAFTS' }}</span><small>без фото: {{ item.withoutImages }} / без цены: {{ item.withoutPrice }} / без SKU: {{ item.withoutSku }}</small></div><p v-if="!supplierSummary.length" class="muted">Источников пока нет.</p></div>
    </section>

    <section class="admin-card">
      <div class="section-head"><div><h2>Dukon.by</h2><p class="muted">Очередь Dukon: {{ dukonQueueStats?.queued || 0 }} в очереди, {{ dukonQueueStats?.visited || 0 }} обработано, {{ dukonQueueStats?.failed || 0 }} ошибок, {{ dukonQueueStats?.skipped || 0 }} пропущено, {{ dukonQueueStats?.total || 0 }} всего.</p></div><div class="actions"><button type="button" @click="refreshDukonSitemaps">Загрузить Dukon sitemap</button><button type="button" @click="processDukonQueue">Обработать 25 Dukon</button><button type="button" class="ghost" @click="retryProblemDukonSitemaps">Повторить проблемные</button></div></div>
      <form class="filters dukon-filters" @submit.prevent="applyDukonFilters"><input v-model="dukonFilters.search" placeholder="Поиск Dukon URL"><select v-model="dukonFilters.status"><option value="PROBLEM">Проблемные</option><option value="">Все статусы</option><option value="PENDING">В очереди</option><option value="DONE">Готово</option><option value="FAILED">Ошибка</option><option value="SKIPPED">Пропущено</option></select><button type="submit">Найти</button></form>
      <div class="list"><div v-for="item in dukonSitemaps" :key="item.id" class="dukon-row"><div><a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a><small v-if="item.lastError">{{ item.lastError }}</small></div><span :class="item.status.toLowerCase()">{{ item.status }}</span><strong>{{ item.attempts }}</strong><button v-if="item.status === 'FAILED' || item.status === 'SKIPPED'" type="button" class="ghost" @click="retryDukonSitemap(item.id)">Повторить</button></div></div>
      <div class="pagination"><button type="button" :disabled="dukonPagination.page <= 1" @click="setDukonPage(dukonPagination.page - 1)">Назад</button><span>{{ dukonPagination.page }} / {{ dukonPagination.pages || 1 }}</span><button type="button" :disabled="dukonPagination.page >= dukonPagination.pages" @click="setDukonPage(dukonPagination.page + 1)">Вперед</button></div>
    </section>

    <section class="admin-card">
      <div class="section-head"><div><h2>7745.by</h2><p class="muted">Очередь 7745: {{ supplier7745QueueStats?.queued || 0 }} в очереди, {{ supplier7745QueueStats?.visited || 0 }} обработано, {{ supplier7745QueueStats?.failed || 0 }} ошибок, {{ supplier7745QueueStats?.skipped || 0 }} пропущено, {{ supplier7745QueueStats?.total || 0 }} всего.</p></div><div class="actions"><button type="button" @click="refresh7745Sitemaps">Загрузить 7745 sitemap</button><button type="button" @click="process7745Queue">Обработать 25 7745</button><button type="button" class="ghost" @click="retryProblem7745Sitemaps">Повторить проблемные</button></div></div>
      <form class="filters dukon-filters" @submit.prevent="apply7745Filters"><input v-model="supplier7745Filters.search" placeholder="Поиск 7745 URL"><select v-model="supplier7745Filters.status"><option value="PROBLEM">Проблемные</option><option value="">Все статусы</option><option value="PENDING">В очереди</option><option value="DONE">Готово</option><option value="FAILED">Ошибка</option><option value="SKIPPED">Пропущено</option></select><button type="submit">Найти</button></form>
      <div class="list"><div v-for="item in supplier7745Sitemaps" :key="item.id" class="dukon-row"><div><a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a><small v-if="item.lastError">{{ item.lastError }}</small></div><span :class="item.status.toLowerCase()">{{ item.status }}</span><strong>{{ item.attempts }}</strong><button v-if="item.status === 'FAILED' || item.status === 'SKIPPED'" type="button" class="ghost" @click="retry7745Sitemap(item.id)">Повторить</button></div></div>
      <div class="pagination"><button type="button" :disabled="supplier7745Pagination.page <= 1" @click="set7745Page(supplier7745Pagination.page - 1)">Назад</button><span>{{ supplier7745Pagination.page }} / {{ supplier7745Pagination.pages || 1 }}</span><button type="button" :disabled="supplier7745Pagination.page >= supplier7745Pagination.pages" @click="set7745Page(supplier7745Pagination.page + 1)">Вперед</button></div>
    </section>

    <section class="admin-card">
      <div class="section-head"><div><h2>Добавление товара из источника</h2><p class="muted">Выберите источник, вставьте ссылку на товар, и он будет спарсен в каталог.</p></div></div>
      <form class="source-import" @submit.prevent="importProduct">
        <select v-model="importForm.sourceId" required>
          <option value="" disabled>Источник</option>
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
        </select>
        <input v-if="importForm.sourceId" v-model="importForm.url" type="url" required placeholder="Ссылка на товар">
        <button type="submit" :disabled="importing || !importForm.sourceId || !importForm.url">{{ importing ? 'Парсим...' : 'Добавить товар' }}</button>
      </form>
      <p v-if="!sources.length" class="muted">Источники не найдены. Сначала добавьте источник в базе/API.</p>
    </section>

    <section class="admin-card">
      <div class="section-head"><h2>Ссылки sitemap</h2><form class="filters" @submit.prevent="applyFilters"><input v-model="filters.search" placeholder="Поиск по URL"><select v-model="filters.isVisited"><option value="">Все</option><option value="false">В очереди</option><option value="true">Обработано</option></select><button type="submit">Найти</button></form></div>
      <div class="list"><div v-for="item in sitemaps" :key="item.id" class="row"><a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a><span :class="{ done: item.isVisited }">{{ item.isVisited ? 'обработано' : 'в очереди' }}</span></div></div>
      <div class="pagination"><button type="button" :disabled="pagination.page <= 1" @click="setPage(pagination.page - 1)">Назад</button><span>{{ pagination.page }} / {{ pagination.pages || 1 }}</span><button type="button" :disabled="pagination.page >= pagination.pages" @click="setPage(pagination.page + 1)">Вперед</button></div>
    </section>

    <section class="admin-card">
      <h2>Логи ошибок парсинга</h2>
      <div class="list"><div v-for="entry in errors" :key="`${entry.createdAt}-${entry.url}`" class="error-row"><strong>{{ entry.message }}</strong><a :href="entry.url" target="_blank" rel="noreferrer">{{ entry.url }}</a><small>{{ entry.createdAt }}</small></div><p v-if="!errors.length" class="muted">Ошибок пока нет.</p></div>
    </section>
  </div>
</template>

<style scoped lang="scss">.admin-page{display:grid;gap:24px}.back-link{width:max-content;font-weight:900;text-decoration:none}h1{font-size:clamp(36px,6vw,68px)}.admin-card,.stats-grid>div,.notice{border:2px solid var(--color-ink);border-radius:28px;background:rgba(255,250,240,.94);box-shadow:7px 7px 0 var(--color-ink);padding:22px}.notice.error{color:var(--color-accent-strong)}.notice.success{color:var(--color-green)}.stats-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));strong{font-family:var(--font-heading);font-size:34px}span{color:var(--color-muted);font-weight:900}}.actions,.section-head,.pagination{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.filters{display:grid;gap:10px;width:min(100%,640px);@include media-breakpoint-up(md){grid-template-columns:1fr 150px auto}}.dukon-filters{margin-top:16px}.source-import{display:grid;gap:10px;margin-top:16px;@include media-breakpoint-up(md){grid-template-columns:240px minmax(0,1fr) auto}}input,select{width:100%;border:1px solid var(--color-line);border-radius:14px;background:white;padding:12px 14px}button{border:2px solid var(--color-ink);border-radius:999px;background:var(--color-accent);cursor:pointer;font-weight:900;padding:12px 16px}button:disabled{cursor:not-allowed;opacity:.45}.ghost{background:white}.list{display:grid;gap:10px;margin-top:16px}.row,.error-row,.dukon-row{display:grid;gap:8px;border:1px solid var(--color-line);border-radius:18px;background:white;padding:14px;word-break:break-all;@include media-breakpoint-up(md){grid-template-columns:minmax(0,1fr) auto}}.dukon-row{@include media-breakpoint-up(md){grid-template-columns:minmax(0,1fr) auto 70px auto}small{display:block;margin-top:6px;color:var(--color-accent-strong);font-weight:800}}.row span,.dukon-row span{border-radius:999px;background:rgba(222,77,47,.14);color:var(--color-accent-strong);font-weight:900;padding:6px 10px}.row span.done,.dukon-row span.done{background:rgba(45,125,70,.14);color:var(--color-green)}.dukon-row span.pending{background:rgba(243,182,31,.22);color:var(--color-ink)}.dukon-row span.skipped{background:rgba(120,120,120,.14);color:var(--color-muted)}.error-row{border-color:rgba(222,77,47,.35);strong{color:var(--color-accent-strong)}small{color:var(--color-muted)}}.muted{color:var(--color-muted);font-weight:800}.quality-grid{display:grid;gap:10px;margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.quality-item{border:1px solid var(--color-line);border-radius:18px;background:white;padding:12px 14px;summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;strong{font-family:var(--font-heading);font-size:26px;color:var(--color-accent-strong)}span{color:var(--color-muted);font-weight:800}}ul{display:grid;gap:6px;margin:10px 0 0;padding:0;list-style:none;max-height:240px;overflow-y:auto}a{font-weight:700;word-break:break-word}}.quality-item.ok summary strong{color:var(--color-green)}.dup-group{display:grid;gap:4px;border-top:1px dashed var(--color-line);padding-top:8px;a{display:block}small{color:var(--color-muted)}}</style>
