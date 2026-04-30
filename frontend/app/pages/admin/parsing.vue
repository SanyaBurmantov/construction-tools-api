<script setup lang="ts">
type QueueStats = { queued: number, visited: number, failed?: number, skipped?: number, total: number }
type SitemapEntry = { id: string, url: string, isVisited: boolean }
type DukonSitemapEntry = { id: string, url: string, status: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED', attempts: number, lastError?: string | null, lastTriedAt?: string | null }
type ParserError = { url: string, message: string, createdAt: string }
type Source = { id: string, name: string, code: string, url: string }
type SitemapResponse = { data: SitemapEntry[], pagination: { page: number, limit: number, total: number, pages: number } }
type DukonSitemapResponse = { data: DukonSitemapEntry[], pagination: { page: number, limit: number, total: number, pages: number } }

const { token, loadToken, adminFetch } = useAdminApi()
const queueStats = ref<QueueStats | null>(null)
const dukonQueueStats = ref<QueueStats | null>(null)
const errors = ref<ParserError[]>([])
const sitemaps = ref<SitemapEntry[]>([])
const dukonSitemaps = ref<DukonSitemapEntry[]>([])
const sources = ref<Source[]>([])
const errorMessage = ref('')
const successMessage = ref('')
const importing = ref(false)
const pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const dukonPagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const filters = reactive({ search: '', isVisited: '' })
const dukonFilters = reactive({ search: '', status: '' })
const importForm = reactive({ sourceId: '', url: '' })

function message(value: string, isError = false) { errorMessage.value = isError ? value : ''; successMessage.value = isError ? '' : value }
function queryString() { const query = new URLSearchParams(); if (filters.search) query.set('search', filters.search); if (filters.isVisited !== '') query.set('isVisited', filters.isVisited); query.set('page', String(pagination.page)); query.set('limit', String(pagination.limit)); return `?${query}` }
function dukonQueryString() { const query = new URLSearchParams(); if (dukonFilters.search) query.set('search', dukonFilters.search); if (dukonFilters.status) query.set('status', dukonFilters.status); query.set('page', String(dukonPagination.page)); query.set('limit', String(dukonPagination.limit)); return `?${query}` }

async function loadData() {
  if (!token.value) return
  try {
    const [nextQueue, nextDukonQueue, nextErrors, nextSitemaps, nextDukonSitemaps, nextSources] = await Promise.all([
      adminFetch<QueueStats>('/queue'),
      adminFetch<QueueStats>('/queue/dukon'),
      adminFetch<ParserError[]>('/queue/errors'),
      adminFetch<SitemapResponse>(`/queue/sitemaps${queryString()}`),
      adminFetch<DukonSitemapResponse>(`/queue/dukon/sitemaps${dukonQueryString()}`),
      adminFetch<Source[]>('/sources')
    ])
    queueStats.value = nextQueue
    dukonQueueStats.value = nextDukonQueue
    errors.value = nextErrors
    sitemaps.value = nextSitemaps.data
    dukonSitemaps.value = nextDukonSitemaps.data
    sources.value = nextSources
    if (!importForm.sourceId && nextSources.length === 1) importForm.sourceId = nextSources[0].id
    Object.assign(pagination, nextSitemaps.pagination)
    Object.assign(dukonPagination, nextDukonSitemaps.pagination)
  } catch (error) {
    message(error instanceof Error ? error.message : 'Не удалось загрузить парсинг', true)
  }
}

async function refreshSitemaps() { try { queueStats.value = await adminFetch<QueueStats>('/queue/refresh-sitemaps', { method: 'POST' }); message('Sitemap загружен'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить sitemap', true) } }
async function processQueue() { try { queueStats.value = await adminFetch<QueueStats>('/queue/process', { method: 'POST', body: { limit: 25 } }); message('Очередь обработана'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось обработать очередь', true) } }
async function refreshDukonSitemaps() { try { dukonQueueStats.value = await adminFetch<QueueStats>('/queue/dukon/refresh-sitemaps', { method: 'POST' }); message('Dukon sitemap загружен'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить Dukon sitemap', true) } }
async function processDukonQueue() { try { dukonQueueStats.value = await adminFetch<QueueStats>('/queue/dukon/process', { method: 'POST', body: { limit: 25 } }); message('Dukon очередь обработана'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось обработать Dukon очередь', true) } }
async function retryDukonSitemap(id: string) { try { await adminFetch(`/queue/dukon/sitemaps/${id}/retry`, { method: 'POST' }); message('Dukon URL возвращен в очередь'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось вернуть Dukon URL в очередь', true) } }
async function clearErrors() { try { await adminFetch('/queue/errors', { method: 'DELETE' }); message('Ошибки очищены'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось очистить ошибки', true) } }
async function importProduct() { if (!importForm.sourceId || !importForm.url) return; importing.value = true; try { const result = await adminFetch<{ product: { name: string } }>('/source-products/import', { method: 'POST', body: importForm }); message(`Товар добавлен: ${result.product.name}`); importForm.url = ''; await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось добавить товар из источника', true) } finally { importing.value = false } }
async function applyFilters() { pagination.page = 1; await loadData() }
async function setPage(page: number) { pagination.page = page; await loadData() }
async function applyDukonFilters() { dukonPagination.page = 1; await loadData() }
async function setDukonPage(page: number) { dukonPagination.page = page; await loadData() }

onMounted(() => { loadToken(); void loadData() })
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
      <div class="section-head"><div><h2>Dukon.by</h2><p class="muted">Очередь Dukon: {{ dukonQueueStats?.queued || 0 }} в очереди, {{ dukonQueueStats?.visited || 0 }} обработано, {{ dukonQueueStats?.failed || 0 }} ошибок, {{ dukonQueueStats?.skipped || 0 }} пропущено, {{ dukonQueueStats?.total || 0 }} всего.</p></div><div class="actions"><button type="button" @click="refreshDukonSitemaps">Загрузить Dukon sitemap</button><button type="button" @click="processDukonQueue">Обработать 25 Dukon</button></div></div>
      <form class="filters dukon-filters" @submit.prevent="applyDukonFilters"><input v-model="dukonFilters.search" placeholder="Поиск Dukon URL"><select v-model="dukonFilters.status"><option value="">Все статусы</option><option value="PENDING">В очереди</option><option value="DONE">Готово</option><option value="FAILED">Ошибка</option><option value="SKIPPED">Пропущено</option></select><button type="submit">Найти</button></form>
      <div class="list"><div v-for="item in dukonSitemaps" :key="item.id" class="dukon-row"><div><a :href="item.url" target="_blank" rel="noreferrer">{{ item.url }}</a><small v-if="item.lastError">{{ item.lastError }}</small></div><span :class="item.status.toLowerCase()">{{ item.status }}</span><strong>{{ item.attempts }}</strong><button v-if="item.status === 'FAILED' || item.status === 'SKIPPED'" type="button" class="ghost" @click="retryDukonSitemap(item.id)">Повторить</button></div></div>
      <div class="pagination"><button type="button" :disabled="dukonPagination.page <= 1" @click="setDukonPage(dukonPagination.page - 1)">Назад</button><span>{{ dukonPagination.page }} / {{ dukonPagination.pages || 1 }}</span><button type="button" :disabled="dukonPagination.page >= dukonPagination.pages" @click="setDukonPage(dukonPagination.page + 1)">Вперед</button></div>
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

<style scoped lang="scss">.admin-page{display:grid;gap:24px}.back-link{width:max-content;font-weight:900;text-decoration:none}h1{font-size:clamp(36px,6vw,68px)}.admin-card,.stats-grid>div,.notice{border:2px solid var(--color-ink);border-radius:28px;background:rgba(255,250,240,.94);box-shadow:7px 7px 0 var(--color-ink);padding:22px}.notice.error{color:var(--color-accent-strong)}.notice.success{color:var(--color-green)}.stats-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));strong{font-family:var(--font-heading);font-size:34px}span{color:var(--color-muted);font-weight:900}}.actions,.section-head,.pagination{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.filters{display:grid;gap:10px;width:min(100%,640px);@include media-breakpoint-up(md){grid-template-columns:1fr 150px auto}}.dukon-filters{margin-top:16px}.source-import{display:grid;gap:10px;margin-top:16px;@include media-breakpoint-up(md){grid-template-columns:240px minmax(0,1fr) auto}}input,select{width:100%;border:1px solid var(--color-line);border-radius:14px;background:white;padding:12px 14px}button{border:2px solid var(--color-ink);border-radius:999px;background:var(--color-accent);cursor:pointer;font-weight:900;padding:12px 16px}button:disabled{cursor:not-allowed;opacity:.45}.ghost{background:white}.list{display:grid;gap:10px;margin-top:16px}.row,.error-row,.dukon-row{display:grid;gap:8px;border:1px solid var(--color-line);border-radius:18px;background:white;padding:14px;word-break:break-all;@include media-breakpoint-up(md){grid-template-columns:minmax(0,1fr) auto}}.dukon-row{@include media-breakpoint-up(md){grid-template-columns:minmax(0,1fr) auto 70px auto}small{display:block;margin-top:6px;color:var(--color-accent-strong);font-weight:800}}.row span,.dukon-row span{border-radius:999px;background:rgba(222,77,47,.14);color:var(--color-accent-strong);font-weight:900;padding:6px 10px}.row span.done,.dukon-row span.done{background:rgba(45,125,70,.14);color:var(--color-green)}.dukon-row span.pending{background:rgba(243,182,31,.22);color:var(--color-ink)}.dukon-row span.skipped{background:rgba(120,120,120,.14);color:var(--color-muted)}.error-row{border-color:rgba(222,77,47,.35);strong{color:var(--color-accent-strong)}small{color:var(--color-muted)}}.muted{color:var(--color-muted);font-weight:800}</style>
