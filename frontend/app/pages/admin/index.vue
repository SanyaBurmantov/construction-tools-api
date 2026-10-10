<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type Stats = {
  products: number
  publishedProducts: number
  categories: number
  brands: number
  sources: number
  queuedSitemaps: number
  orders: number
  newOrders: number
  pendingReviews: number
  activePromoCodes: number
  productsWithoutImages: number
  users: number
  admins: number
  revenueTotal: number
  averageOrder: number
  ordersByStatus: Record<string, number>
  recentOrders: Array<{
    id: string
    number: number
    status: string
    customerName: string
    total: number
    currency: string
    createdAt: string
  }>
  salesSeries: Array<{ date: string, orders: number, revenue: number }>
  topProducts: Array<{
    productId: string | null
    name: string
    slug: string
    quantity: number
    revenue: number
  }>
}

const { adminFetch, errorMessage } = useAdminApi()
const { formatPrice } = useFormatPrice()

const stats = ref<Stats | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    stats.value = await adminFetch<Stats>('/stats')
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить статистику')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const ORDER_STATUS_LABELS: Record<string, string> = {
  NEW: 'Новые',
  CONFIRMED: 'Подтверждены',
  SHIPPED: 'Отправлены',
  COMPLETED: 'Завершены',
  CANCELLED: 'Отменены',
}

/** Bar heights are relative to the busiest day in the window. */
const maxRevenue = computed(() =>
  Math.max(1, ...(stats.value?.salesSeries ?? []).map((d) => d.revenue))
)

const dayFormatter = new Intl.DateTimeFormat('ru-BY', { day: 'numeric', month: 'short' })
const formatDay = (iso: string) => dayFormatter.format(new Date(iso))

const dateTimeFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso))
</script>

<template>
  <div class="dashboard">
    <header class="head">
      <div>
        <h1>Дашборд</h1>
        <p>Сводка по магазину за последние 14 дней</p>
      </div>
      <UiButton variant="secondary" size="sm" :loading="loading" @click="load">
        Обновить
      </UiButton>
    </header>

    <AdminSetupWarnings />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div v-if="loading && !stats" class="tiles">
      <UiSkeleton v-for="i in 6" :key="i" height="92px" radius="var(--radius-md)" />
    </div>

    <template v-else-if="stats">
      <section class="tiles">
        <UiStat
          label="Выручка"
          :value="formatPrice(stats.revenueTotal, 'BYN')"
          hint="без отменённых"
          tone="success"
        />
        <UiStat
          label="Заказов"
          :value="stats.orders"
          :hint="`средний чек ${formatPrice(stats.averageOrder, 'BYN')}`"
          to="/admin/orders"
        />
        <UiStat
          label="Новые заказы"
          :value="stats.newOrders"
          tone="brand"
          hint="ждут обработки"
          to="/admin/orders"
        />
        <UiStat
          label="Отзывы на модерации"
          :value="stats.pendingReviews"
          :tone="stats.pendingReviews ? 'warning' : 'neutral'"
          to="/admin/reviews"
        />
        <UiStat
          label="Товары"
          :value="stats.products"
          :hint="`${stats.publishedProducts} опубликовано`"
          to="/admin/products"
        />
        <UiStat
          label="Товары без фото"
          :value="stats.productsWithoutImages"
          :tone="stats.productsWithoutImages ? 'danger' : 'success'"
          :hint="stats.publishedProducts
            ? `${Math.round((stats.productsWithoutImages / stats.publishedProducts) * 100)}% каталога`
            : 'каталог пуст'"
          to="/admin/products"
        />
        <UiStat
          label="Промокоды"
          :value="stats.activePromoCodes"
          hint="активных"
          to="/admin/promo-codes"
        />
        <UiStat
          label="Пользователи"
          :value="stats.users"
          :hint="`${stats.admins} с правами админа`"
          to="/admin/users"
        />
      </section>

      <div class="grid">
        <UiCard title="Продажи за 14 дней">
          <div class="chart">
            <div
              v-for="day in stats.salesSeries"
              :key="day.date"
              class="chart-col"
              :title="`${formatDay(day.date)}: ${day.orders} заказов, ${formatPrice(day.revenue, 'BYN')}`"
            >
              <div class="chart-bar-wrap">
                <div
                  class="chart-bar"
                  :class="{ 'is-empty': !day.revenue }"
                  :style="{ height: `${(day.revenue / maxRevenue) * 100}%` }"
                />
              </div>
              <span class="chart-label">{{ formatDay(day.date) }}</span>
            </div>
          </div>
        </UiCard>

        <UiCard title="Заказы по статусам">
          <ul class="status-list">
            <li v-for="(label, key) in ORDER_STATUS_LABELS" :key="key">
              <span>{{ label }}</span>
              <strong>{{ stats.ordersByStatus[key] ?? 0 }}</strong>
            </li>
          </ul>
        </UiCard>
      </div>

      <div class="grid">
        <UiCard title="Последние заказы">
          <template #actions>
            <UiButton variant="link" size="sm" to="/admin/orders">Все заказы</UiButton>
          </template>
          <p v-if="!stats.recentOrders.length" class="empty">Заказов пока нет</p>
          <ul v-else class="order-list">
            <li v-for="order in stats.recentOrders" :key="order.id">
              <NuxtLink :to="`/admin/orders?order=${order.id}`" class="order-row">
                <span class="order-number">#{{ order.number }}</span>
                <span class="order-name">{{ order.customerName }}</span>
                <span class="order-date">{{ formatDateTime(order.createdAt) }}</span>
                <strong>{{ formatPrice(order.total, order.currency) }}</strong>
              </NuxtLink>
            </li>
          </ul>
        </UiCard>

        <UiCard title="Топ товаров">
          <p v-if="!stats.topProducts.length" class="empty">Продаж пока нет</p>
          <ul v-else class="top-list">
            <li v-for="item in stats.topProducts" :key="item.productId || item.slug">
              <NuxtLink :to="`/product/${item.slug}`" target="_blank" class="top-name">
                {{ item.name }}
              </NuxtLink>
              <span class="top-qty">{{ item.quantity }} шт.</span>
              <strong>{{ formatPrice(item.revenue, 'BYN') }}</strong>
            </li>
          </ul>
        </UiCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.grid {
  display: grid;
  align-items: start;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-4);
}

