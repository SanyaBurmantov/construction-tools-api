<script setup lang="ts">
import type { AdminOrder, OrderStatus } from '~/types/api'
import { formatDateTimeWithYear as formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

/**
 * Lines printed in the list's «Состав» column before the rest is summarised.
 * The point of the column is answering "что заказали и где это купить" without
 * opening every order; a ten-line order would turn the table into a wall.
 */
const COMPOSITION_PREVIEW = 3

const COLUMNS = [
  { key: 'number', label: '№', class: 'num-cell' },
  { key: 'customer', label: 'Покупатель' },
  { key: 'composition', label: 'Состав', class: 'composition' },
  { key: 'delivery', label: 'Доставка', class: 'admin-muted' },
  { key: 'createdAt', label: 'Дата', class: 'admin-muted', nowrap: true },
  { key: 'total', label: 'Сумма', align: 'end' as const },
  { key: 'status', label: 'Статус' },
]

const TABS = [
  { value: '', label: 'Все' },
  ...orderStatusOptions({ plural: true }),
]

const route = useRoute()
const router = useRouter()
const { adminFetch, errorMessage } = useAdminApi()
const { invoiceUrl, isInvoiceable } = useB2b()
const toast = useAppToast()
const { run, busy } = useAdminAction()

const tab = ref<OrderStatus | ''>('')
const search = ref('')

const {
  rows: orders,
  pagination,
  loading,
  error: loadError,
  load,
  setPage,
} = useAdminList<AdminOrder>('/orders', {
  params: () => ({ status: tab.value, search: search.value }),
  debounce: 350,
  errorText: 'Не удалось загрузить заказы',
  // The deep link below has to wait for the list, so this page starts it.
  immediate: false,
})

/* ---- Detail ------------------------------------------------------------ */
const detail = ref<AdminOrder | null>(null)
const detailLoading = ref(false)

async function openDetail(id: string) {
  detailLoading.value = true
  try {
    detail.value = await adminFetch<AdminOrder>(`/orders/${id}`)
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

/**
 * CANCELLED and DELIVERED are final (`canMoveOrder`), and a cancel gives the
 * promo use back: one misclick in the footer ended a live order for good.
 */
const FINAL_STATUSES: OrderStatus[] = ['CANCELLED', 'DELIVERED']
const pendingFinal = ref<OrderStatus | null>(null)

function requestStatus(status: OrderStatus) {
  if (FINAL_STATUSES.includes(status)) pendingFinal.value = status
  else void setStatus(status)
}

async function confirmFinalStatus() {
  const status = pendingFinal.value
  if (!status) return
  await setStatus(status)
  pendingFinal.value = null
}

function setStatus(status: OrderStatus) {
  const order = detail.value
  if (!order) return
  return run(
    () =>
      adminFetch<AdminOrder>(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: { status },
      }),
    {
      key: status,
      error: 'Не удалось изменить статус',
      success: 'Статус обновлён',
      after: (updated) => {
        // Merged, not replaced: the PATCH answer does not carry `user`, and
        // swapping it in turned an account's order into «гостевой заказ».
        if (detail.value?.id === order.id) detail.value = { ...detail.value, ...updated }
        return load()
      },
    },
  )
}

onMounted(async () => {
  await load()
  // Deep link from the dashboard: /admin/orders?order=<id>
  const orderId = route.query.order
  if (typeof orderId === 'string') await openDetail(orderId)
})
</script>

<template>
  <div class="admin-page">
    <AdminPageHead title="Заказы" :description="`${pagination.total} заказов всего`">
      <UiInput v-model="search" placeholder="Номер, имя, телефон, email, организация, УНП или источник" size="sm" class="search" />
    </AdminPageHead>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiTabs v-model="tab" :tabs="TABS" />

    <UiTable
      :columns="COLUMNS"
      :rows="orders"
      row-key="id"
      :loading="loading"
      :row-class="() => 'order-row'"
      @row-click="order => openDetail(order.id)"
    >
      <template #empty>
        <UiEmpty
          icon="cart"
          title="Заказов не найдено"
          description="Здесь появятся заказы, оформленные через корзину на сайте."
        />
      </template>

      <template #cell-number="{ row: order }">#{{ order.number }}</template>

      <template #cell-customer="{ row: order }">
        <div class="customer">
          <strong>{{ order.payerName || order.customerName }}</strong>
          <span v-if="order.payerName">{{ order.customerName }}<template v-if="order.payerTaxId"> · УНП {{ order.payerTaxId }}</template></span>
          <span>{{ order.customerPhone }}</span>
          <span v-if="order.user" class="account">
            аккаунт: {{ order.user.login }}
          </span>
          <span v-else class="account is-guest">без аккаунта</span>
          <span v-if="order.trafficSource" class="account">{{ order.trafficSource }}</span>
        </div>
      </template>

      <!-- Everything in here is a link, and the row itself opens the order —
           so the cell keeps its own clicks. -->
      <template #cell-composition="{ row: order }">
        <div @click.stop>
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
            <!-- `line`, not `order`: three repetitions of the «первоисточник»
                 label would be noise in a table. One link per supplier is
                 enough to click through and buy; the full list of pages is one
                 click away in the order itself. -->
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
        </div>
      </template>

      <template #cell-delivery="{ row: order }">{{ DELIVERY_LABEL[order.deliveryMethod] }}</template>

      <template #cell-createdAt="{ row: order }">{{ formatDateTime(order.createdAt) }}</template>

      <template #cell-total="{ row: order }">
        <div class="total-cell">
          <strong>{{ formatPrice(order.total, order.currency) }}</strong>
          <span v-if="order.discountTotal" class="discount">
            −{{ formatPrice(order.discountTotal, order.currency) }}
          </span>
        </div>
      </template>

      <template #cell-status="{ row: order }">
        <UiBadge :tone="ORDER_STATUS_TONE[order.status]" size="sm">
          {{ ORDER_STATUS_LABEL[order.status] }}
        </UiBadge>
      </template>
    </UiTable>

    <UiPagination
      :page="pagination.page"
      :pages="pagination.pages"
      :total="pagination.total"
      @change="setPage"
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
          <UiBadge :tone="ORDER_STATUS_TONE[detail.status]">{{ ORDER_STATUS_LABEL[detail.status] }}</UiBadge>
          <time :datetime="detail.createdAt">{{ formatDateTime(detail.createdAt) }}</time>
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
                  <span v-else class="admin-muted">гостевой заказ</span>
                </dd>
              </div>
              <div v-if="detail.payerName">
                <dt>Организация</dt>
                <dd>
                  {{ detail.payerName }}
                  <a
                    v-if="isInvoiceable(detail)"
                    :href="invoiceUrl(detail.id)"
                    target="_blank"
                    rel="noopener"
                    class="invoice-link"
                  >счёт (PDF)</a>
                </dd>
              </div>
              <div v-if="detail.payerTaxId">
                <dt>УНП</dt>
                <dd>{{ detail.payerTaxId }}</dd>
              </div>
              <div v-if="detail.payerAddress">
                <dt>Юр. адрес</dt>
                <dd>{{ detail.payerAddress }}</dd>
              </div>
              <div v-if="detail.payerAccount">
                <dt>Р/с</dt>
                <dd>{{ detail.payerAccount }}</dd>
              </div>
              <div v-if="detail.payerBankName || detail.payerBankBic">
                <dt>Банк</dt>
                <dd>{{ [detail.payerBankName, detail.payerBankBic && `БИК ${detail.payerBankBic}`].filter(Boolean).join(', ') }}</dd>
              </div>
              <div>
                <dt>{{ detail.payerName ? 'Контактное лицо' : 'Имя' }}</dt>
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
                <dd>{{ DELIVERY_LABEL[detail.deliveryMethod] }}</dd>
              </div>
              <div v-if="detail.deliveryAddress">
                <dt>Адрес</dt>
                <dd>{{ detail.deliveryAddress }}</dd>
              </div>
              <div>
                <dt>Оплата</dt>
                <dd>{{ PAYMENT_LABEL[detail.paymentMethod] || detail.paymentMethod }}</dd>
              </div>
              <div v-if="detail.trafficSource">
                <dt>Источник</dt>
                <dd>
                  {{ detail.trafficSource }}
                  <span
                    v-if="detail.firstTrafficSource && detail.firstTrafficSource !== detail.trafficSource"
                    class="admin-muted"
                  >· впервые пришёл: {{ detail.firstTrafficSource }}</span>
                </dd>
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
            v-for="status in nextOrderStatuses(detail.status)"
            :key="status"
            :variant="status === 'CANCELLED' ? 'ghost' : 'primary'"
            :loading="busy === status"
            :disabled="Boolean(busy)"
            @click="requestStatus(status)"
          >
            {{ ORDER_STATUS_LABEL[status] }}
          </UiButton>
        </template>
        <UiButton variant="secondary" @click="closeDetail">Закрыть</UiButton>
      </template>
    </UiModal>

    <UiConfirm
      :open="Boolean(pendingFinal)"
      :title="pendingFinal === 'CANCELLED' ? 'Отменить заказ?' : 'Отметить заказ доставленным?'"
      :confirm-label="pendingFinal ? ORDER_STATUS_LABEL[pendingFinal] : ''"
      :tone="pendingFinal === 'CANCELLED' ? 'danger' : 'primary'"
      :busy="Boolean(busy)"
      @update:open="pendingFinal = null"
      @confirm="confirmFinalStatus"
    >
      Заказ № {{ detail?.number }}: этот статус окончательный, вернуть заказ в работу будет нельзя.
      <template v-if="pendingFinal === 'CANCELLED'">Промокод заказа снова станет доступен.</template>
    </UiConfirm>
  </div>
</template>

<style scoped>
.search {
  width: min(320px, 100%);
}

/* UiTable cells are its own; the column classes reach them through :deep(). */
:deep(.order-row) {
  cursor: pointer;
}

:deep(.num-cell) {
  color: var(--text-muted);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
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

:deep(td.composition) {
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

.invoice-link {
  margin-left: var(--space-2);
  font-size: var(--text-sm);
}
</style>
