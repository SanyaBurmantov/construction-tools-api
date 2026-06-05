<script setup lang="ts">
interface OrderItem {
  id: string
  productName: string
  productSlug: string
  productSku: string | null
  unitPrice: number
  quantity: number
  lineTotal: number
}

interface Order {
  id: string
  number: number
  status: OrderStatus
  customerName: string
  customerPhone: string
  customerEmail: string | null
  comment: string | null
  deliveryMethod: string
  deliveryAddress: string | null
  paymentMethod: string
  currency: string
  itemsTotal: number
  deliveryCost: number
  total: number
  createdAt: string
  items: OrderItem[]
}

type OrderStatus = 'NEW' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'

interface OrdersResponse {
  data: Order[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

const { token, loadToken, saveToken, adminFetch } = useAdminApi()
const { formatPrice } = useFormatPrice()

const orders = ref<Order[]>([])
const pagination = ref<OrdersResponse['pagination'] | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const statusFilter = ref<OrderStatus | ''>('')
const search = ref('')
const page = ref(1)
const expanded = ref<string | null>(null)

const statusOptions: { value: OrderStatus, label: string }[] = [
  { value: 'NEW', label: 'Новый' },
  { value: 'CONFIRMED', label: 'Подтверждён' },
  { value: 'PROCESSING', label: 'В работе' },
  { value: 'SHIPPED', label: 'Отправлен' },
  { value: 'DELIVERED', label: 'Доставлен' },
  { value: 'CANCELLED', label: 'Отменён' },
]

const deliveryLabels: Record<string, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
}
const paymentLabels: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  INVOICE: 'Счёт',
}

async function loadOrders() {
  if (!token.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    if (search.value.trim()) params.set('search', search.value.trim())
    params.set('page', String(page.value))
    const response = await adminFetch<OrdersResponse>(`/orders?${params.toString()}`)
    orders.value = response.data
    pagination.value = response.pagination
    saveToken()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Не удалось загрузить заказы'
  } finally {
    loading.value = false
  }
}

async function updateStatus(order: Order, status: OrderStatus) {
  try {
    await adminFetch(`/orders/${order.id}/status`, { method: 'PATCH', body: { status } })
    order.status = status
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Не удалось изменить статус'
  }
}

function applyFilters() {
  page.value = 1
  void loadOrders()
}

function changePage(next: number) {
  page.value = next
  void loadOrders()
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('ru-BY', { dateStyle: 'short', timeStyle: 'short' })
}

onMounted(() => {
  loadToken()
  if (token.value) void loadOrders()
})