/* ---- Chart ---- */
.chart {
  display: flex;
  height: 200px;
  align-items: flex-end;
  gap: var(--space-2);
}

.chart-col {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  height: 100%;
  gap: var(--space-2);
}

.chart-bar-wrap {
  display: flex;
  width: 100%;
  flex: 1;
  align-items: flex-end;
}

.chart-bar {
  width: 100%;
  min-height: 2px;
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  background: var(--brand);
  transition: height var(--duration-slow) var(--ease-out);
}

.chart-bar.is-empty {
  background: var(--surface-sunken);
}

.chart-label {
  color: var(--text-subtle);
  font-size: 10px;
  white-space: nowrap;
}

/* ---- Lists ---- */
.status-list,
.order-list,
.top-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-1);
  list-style: none;
}

.status-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.status-list li:last-child {
  border-bottom: 0;
}

.status-list strong {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.order-row {
  display: grid;
  align-items: center;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  gap: var(--space-3);
  grid-template-columns: auto 1fr auto auto;
  font-size: var(--text-sm);
}

.order-row:hover {
  background: var(--surface-hover);
}

.order-number {
  color: var(--text-muted);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.order-name {
  overflow: hidden;
  color: var(--text-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-date {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.top-list li {
  display: grid;
  align-items: center;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-3);
  grid-template-columns: 1fr auto auto;
  font-size: var(--text-sm);
}

.top-list li:last-child {
  border-bottom: 0;
}

.top-name {
  overflow: hidden;
  color: var(--text-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-name:hover {
  color: var(--text-link);
}

.top-qty {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.empty {
  padding: var(--space-6);
  color: var(--text-muted);
  text-align: center;
}

@media (max-width: 1000px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .chart-label {
    display: none;
  }

  .order-row {
    grid-template-columns: auto 1fr auto;
  }

  .order-date {
    display: none;
  }
}
</style>
