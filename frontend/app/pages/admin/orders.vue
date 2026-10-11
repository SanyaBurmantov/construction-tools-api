<script setup lang="ts">
definePageMeta({ layout: 'admin' })

/**
 * Mirrors the Prisma `OrderStatus` enum exactly. It used to carry a
 * `COMPLETED` that the database has never had: filtering by it or setting it
 * was a 400 from the DTO, and the two statuses that do exist (`PROCESSING`,
 * `DELIVERED`) rendered as an empty badge with no way to move an order on.
 */
type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'

type OrderItem = {
  id: string
  /** Null once the product has been deleted from the catalogue. */
  productId: string | null
  productName: string
  productSlug: string
  productSku: string | null
  productImage: string | null
  unitPrice: number
  unitOldPrice: number | null
  quantity: number
  lineTotal: number
}

/** Present only when the order was placed from an account, not as a guest. */
type OrderAccount = {
  id: string
  login: string
  name: string | null
  customerType: 'INDIVIDUAL' | 'COMPANY'
  companyName: string | null
}

type Order = {
  id: string
  number: number
  status: OrderStatus
  user: OrderAccount | null
  customerName: string
  customerPhone: string
  customerEmail: string | null
  comment: string | null
  deliveryMethod: 'PICKUP' | 'COURIER' | 'POST'
  deliveryAddress: string | null
  paymentMethod: string
  currency: string
  itemsTotal: number
  deliveryCost: number
  discountTotal: number
  promoCodeLabel: string | null
  total: number
  items: OrderItem[]
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  data: Order[]
  pagination: { page: number, limit: number, total: number, pages: number }
}

/**
 * Lines printed in the list's «Состав» column before the rest is summarised.
 * The point of the column is answering "что заказали и где это купить" without
 * opening every order; a ten-line order would turn the table into a wall.
 */
const COMPOSITION_PREVIEW = 3

const route = useRoute()
const router = useRouter()
const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()

const orders = ref<Order[]>([])
const pagination = ref({ page: 1, limit: 20, total: 0, pages: 0 })
const loading = ref(false)
const loadError = ref('')

const tab = ref<OrderStatus | ''>('')
const search = ref('')
const page = ref(1)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<ListResponse>('/orders', {
      params: {
        page: page.value,
        limit: 20,
        ...(tab.value ? { status: tab.value } : {}),
        ...(search.value.trim() ? { search: search.value.trim() } : {}),
      },
    })
    orders.value = response.data
    pagination.value = response.pagination
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить заказы')
  } finally {
    loading.value = false
  }
}

/* ---- Detail ------------------------------------------------------------ */
const detail = ref<Order | null>(null)
const detailLoading = ref(false)
const statusBusy = ref(false)

async function openDetail(id: string) {
  detailLoading.value = true
  try {
    detail.value = await adminFetch<Order>(`/orders/${id}`)
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось загрузить заказ'))
  } finally {
    detailLoading.value = false
  }
}

function closeDetail() {
  detail.value = null
  // Drop the deep-link param so a refresh doesn't reopen the modal.
  if (route.query.order) router.replace({ query: {} })
}

async function setStatus(status: OrderStatus) {
  if (!detail.value) return
  statusBusy.value = true
  try {
    detail.value = await adminFetch<Order>(`/orders/${detail.value.id}/status`, {
      method: 'PATCH',
      body: { status },
    })
    toast.success('Статус обновлён')
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось изменить статус'))
  } finally {
    statusBusy.value = false
  }
}

onMounted(async () => {
  await load()
  // Deep link from the dashboard: /admin/orders?order=<id>
  const orderId = route.query.order
  if (typeof orderId === 'string') await openDetail(orderId)
})

watch(tab, () => {
  page.value = 1
  void load()
})
watch(page, () => void load())

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    page.value = 1
    void load()
  }, 350)
})

/* ---- Display ----------------------------------------------------------- */
const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  PROCESSING: 'Собирается',
  SHIPPED: 'Отправлен',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
}
const STATUS_TONES: Record<OrderStatus, 'brand' | 'info' | 'warning' | 'success' | 'danger'> = {
  NEW: 'brand',
  CONFIRMED: 'info',
  PROCESSING: 'warning',
  SHIPPED: 'warning',
  DELIVERED: 'success',
  CANCELLED: 'danger',
}
const DELIVERY_LABELS: Record<string, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
}
const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Наличными',
  CARD: 'Картой',
  INVOICE: 'По счёту',
}

const dateFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const formatDate = (iso: string) => dateFormatter.format(new Date(iso))

/** Next steps offered for the current status — cancelling is always allowed. */
function nextStatuses(status: OrderStatus): OrderStatus[] {
  switch (status) {
    case 'NEW':
      return ['CONFIRMED', 'CANCELLED']
    case 'CONFIRMED':
      return ['PROCESSING', 'CANCELLED']
    case 'PROCESSING':
      return ['SHIPPED', 'CANCELLED']
    case 'SHIPPED':
      return ['DELIVERED', 'CANCELLED']
    // Delivered and cancelled are terminal.
    default:
      return []
  }
}
</script>

<template>
  <div class="admin-orders">
    <header class="head">
      <div>
        <h1>Заказы</h1>
        <p>{{ pagination.total }} заказов всего</p>
      </div>
      <UiInput v-model="search" placeholder="Номер, имя, телефон или email" size="sm" class="search" />
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiTabs
      v-model="tab"
      :tabs="[
        { value: '', label: 'Все' },
        { value: 'NEW', label: 'Новые' },
        { value: 'CONFIRMED', label: 'Подтверждённые' },
        { value: 'PROCESSING', label: 'В сборке' },
        { value: 'SHIPPED', label: 'Отправленные' },
        { value: 'DELIVERED', label: 'Доставленные' },
        { value: 'CANCELLED', label: 'Отменённые' }
      ]"
    />

    <div class="table-wrap scroll-x">
      <table class="orders-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Покупатель</th>
            <th>Состав</th>
            <th>Доставка</th>
            <th>Дата</th>
            <th class="num">Сумма</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7"><UiSkeleton :lines="5" height="18px" /></td>
          </tr>
          <tr v-else-if="!orders.length">
            <td colspan="7">
              <UiEmpty
                icon="cart"
                title="Заказов не найдено"
                description="Здесь появятся заказы, оформленные через корзину на сайте."
              />
            </td>
          </tr>
          <tr
            v-for="order in orders"
            v-else
            :key="order.id"
            class="order-row"
            @click="openDetail(order.id)"
          >
            <td class="num-cell">#{{ order.number }}</td>
            <td>
              <div class="customer">
                <strong>{{ order.customerName }}</strong>
                <span>{{ order.customerPhone }}</span>
                <span v-if="order.user" class="account">
                  аккаунт: {{ order.user.login }}
                </span>
                <span v-else class="account is-guest">без аккаунта</span>
              </div>
            </td>
            <!-- Everything in here is a link, and the row itself opens the
                 order — so the cell keeps its own clicks. -->
            <td class="composition" @click.stop>
              <div
                v-for="item in order.items.slice(0, COMPOSITION_PREVIEW)"
                :key="item.id"
                class="composition-item"
              >
                <span class="composition-line">
                  <span class="composition-qty">{{ item.quantity }} ×</span>
                  <NuxtLink :to="`/product/${item.productSlug}`" target="_blank">
                    {{ item.productName }}
                  </NuxtLink>
                </span>
                <!-- `line`, not `order`: three repetitions of the
                     «первоисточник» label would be noise in a table. One link
                     per supplier is enough to click through and buy; the full
                     list of pages is one click away in the order itself. -->
                <AdminProductSourceNote
                  v-if="item.productId"
                  :product-id="item.productId"
                  variant="line"
                />
              </div>
              <button
                v-if="order.items.length > COMPOSITION_PREVIEW"
                type="button"
                class="composition-rest"
                @click="openDetail(order.id)"
              >
                +{{ order.items.length - COMPOSITION_PREVIEW }} позиц. →
              </button>
            </td>
            <td class="muted">{{ DELIVERY_LABELS[order.deliveryMethod] }}</td>
            <td class="muted nowrap">{{ formatDate(order.createdAt) }}</td>
            <td class="num">
              <div class="total-cell">
                <strong>{{ formatPrice(order.total, order.currency) }}</strong>
                <span v-if="order.discountTotal" class="discount">
                  −{{ formatPrice(order.discountTotal, order.currency) }}
                </span>
              </div>
            </td>
            <td>
              <UiBadge :tone="STATUS_TONES[order.status]" size="sm">
                {{ STATUS_LABELS[order.status] }}
              </UiBadge>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="page = $event"
    />

    <!-- Detail -->
    <UiModal
      :open="Boolean(detail) || detailLoading"
      :title="detail ? `Заказ #${detail.number}` : 'Загрузка…'"
      size="lg"
      @update:open="closeDetail"
    >
      <UiSkeleton v-if="detailLoading" :lines="8" height="18px" />

      <div v-else-if="detail" class="detail">
        <div class="detail-head">
          <UiBadge :tone="STATUS_TONES[detail.status]">{{ STATUS_LABELS[detail.status] }}</UiBadge>
          <time :datetime="detail.createdAt">{{ formatDate(detail.createdAt) }}</time>
        </div>

        <div class="detail-grid">
          <UiCard title="Покупатель" flat>
            <dl class="facts">
              <div>
                <dt>Аккаунт</dt>
                <dd>
                  <NuxtLink v-if="detail.user" :to="`/admin/users/${detail.user.id}`">
                    {{ detail.user.login }}
                  </NuxtLink>
                  <span v-else class="muted">гостевой заказ</span>
                </dd>
              </div>
              <div v-if="detail.user?.companyName">
                <dt>Организация</dt>
                <dd>{{ detail.user.companyName }}</dd>
              </div>
              <div>
                <dt>Имя</dt>
                <dd>{{ detail.customerName }}</dd>
              </div>
              <div>
                <dt>Телефон</dt>
                <dd><a :href="`tel:${detail.customerPhone}`">{{ detail.customerPhone }}</a></dd>
              </div>
              <div v-if="detail.customerEmail">
                <dt>Email</dt>
                <dd><a :href="`mailto:${detail.customerEmail}`">{{ detail.customerEmail }}</a></dd>
              </div>
              <div v-if="detail.comment">
                <dt>Комментарий</dt>
                <dd>{{ detail.comment }}</dd>
              </div>
            </dl>
          </UiCard>

          <UiCard title="Доставка и оплата" flat>
            <dl class="facts">
              <div>
                <dt>Способ</dt>
                <dd>{{ DELIVERY_LABELS[detail.deliveryMethod] }}</dd>
              </div>
              <div v-if="detail.deliveryAddress">
                <dt>Адрес</dt>
                <dd>{{ detail.deliveryAddress }}</dd>
              </div>
              <div>
                <dt>Оплата</dt>
                <dd>{{ PAYMENT_LABELS[detail.paymentMethod] || detail.paymentMethod }}</dd>
              </div>
              <div v-if="detail.promoCodeLabel">
                <dt>Промокод</dt>
                <dd><code>{{ detail.promoCodeLabel }}</code></dd>
              </div>
            </dl>
          </UiCard>
        </div>

        <UiCard title="Состав заказа" flat :padded="false">
          <ul class="items">
            <li v-for="item in detail.items" :key="item.id">
              <img v-if="item.productImage" :src="item.productImage" :alt="item.productName" loading="lazy">
              <span v-else class="item-thumb" aria-hidden="true" />
              <div class="item-body">
                <NuxtLink :to="`/product/${item.productSlug}`" target="_blank">
                  {{ item.productName }}
                </NuxtLink>
                <span v-if="item.productSku" class="item-sku">Арт. {{ item.productSku }}</span>
                <!-- Первоисточник: по этим ссылкам заказ и закупается. -->
                <AdminProductSourceNote
                  v-if="item.productId"
                  :product-id="item.productId"
                  variant="order"
                  show-empty
                />
                <!-- Without a product there is nothing to look up — say so
                     instead of leaving the line looking unparsed. -->
                <span v-else class="item-gone">товар удалён из каталога</span>
              </div>
              <span class="item-qty">{{ item.quantity }} ×</span>
              <span class="item-price">
                {{ formatPrice(item.unitPrice, detail.currency) }}
                <s v-if="item.unitOldPrice">{{ formatPrice(item.unitOldPrice, detail.currency) }}</s>
              </span>
              <strong class="item-total">{{ formatPrice(item.lineTotal, detail.currency) }}</strong>
            </li>
          </ul>

          <dl class="totals">
            <div>
              <dt>Товары</dt>
              <dd>{{ formatPrice(detail.itemsTotal, detail.currency) }}</dd>
            </div>
            <div v-if="detail.discountTotal" class="is-discount">
              <dt>Скидка{{ detail.promoCodeLabel ? ` (${detail.promoCodeLabel})` : '' }}</dt>
              <dd>−{{ formatPrice(detail.discountTotal, detail.currency) }}</dd>
            </div>
            <div>
              <dt>Доставка</dt>
              <dd>
                {{ detail.deliveryCost ? formatPrice(detail.deliveryCost, detail.currency) : 'бесплатно' }}
              </dd>
            </div>
            <div class="is-total">
              <dt>Итого</dt>
              <dd>{{ formatPrice(detail.total, detail.currency) }}</dd>
            </div>
          </dl>
        </UiCard>
      </div>

      <template #footer>
        <template v-if="detail">
          <UiButton
            v-for="status in nextStatuses(detail.status)"
            :key="status"
            :variant="status === 'CANCELLED' ? 'ghost' : 'primary'"
            :loading="statusBusy"
            @click="setStatus(status)"
          >
            {{ STATUS_LABELS[status] }}
          </UiButton>
        </template>
        <UiButton variant="secondary" @click="closeDetail">Закрыть</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-orders {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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

.search {
  width: min(320px, 100%);
}

.table-wrap {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.orders-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.orders-table th {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.orders-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.orders-table tbody tr:last-child td {
  border-bottom: 0;
}

.order-row {
  cursor: pointer;
}

.order-row:hover td {
  background: var(--surface-hover);
}

.num,
.num-cell {
  text-align: right;
}

.num-cell {
  color: var(--text-muted);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: left;
}

.nowrap {
  white-space: nowrap;
}

.muted {
  color: var(--text-muted);
}

.customer {
  display: flex;
  flex-direction: column;
}

.customer strong {
  color: var(--text-strong);
}

.customer span {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.account {
  color: var(--text-link);
}

.account.is-guest {
  color: var(--text-subtle);
}

.total-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.total-cell strong {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.discount {
  color: var(--sale);
  font-size: var(--text-xs);
  font-weight: 600;
}

/* ---- Detail ---- */
.detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-head time {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.facts {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-2);
}

.facts > div {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 110px 1fr;
  font-size: var(--text-sm);
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  margin: 0;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.facts a:hover {
  color: var(--text-link);
  text-decoration: underline;
}

.items {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.items li {
  display: grid;
  align-items: center;
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-3);
  grid-template-columns: 40px 1fr auto auto auto;
  font-size: var(--text-sm);
}

.composition {
  min-width: 260px;
  max-width: 420px;
  font-size: var(--text-sm);
}

.composition-item + .composition-item {
  margin-top: var(--space-2);
}

.composition-line {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.composition-qty {
  flex-shrink: 0;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.composition-line a {
  color: var(--text-strong);
}

.composition-line a:hover {
  color: var(--text-link);
  text-decoration: underline;
}

.composition-rest {
  margin-top: var(--space-1);
  color: var(--text-link);
  font-size: var(--text-xs);
  font-weight: 600;
}

.item-gone {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.items img,
.item-thumb {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.item-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.item-body a {
  color: var(--text-strong);
  font-weight: 600;
}

.item-body a:hover {
  color: var(--text-link);
}

.item-sku {
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.item-qty,
.item-price {
  color: var(--text-muted);
  white-space: nowrap;
}

.item-price s {
  display: block;
  color: var(--text-subtle);
  font-size: var(--text-xs);
}

.item-total {
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.totals {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-5);
  margin: 0;
  gap: var(--space-2);
}

.totals > div {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.totals dd {
  margin: 0;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}

.totals .is-discount,
.totals .is-discount dd {
  color: var(--sale);
}

.totals .is-total {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-strong);
  font-size: var(--text-md);
  font-weight: 800;
}

@media (max-width: 700px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .items li {
    grid-template-columns: 40px 1fr auto;
  }

  .item-qty,
  .item-price {
    display: none;
  }
}
</style>
