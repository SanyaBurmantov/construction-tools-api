<script setup lang="ts">
type QueueStats = { queued: number, visited: number, total: number }
type SitemapEntry = { id: string, url: string, isVisited: boolean }
type ParserError = { url: string, message: string, createdAt: string }
type SitemapResponse = { data: SitemapEntry[], pagination: { page: number, limit: number, total: number, pages: number } }

const { token, loadToken, adminFetch } = useAdminApi()
const queueStats = ref<QueueStats | null>(null)
const errors = ref<ParserError[]>([])
const sitemaps = ref<SitemapEntry[]>([])
const errorMessage = ref('')
const successMessage = ref('')
const pagination = reactive({ page: 1, limit: 25, total: 0, pages: 0 })
const filters = reactive({ search: '', isVisited: '' })

function message(value: string, isError = false) { errorMessage.value = isError ? value : ''; successMessage.value = isError ? '' : value }
function queryString() { const query = new URLSearchParams(); if (filters.search) query.set('search', filters.search); if (filters.isVisited !== '') query.set('isVisited', filters.isVisited); query.set('page', String(pagination.page)); query.set('limit', String(pagination.limit)); return `?${query}` }

async function loadData() {
  if (!token.value) return
  try {
    const [nextQueue, nextErrors, nextSitemaps] = await Promise.all([
      adminFetch<QueueStats>('/queue'),
      adminFetch<ParserError[]>('/queue/errors'),
      adminFetch<SitemapResponse>(`/queue/sitemaps${queryString()}`)
    ])
    queueStats.value = nextQueue
    errors.value = nextErrors
    sitemaps.value = nextSitemaps.data
    Object.assign(pagination, nextSitemaps.pagination)
  } catch (error) {
    message(error instanceof Error ? error.message : 'Не удалось загрузить парсинг', true)
  }
}

async function refreshSitemaps() { try { queueStats.value = await adminFetch<QueueStats>('/queue/refresh-sitemaps', { method: 'POST' }); message('Sitemap загружен'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить sitemap', true) } }
async function processQueue() { try { queueStats.value = await adminFetch<QueueStats>('/queue/process', { method: 'POST', body: { limit: 25 } }); message('Очередь обработана'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось обработать очередь', true) } }
async function clearErrors() { try { await adminFetch('/queue/errors', { method: 'DELETE' }); message('Ошибки очищены'); await loadData() } catch (error) { message(error instanceof Error ? error.message : 'Не удалось очистить ошибки', true) } }
async function applyFilters() { pagination.page = 1; await loadData() }
async function setPage(page: number) { pagination.page = page; await loadData() }

onMounted(() => { loadToken(); void loadData() })
useHead({ title: 'Парсинг | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-page">
    <NuxtLink to="/admin/" class="back-link">Админка</NuxtLink>
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

<style scoped lang="scss">.admin-page{display:grid;gap:24px}.back-link{width:max-content;font-weight:900;text-decoration:none}h1{font-size:clamp(36px,6vw,68px)}.admin-card,.stats-grid>div,.notice{border:2px solid var(--color-ink);border-radius:28px;background:rgba(255,250,240,.94);box-shadow:7px 7px 0 var(--color-ink);padding:22px}.notice.error{color:var(--color-accent-strong)}.notice.success{color:var(--color-green)}.stats-grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));strong{font-family:var(--font-heading);font-size:34px}span{color:var(--color-muted);font-weight:900}}.actions,.section-head,.pagination{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.filters{display:grid;gap:10px;width:min(100%,640px);@include media-breakpoint-up(md){grid-template-columns:1fr 150px auto}}input,select{width:100%;border:1px solid var(--color-line);border-radius:14px;background:white;padding:12px 14px}button{border:2px solid var(--color-ink);border-radius:999px;background:var(--color-accent);cursor:pointer;font-weight:900;padding:12px 16px}button:disabled{cursor:not-allowed;opacity:.45}.ghost{background:white}.list{display:grid;gap:10px;margin-top:16px}.row,.error-row{display:grid;gap:8px;border:1px solid var(--color-line);border-radius:18px;background:white;padding:14px;word-break:break-all;@include media-breakpoint-up(md){grid-template-columns:minmax(0,1fr) auto}}.row span{border-radius:999px;background:rgba(222,77,47,.14);color:var(--color-accent-strong);font-weight:900;padding:6px 10px}.row span.done{background:rgba(45,125,70,.14);color:var(--color-green)}.error-row{border-color:rgba(222,77,47,.35);strong{color:var(--color-accent-strong)}small{color:var(--color-muted)}}.muted{color:var(--color-muted);font-weight:800}</style>
