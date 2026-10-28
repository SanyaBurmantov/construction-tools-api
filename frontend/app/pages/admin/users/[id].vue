<script setup lang="ts">
import type { UserRole } from '~/composables/useAuth'
import type { AdminUser, Order, OrderItem, OrderStatus } from '~/types/api'
import { formatDateTimeWithYear as formatDateTime } from '~/utils/format-datetime'

definePageMeta({ layout: 'admin' })

type Response = {
  user: AdminUser
  orders: Order[]
  stats: {
    total: number
    active: number
    byStatus: Partial<Record<OrderStatus, number>>
    totalSpent: number
  }
}

const route = useRoute()
const { adminFetch, errorMessage, user: me } = useAdminApi()
const { run, busy } = useAdminAction()
const toast = useAppToast()

const userId = computed(() => String(route.params.id))
const data = ref<Response | null>(null)
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    data.value = await adminFetch<Response>(`/users/${userId.value}`)
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить пользователя')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const account = computed(() => data.value?.user ?? null)
const isMe = computed(() => account.value?.id === me.value?.id)

/** Current orders first — that is what someone opening this page is chasing. */
const currentOrders = computed(() =>
  (data.value?.orders ?? []).filter(order => isActiveOrder(order.status)),
)
const pastOrders = computed(() =>
  (data.value?.orders ?? []).filter(order => !isActiveOrder(order.status)),
)

const expandedOrder = ref('')

/* ---- Inline status change ---------------------------------------------- */
/**
 * The select offers only the moves the order screen allows. Listing all six
 * let an admin drag a shipped order back to «Новый» from here, which the
 * order screen itself never permits.
 */
const statusOptions = (status: OrderStatus) =>
  [status, ...nextOrderStatuses(status)].map(value => ({
    value,
    label: ORDER_STATUS_LABEL[value],
  }))

function setStatus(order: Order, status: OrderStatus) {
  if (status === order.status) return
  return run(
    () => adminFetch(`/orders/${order.id}/status`, { method: 'PATCH', body: { status } }),
    {
      key: order.id,
      error: 'Не удалось изменить статус',
      success: `Заказ № ${order.number}: ${ORDER_STATUS_LABEL[status]}`,
      after: load,
    },
  )
}

/* ---- Account actions --------------------------------------------------- */
function patchAccount(body: Record<string, unknown>, message: string) {
  return run(() => adminFetch(`/users/${userId.value}`, { method: 'PATCH', body }), {
    key: 'account',
    error: 'Не удалось сохранить изменения',
    success: message,
    after: load,
  })
}

const resetOpen = ref(false)
const newPassword = ref('')
const resetError = ref('')
const resetBusy = ref(false)

async function resetPassword() {
  resetError.value = ''
  if (newPassword.value.length < 8) {
    resetError.value = 'Пароль должен быть не короче 8 символов'
    return
  }
  resetBusy.value = true
  try {
    await adminFetch(`/users/${userId.value}`, {
      method: 'PATCH',
      body: { password: newPassword.value },
    })
    toast.success('Пароль изменён, сессии пользователя сброшены')
    resetOpen.value = false
    newPassword.value = ''
    await load()
  } catch (error) {
    // Inside the modal, next to the field — not a toast behind it.
    resetError.value = errorMessage(error, 'Не удалось изменить пароль')
  } finally {
    resetBusy.value = false
  }
}

const roleLabel = (role: UserRole) => (role === 'ADMIN' ? 'Администратор' : 'Покупатель')
</script>