useHead({ title: 'Заказы | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-page">
    <header class="page-head">
      <div>
        <NuxtLink to="/admin" class="back">← В админку</NuxtLink>
        <h1>Заказы</h1>
      </div>
      <form v-if="!token" class="token-form" @submit.prevent="loadOrders">
        <input v-model="token" type="password" placeholder="ADMIN_TOKEN">
        <button type="submit">Войти</button>
      </form>
    </header>

    <div v-if="errorMessage" class="notice error">{{ errorMessage }}</div>

    <section v-if="token" class="filters">
      <select v-model="statusFilter" @change="applyFilters">
        <option value="">Все статусы</option>
        <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <input v-model="search" type="search" placeholder="Имя, телефон, email или № заказа" @keyup.enter="applyFilters">
      <button type="button" @click="applyFilters">Найти</button>
    </section>

    <p v-if="loading" class="muted">Загрузка…</p>
    <p v-else-if="token && !orders.length" class="muted">Заказов не найдено.</p>

    <section v-if="orders.length" class="orders">
      <article v-for="order in orders" :key="order.id" class="order">
        <div class="order-head" @click="expanded = expanded === order.id ? null : order.id">
          <div class="col">
            <strong>№{{ order.number }}</strong>
            <span class="muted">{{ formatDate(order.createdAt) }}</span>
          </div>
          <div class="col">
            <strong>{{ order.customerName }}</strong>
            <span class="muted">{{ order.customerPhone }}</span>
          </div>
          <div class="col">
            <span class="muted">{{ deliveryLabels[order.deliveryMethod] || order.deliveryMethod }} · {{ paymentLabels[order.paymentMethod] || order.paymentMethod }}</span>
            <strong>{{ formatPrice(order.total, order.currency) }}</strong>
          </div>
          <select
            class="status-select"
            :class="`status-${order.status.toLowerCase()}`"
            :value="order.status"
            @click.stop
            @change="updateStatus(order, ($event.target as HTMLSelectElement).value as OrderStatus)"
          >
            <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>

        <div v-if="expanded === order.id" class="order-body">
          <ul class="items">
            <li v-for="item in order.items" :key="item.id">
              <span class="item-name">
                <NuxtLink :to="`/product/${item.productSlug}`" target="_blank">{{ item.productName }}</NuxtLink>
                <small v-if="item.productSku">Арт. {{ item.productSku }}</small>
              </span>
              <span>{{ item.quantity }} × {{ formatPrice(item.unitPrice, order.currency) }}</span>
              <strong>{{ formatPrice(item.lineTotal, order.currency) }}</strong>
            </li>
          </ul>
          <dl class="details">
            <div v-if="order.customerEmail"><dt>Email</dt><dd>{{ order.customerEmail }}</dd></div>
            <div v-if="order.deliveryAddress"><dt>Адрес</dt><dd>{{ order.deliveryAddress }}</dd></div>
            <div v-if="order.comment"><dt>Комментарий</dt><dd>{{ order.comment }}</dd></div>
            <div><dt>Товары</dt><dd>{{ formatPrice(order.itemsTotal, order.currency) }}</dd></div>
            <div><dt>Доставка</dt><dd>{{ formatPrice(order.deliveryCost, order.currency) }}</dd></div>
            <div><dt>Итого</dt><dd>{{ formatPrice(order.total, order.currency) }}</dd></div>
          </dl>
        </div>
      </article>
    </section>

    <nav v-if="pagination && pagination.pages > 1" class="pager">
      <button type="button" :disabled="page <= 1" @click="changePage(page - 1)">Назад</button>
      <span>{{ pagination.page }} / {{ pagination.pages }}</span>
      <button type="button" :disabled="page >= pagination.pages" @click="changePage(page + 1)">Вперёд</button>
    </nav>
  </div>
</template>

<style scoped lang="scss">
.admin-page { display: grid; gap: 20px; }
.page-head { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: end; }
.back { color: var(--color-muted); font-weight: 800; text-decoration: none; }
h1 { margin-top: 6px; font-size: clamp(28px, 5vw, 48px); }
.token-form { display: flex; gap: 10px; }
.token-form input { border: 1px solid var(--color-line); border-radius: 12px; padding: 10px 14px; }
.token-form button, .filters button { border: 2px solid var(--color-ink); border-radius: 999px; background: var(--color-accent, #ffcf26); cursor: pointer; font-weight: 900; padding: 10px 16px; }
.notice.error { border: 1px solid #fecaca; border-radius: 14px; background: #fef2f2; color: #b42318; font-weight: 800; padding: 14px 16px; }
.muted { color: var(--color-muted); }
.filters { display: flex; flex-wrap: wrap; gap: 10px; }
.filters select, .filters input { border: 1px solid var(--color-line); border-radius: 12px; background: white; padding: 10px 14px; }
.filters input { flex: 1; min-width: 220px; }
.orders { display: grid; gap: 12px; }
.order { border: 1px solid var(--color-line); border-radius: 16px; background: white; box-shadow: var(--shadow-card); overflow: hidden; }
.order-head { display: grid; grid-template-columns: 1fr; gap: 12px; align-items: center; padding: 16px; cursor: pointer; @include media-breakpoint-up(md) { grid-template-columns: 160px minmax(0, 1fr) auto 150px; } }
.col { display: grid; gap: 3px; min-width: 0; strong { font-size: 15px; } span { font-size: 13px; } }
.status-select { border: 1px solid var(--color-line); border-radius: 999px; padding: 8px 12px; font-weight: 800; cursor: pointer; }
.status-new { background: #eef4ff; color: var(--color-primary); }
.status-confirmed { background: #ecfeff; color: #0e7490; }
.status-processing { background: #fffbeb; color: #b45309; }
.status-shipped { background: #f5f3ff; color: #6d28d9; }
.status-delivered { background: #dcfce7; color: #15803d; }
.status-cancelled { background: #fef2f2; color: #b42318; }
.order-body { display: grid; gap: 16px; border-top: 1px solid var(--color-line); padding: 16px; background: #fafafa; @include media-breakpoint-up(lg) { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); } }
.items { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.items li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; font-size: 14px; a { color: var(--color-primary); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.item-name { display: grid; gap: 2px; min-width: 0; small { color: var(--color-muted); font-size: 12px; font-weight: 700; } }
.details { display: grid; gap: 6px; margin: 0; > div { display: flex; justify-content: space-between; gap: 12px; } dt { color: var(--color-muted); } dd { margin: 0; font-weight: 700; text-align: right; } }
.pager { display: flex; gap: 14px; align-items: center; justify-content: center; button { border: 1px solid var(--color-line); border-radius: 10px; background: white; cursor: pointer; padding: 8px 14px; &:disabled { opacity: 0.5; cursor: not-allowed; } } }
</style>
