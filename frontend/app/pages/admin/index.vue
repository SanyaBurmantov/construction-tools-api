<script setup lang="ts">
type Stats = { products: number, categories: number, brands: number, sources: number, queuedSitemaps: number, orders: number, newOrders: number }

const { token, loadToken, saveToken, adminFetch } = useAdminApi()
const stats = ref<Stats | null>(null)
const errorMessage = ref('')
const loading = ref(false)

const sections = [
  { title: 'Заказы', text: 'Список заказов покупателей, статусы и детали.', to: '/admin/orders' },
  { title: 'Товары', text: 'Поиск, список, создание, редактирование и удаление товаров.', to: '/admin/products' },
  { title: 'Категории', text: 'Структура каталога и управление категориями.', to: '/admin/categories' },
  { title: 'Бренды', text: 'Список брендов, создание и редактирование.', to: '/admin/brands' },
  { title: 'Парсинг', text: 'Sitemap-очередь, ссылки в обработке и ошибки парсера.', to: '/admin/parsing' }
]

async function loadDashboard() {
  if (!token.value) return
  loading.value = true
  errorMessage.value = ''

  try {
    stats.value = await adminFetch<Stats>('/stats')
    saveToken()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Не удалось войти в админку'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadToken()
  if (token.value) void loadDashboard()
})

useHead({ title: 'Админка | Мультитул', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-page">
    <section class="admin-hero">
      <div>
        <span class="eyebrow">Admin</span>
        <h1>Панель управления</h1>
        <p>Закрытый раздел без публичной ссылки. Введите `ADMIN_TOKEN`, чтобы управлять проектом.</p>
      </div>
      <form class="token-form" @submit.prevent="loadDashboard">
        <input v-model="token" type="password" placeholder="ADMIN_TOKEN">
        <button type="submit" :disabled="loading">Войти</button>
      </form>
    </section>

    <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>

    <section v-if="stats" class="stats-grid">
      <div><strong>{{ stats.orders }}</strong><span>заказов</span></div>
      <div><strong>{{ stats.newOrders }}</strong><span>новых заказов</span></div>
      <div><strong>{{ stats.products }}</strong><span>товаров</span></div>
      <div><strong>{{ stats.categories }}</strong><span>категорий</span></div>
      <div><strong>{{ stats.brands }}</strong><span>брендов</span></div>
      <div><strong>{{ stats.queuedSitemaps }}</strong><span>sitemap в очереди</span></div>
    </section>

    <section v-if="stats" class="section-grid">
      <a v-for="section in sections" :key="section.to" :href="section.to" class="section-card">
        <h2>{{ section.title }}</h2>
        <p>{{ section.text }}</p>
      </a>
    </section>
  </div>
</template>

<style scoped lang="scss">
.admin-page { display: grid; gap: 24px; }
.admin-hero, .section-card, .stats-grid > div, .notice { border: 2px solid var(--color-ink); border-radius: 28px; background: rgba(255, 250, 240, 0.94); box-shadow: 7px 7px 0 var(--color-ink); }
.admin-hero { display: grid; gap: 22px; padding: clamp(24px, 5vw, 52px); @include media-breakpoint-up(lg) { grid-template-columns: minmax(0, 1fr) 420px; align-items: end; } }
.eyebrow { color: var(--color-accent-strong); font-size: 12px; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; }
h1 { margin-top: 10px; font-size: clamp(36px, 6vw, 68px); }
.token-form { display: grid; gap: 12px; }
input { width: 100%; border: 1px solid var(--color-line); border-radius: 14px; background: white; padding: 12px 14px; }
button { border: 2px solid var(--color-ink); border-radius: 999px; background: var(--color-accent); cursor: pointer; font-weight: 900; padding: 12px 16px; }
.notice { padding: 16px 18px; font-weight: 900; }
.notice.error { color: var(--color-accent-strong); }
.stats-grid, .section-grid { display: grid; gap: 18px; }
.stats-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); > div { display: grid; gap: 6px; padding: 20px; } strong { font-family: var(--font-heading); font-size: 34px; } span { color: var(--color-muted); font-weight: 900; } }
.section-grid { @include media-breakpoint-up(md) { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); } }
.section-card { display: grid; gap: 12px; color: var(--color-ink); padding: 22px; text-decoration: none; transition: 0.18s ease; &:hover { transform: translate(-2px, -2px); box-shadow: 10px 10px 0 var(--color-ink); } p { color: var(--color-muted); line-height: 1.6; } }
</style>