<template>
  <div class="admin-page">
    <div class="back">
      <NuxtLink to="/admin/users">← Все пользователи</NuxtLink>
    </div>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiSkeleton v-if="loading" height="420px" radius="var(--radius-md)" />

    <template v-else-if="account">
      <AdminPageHead :title="account.login">
        <template #description>
          <span class="badges">
            <UiBadge :tone="account.role === 'ADMIN' ? 'brand' : 'neutral'" size="sm">
              {{ roleLabel(account.role) }}
            </UiBadge>
            <UiBadge size="sm">{{ CUSTOMER_TYPE_LABEL[account.customerType] }}</UiBadge>
            <UiBadge v-if="!account.isActive" tone="danger" size="sm">Отключён</UiBadge>
            <UiBadge v-if="isMe" tone="info" size="sm">это вы</UiBadge>
          </span>
        </template>

        <UiButton size="sm" variant="ghost" @click="resetOpen = true">
          Сбросить пароль
        </UiButton>
        <UiButton
          v-if="!isMe"
          size="sm"
          variant="ghost"
          :loading="busy === 'account'"
          @click="patchAccount(
            { role: account.role === 'ADMIN' ? 'CUSTOMER' : 'ADMIN' },
            account.role === 'ADMIN' ? 'Права администратора сняты' : 'Выданы права администратора'
          )"
        >
          {{ account.role === 'ADMIN' ? 'Снять админа' : 'Сделать админом' }}
        </UiButton>
        <UiButton
          v-if="!isMe"
          size="sm"
          variant="ghost"
          :loading="busy === 'account'"
          @click="patchAccount(
            { isActive: !account.isActive },
            account.isActive ? 'Учётная запись отключена' : 'Учётная запись включена'
          )"
        >
          {{ account.isActive ? 'Отключить' : 'Включить' }}
        </UiButton>
      </AdminPageHead>

      <div class="stats">
        <UiStat label="Заказов" :value="data?.stats.total ?? 0" />
        <UiStat label="В работе" :value="data?.stats.active ?? 0" tone="brand" />
        <UiStat
          label="Куплено на сумму"
          :value="formatPrice(data?.stats.totalSpent ?? 0, 'BYN')"
          hint="без отменённых"
        />
        <UiStat label="Активных сессий" :value="account._count?.sessions ?? 0" />
      </div>

      <UiCard title="Данные аккаунта">
        <dl class="facts">
          <div>
            <dt>Логин</dt>
            <dd>{{ account.login }}</dd>
          </div>
          <div>
            <dt>Роль</dt>
            <dd>{{ roleLabel(account.role) }}</dd>
          </div>
          <div>
            <dt>Тип покупателя</dt>
            <dd>{{ CUSTOMER_TYPE_LABEL[account.customerType] }}</dd>
          </div>
          <div v-if="account.companyName">
            <dt>Организация</dt>
            <dd>{{ account.companyName }}</dd>
          </div>
          <div v-if="account.taxId">
            <dt>УНП</dt>
            <dd>{{ account.taxId }}</dd>
          </div>
          <div v-if="account.legalAddress">
            <dt>Юр. адрес</dt>
            <dd>{{ account.legalAddress }}</dd>
          </div>
          <div v-if="account.bankAccount">
            <dt>Р/с</dt>
            <dd>{{ account.bankAccount }}</dd>
          </div>
          <div v-if="account.bankName || account.bankBic">
            <dt>Банк</dt>
            <dd>{{ [account.bankName, account.bankBic && `БИК ${account.bankBic}`].filter(Boolean).join(', ') }}</dd>
          </div>
          <div>
            <dt>{{ account.customerType === 'COMPANY' ? 'Контактное лицо' : 'Имя' }}</dt>
            <dd>{{ account.name || '—' }}</dd>
          </div>
          <div>
            <dt>Телефон</dt>
            <dd>{{ account.phone || '—' }}</dd>
          </div>
          <div>
            <dt>E-mail</dt>
            <dd>{{ account.email || '—' }}</dd>
          </div>
          <div>
            <dt>Регистрация</dt>
            <dd>{{ formatDateTime(account.createdAt) }}</dd>
          </div>
          <div>
            <dt>Последний вход</dt>
            <dd>{{ formatDateTime(account.lastLoginAt) }}</dd>
          </div>
        </dl>
      </UiCard>

      <section class="orders">
        <h2>Текущие заказы</h2>
        <UiEmpty
          v-if="!currentOrders.length"
          icon="cart"
          title="Нет заказов в работе"
          description="Здесь появляются новые, подтверждённые, собираемые и отправленные заказы."
        />
        <ul v-else class="order-list">
          <li v-for="order in currentOrders" :key="order.id" class="order is-active">
            <div class="order-head">
              <div class="order-title">
                <strong>№ {{ order.number }}</strong>
                <UiBadge :tone="ORDER_STATUS_TONE[order.status]" size="sm">
                  {{ ORDER_STATUS_LABEL[order.status] }}
                </UiBadge>
              </div>
              <span class="admin-muted small">{{ formatDateTime(order.createdAt) }}</span>
            </div>

            <dl class="order-facts">
              <div>
                <dt>Сумма</dt>
                <dd>{{ formatPrice(order.total, order.currency) }}</dd>
              </div>
              <div>
                <dt>Позиций</dt>
                <dd>{{ order.items.length }}</dd>
              </div>
              <div>
                <dt>Доставка</dt>
                <dd>{{ DELIVERY_LABEL[order.deliveryMethod] }}</dd>
              </div>
              <div>
                <dt>Оплата</dt>
                <dd>{{ PAYMENT_LABEL[order.paymentMethod] }}</dd>
              </div>
            </dl>

            <div class="order-actions">
              <UiButton
                size="sm"
                variant="ghost"
                @click="expandedOrder = expandedOrder === order.id ? '' : order.id"
              >
                {{ expandedOrder === order.id ? 'Свернуть' : 'Состав и контакты' }}
              </UiButton>
              <UiSelect
                size="sm"
                class="status-select"
                :model-value="order.status"
                :disabled="busy === order.id"
                :options="statusOptions(order.status)"
                @update:model-value="value => setStatus(order, value as OrderStatus)"
              />
            </div>

            <div v-if="expandedOrder === order.id" class="order-details">
              <ul class="order-items">
                <li v-for="item in order.items" :key="item.id" class="order-item">
                  <span class="order-item-name">
                    <NuxtLink :to="`/product/${item.productSlug}`" target="_blank">
                      {{ item.productName }}
                    </NuxtLink>
                    <!-- Same «первоисточник» links as the order screen: this
                         page is where an admin answers "где это купить". -->
                    <AdminProductSourceNote
                      v-if="item.productId"
                      :product-id="item.productId"
                      variant="order"
                    />
                  </span>
                  <span class="admin-muted small">
                    {{ item.quantity }} × {{ formatPrice(item.unitPrice, order.currency) }}
                  </span>
                  <strong>{{ formatPrice(item.lineTotal, order.currency) }}</strong>
                </li>
              </ul>

              <dl class="facts">
                <div>
                  <dt>Получатель</dt>
                  <dd>{{ order.customerName }}, {{ order.customerPhone }}</dd>
                </div>
                <div v-if="order.customerEmail">
                  <dt>E-mail</dt>
                  <dd>{{ order.customerEmail }}</dd>
                </div>
                <div v-if="order.deliveryAddress">
                  <dt>Адрес</dt>
                  <dd>{{ order.deliveryAddress }}</dd>
                </div>
                <div v-if="order.promoCodeLabel">
                  <dt>Промокод</dt>
                  <dd>
                    {{ order.promoCodeLabel }} (−{{
                      formatPrice(order.discountTotal, order.currency)
                    }})
                  </dd>
                </div>
                <div v-if="order.comment">
                  <dt>Комментарий</dt>
                  <dd>{{ order.comment }}</dd>
                </div>
              </dl>
            </div>
          </li>
        </ul>

        <h2>История</h2>
        <UiEmpty
          v-if="!pastOrders.length"
          icon="box"
          title="Завершённых заказов нет"
          description="Доставленные и отменённые заказы собираются здесь."
        />
        <UiTable
          v-else
          :columns="[
            { key: 'number', label: '№', width: '90px', nowrap: true },
            { key: 'createdAt', label: 'Дата', width: '170px', nowrap: true },
            { key: 'status', label: 'Статус', width: '140px', nowrap: true },
            { key: 'items', label: 'Состав' },
            { key: 'total', label: 'Сумма', width: '130px', align: 'end', nowrap: true }
          ]"
          :rows="pastOrders"
          row-key="id"
        >
          <template #cell-number="{ row }">
            <strong>{{ row.number }}</strong>
          </template>

          <template #cell-createdAt="{ row }">
            {{ formatDateTime(row.createdAt) }}
          </template>

          <template #cell-status="{ row }">
            <UiBadge :tone="ORDER_STATUS_TONE[row.status as OrderStatus]" size="sm">
              {{ ORDER_STATUS_LABEL[row.status as OrderStatus] }}
            </UiBadge>
          </template>

          <template #cell-items="{ row }">
            <span>{{ row.items.length }} позиц.</span>
            <p class="admin-muted hint">
              {{ row.items.map((item: OrderItem) => item.productName).join(', ') }}
            </p>
          </template>

          <template #cell-total="{ row }">
            <strong>{{ formatPrice(row.total, row.currency) }}</strong>
          </template>
        </UiTable>
      </section>
    </template>

    <UiModal v-model:open="resetOpen" title="Сбросить пароль" size="sm">
      <UiAlert v-if="resetError" tone="danger" class="form-error">{{ resetError }}</UiAlert>
      <UiField
        label="Новый пароль"
        required
        hint="Все сессии пользователя будут завершены"
        for="reset-password"
      >
        <UiInput
          id="reset-password"
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
        />
      </UiField>
      <template #footer>
        <UiButton variant="ghost" @click="resetOpen = false">Отмена</UiButton>
        <UiButton :loading="resetBusy" @click="resetPassword">Сохранить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.back a {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.back a:hover {
  color: var(--text-link);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: var(--space-2);
  gap: var(--space-2);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.facts {
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: var(--space-2);
}

.facts > div {
  display: flex;
  justify-content: space-between;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-4);
  font-size: var(--text-sm);
}

.facts > div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  margin: 0;
  color: var(--text-strong);
  font-weight: 600;
  text-align: end;
}

.orders {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.orders h2 {
  margin-top: var(--space-3);
  font-size: var(--text-xl);
}

.order-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.order {
  display: flex;
  flex-direction: column;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.order.is-active {
  border-left: 3px solid var(--brand);
}

.order-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.order-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.order-facts {
  display: grid;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-3);
}

.order-facts dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.order-facts dd {
  margin: 0;
  color: var(--text-strong);
  font-weight: 700;
}

.order-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.status-select {
  min-width: 170px;
}

.order-details {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-4);
}

.order-items {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-2);
  list-style: none;
}

.order-item {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-3);
  font-size: var(--text-sm);
}

/* Name over its supplier links, so the price columns stay on one line. */
.order-item-name {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.small {
  font-size: var(--text-sm);
}

.hint {
  overflow: hidden;
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.form-error {
  margin-bottom: var(--space-4);
}
</style>
