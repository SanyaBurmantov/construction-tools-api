<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import type { AccountUser, CustomerType } from '~/composables/useAuth'

type OrderStatus =
  | 'NEW'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'

type AccountOrderItem = {
  id: string
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

type AccountOrder = {
  id: string
  number: number
  status: OrderStatus
  currency: string
  itemsTotal: number
  deliveryCost: number
  discountTotal: number
  total: number
  promoCodeLabel: string | null
  deliveryMethod: 'PICKUP' | 'COURIER' | 'POST'
  deliveryAddress: string | null
  paymentMethod: 'CASH' | 'CARD' | 'INVOICE'
  comment: string | null
  customerName: string
  customerPhone: string
  customerEmail: string | null
  createdAt: string
  items: AccountOrderItem[]
}

type AccountPromoCode = {
  id: string
  code: string
  description: string | null
  type: 'PERCENT' | 'FIXED'
  value: number
  minOrderTotal: number | null
  freeDelivery: boolean
  endsAt: string | null
  usesLeft: number | null
}

type Summary = {
  user: AccountUser
  orders: {
    total: number
    byStatus: Partial<Record<OrderStatus, number>>
    totalSpent: number
    last: {
      id: string
      number: number
      status: OrderStatus
      total: number
      createdAt: string
    } | null
  }
  promoCodes: { available: number }
}

const {
  user,
  isAdmin,
  authFetch,
  refresh,
  logout,
  logoutEverywhere,
  updateProfile,
  changePassword,
  deleteAccount,
  errorMessage,
} = useAuth()
const cart = useCartStore()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()
const route = useRoute()
const router = useRouter()

/* ---- Sections ---------------------------------------------------------- */
const SECTIONS = ['overview', 'orders', 'promo', 'settings'] as const
type Section = (typeof SECTIONS)[number]

const section = ref<Section>('overview')

/** The open section lives in the URL, so a link can point straight at one. */
watch(
  () => route.query.tab,
  (tab) => {
    const next = typeof tab === 'string' ? tab : ''
    section.value = (SECTIONS as readonly string[]).includes(next)
      ? (next as Section)
      : 'overview'
  },
  { immediate: true }
)

/**
 * Section data is fetched lazily, but only once the session is restored:
 * watchers run before `onMounted`, so firing a request here on a deep link
 * would hit the API with no Authorization header and get a 401.
 */
const booted = ref(false)

watch(section, (value) => {
  void router.replace({ query: value === 'overview' ? {} : { tab: value } })
  if (!booted.value) return
  if (value === 'orders' && !orders.value.length) void loadOrders()
  if (value === 'promo' && !promoCodes.value.length) void loadPromoCodes()
})

const tabs = computed(() => [
  { value: 'overview', label: 'Общая информация' },
  { value: 'orders', label: 'История заказов', count: summary.value?.orders.total ?? null },
  { value: 'promo', label: 'Промокоды', count: summary.value?.promoCodes.available ?? null },
  { value: 'settings', label: 'Настройки' },
])

/* ---- Load -------------------------------------------------------------- */
const loading = ref(true)
const loadError = ref('')
const summary = ref<Summary | null>(null)

/** Orders still in flight across the whole account, not just this page. */
const ACTIVE_STATUSES: OrderStatus[] = ['NEW', 'CONFIRMED', 'PROCESSING', 'SHIPPED']
const activeOrdersCount = computed(() =>
  ACTIVE_STATUSES.reduce(
    (sum, status) => sum + (summary.value?.orders.byStatus[status] ?? 0),
    0
  )
)

async function loadSummary() {
  try {
    summary.value = await authFetch<Summary>('/account/summary')
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить данные кабинета')
  }
}

onMounted(async () => {
  await refresh()
  if (!user.value) {
    await navigateTo('/login?redirect=/account&reason=account')
    return
  }
  cart.load()
  fillProfileForm()
  await loadSummary()
  loading.value = false
  booted.value = true
  // A deep link straight into a section still needs that section's data.
  if (section.value === 'orders') void loadOrders()
  if (section.value === 'promo') void loadPromoCodes()
})

/* ---- Orders ------------------------------------------------------------ */
const orders = ref<AccountOrder[]>([])
const ordersLoading = ref(false)
const ordersError = ref('')
const ordersPage = ref(1)
const ordersPages = ref(1)
const ordersTotal = ref(0)
const statusFilter = ref<'' | OrderStatus>('')
const expandedOrder = ref<string>('')

const STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  PROCESSING: 'Собирается',
  SHIPPED: 'Отправлен',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
}

const STATUS_TONE: Record<OrderStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  NEW: 'info',
  CONFIRMED: 'info',
  PROCESSING: 'warning',
  SHIPPED: 'warning',
  DELIVERED: 'success',
  CANCELLED: 'danger',
}

const DELIVERY_LABEL: Record<AccountOrder['deliveryMethod'], string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
}

const PAYMENT_LABEL: Record<AccountOrder['paymentMethod'], string> = {
  CASH: 'Наличными',
  CARD: 'Картой',
  INVOICE: 'По счёту',
}

/** Orders still in flight — the ones a customer actually watches. */
const activeOrders = computed(() =>
  orders.value.filter(order => !['DELIVERED', 'CANCELLED'].includes(order.status))
)

async function loadOrders() {
  ordersLoading.value = true
  ordersError.value = ''
  try {
    const response = await authFetch<{
      data: AccountOrder[]
      pagination: { page: number, pages: number, total: number }
    }>('/account/orders', {
      params: {
        page: ordersPage.value,
        status: statusFilter.value || undefined,
      },
    })
    orders.value = response.data
    ordersPage.value = response.pagination.page
    ordersPages.value = response.pagination.pages
    ordersTotal.value = response.pagination.total
  } catch (error) {
    ordersError.value = errorMessage(error, 'Не удалось загрузить заказы')
  } finally {
    ordersLoading.value = false
  }
}

watch(statusFilter, () => {
  ordersPage.value = 1
  void loadOrders()
})

function goToOrdersPage(page: number) {
  ordersPage.value = page
  void loadOrders()
}

/**
 * Puts the order's lines back into the cart. Prices come from the order
 * snapshot, which may be months old — the cart screen re-prices everything
 * through POST /cart/validate and flags whatever moved, so nothing here can
 * quietly resurrect an old price.
 */
function repeatOrder(order: AccountOrder) {
  const items = order.items.filter(item => item.productId)
  if (!items.length) {
    toast.warning('Товары из этого заказа больше не доступны')
    return
  }

  for (const item of items) {
    cart.add(
      {
        productId: item.productId as string,
        slug: item.productSlug,
        name: item.productName,
        sku: item.productSku,
        image: item.productImage,
        price: item.unitPrice,
        currency: order.currency,
      },
      item.quantity
    )
  }

  const skipped = order.items.length - items.length
  toast.success(
    skipped
      ? `Добавлено в корзину, ${skipped} позиц. недоступно`
      : 'Товары добавлены в корзину'
  )
  void navigateTo('/cart')
}

/* ---- Promo codes ------------------------------------------------------- */
const promoCodes = ref<AccountPromoCode[]>([])
const promoLoading = ref(false)
const promoError = ref('')
const copiedCode = ref('')

async function loadPromoCodes() {
  promoLoading.value = true
  promoError.value = ''
  try {
    const response = await authFetch<{ data: AccountPromoCode[] }>('/account/promo-codes')
    promoCodes.value = response.data
  } catch (error) {
    promoError.value = errorMessage(error, 'Не удалось загрузить промокоды')
  } finally {
    promoLoading.value = false
  }
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    copiedCode.value = code
    toast.success(`Промокод ${code} скопирован`)
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = ''
    }, 2000)
  } catch {
    // Clipboard is blocked (no permission, or an insecure origin) — the code
    // is on screen anyway, so this is not worth an error toast.
    toast.info('Скопируйте код вручную')
  }
}

const discountLabel = (code: AccountPromoCode) =>
  code.type === 'PERCENT' ? `−${code.value}%` : `−${formatPrice(code.value, 'BYN')}`

/* ---- Settings: profile ------------------------------------------------- */
const profile = reactive({
  customerType: 'INDIVIDUAL' as CustomerType,
  name: '',
  email: '',
  phone: '',
  companyName: '',
  taxId: '',
})

function fillProfileForm() {
  if (!user.value) return
  profile.customerType = user.value.customerType
  profile.name = user.value.name ?? ''
  profile.email = user.value.email ?? ''
  profile.phone = user.value.phone ?? ''
  profile.companyName = user.value.companyName ?? ''
  profile.taxId = user.value.taxId ?? ''
}

const isCompany = computed(() => profile.customerType === 'COMPANY')
const savingProfile = ref(false)
const profileError = ref('')

async function saveProfile() {
  profileError.value = ''
  if (isCompany.value && !profile.companyName.trim()) {
    profileError.value = 'Для юридического лица укажите название организации'
    return
  }
  savingProfile.value = true
  try {
    await updateProfile({
      customerType: profile.customerType,
      name: profile.name.trim(),
      email: profile.email.trim() || undefined,
      phone: profile.phone.trim(),
      companyName: profile.companyName.trim(),
      taxId: profile.taxId.trim(),
    })
    await loadSummary()
    toast.success('Данные сохранены')
  } catch (error) {
    profileError.value = errorMessage(error, 'Не удалось сохранить данные')
  } finally {
    savingProfile.value = false
  }
}

/* ---- Settings: password & sessions ------------------------------------- */
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirm: '' })
const savingPassword = ref(false)
const passwordError = ref('')

async function savePassword() {
  passwordError.value = ''
  if (passwordForm.newPassword.length < 8) {
    passwordError.value = 'Новый пароль должен быть не короче 8 символов'
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirm) {
    passwordError.value = 'Пароли не совпадают'
    return
  }
  savingPassword.value = true
  try {
    await changePassword({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    })
    Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirm: '' })
    toast.success('Пароль изменён — остальные устройства разлогинены')
  } catch (error) {
    passwordError.value = errorMessage(error, 'Не удалось изменить пароль')
  } finally {
    savingPassword.value = false
  }
}

const signingOutEverywhere = ref(false)

async function signOutEverywhere() {
  signingOutEverywhere.value = true
  try {
    await logoutEverywhere()
    toast.info('Вы вышли на всех устройствах')
    await navigateTo('/')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось завершить сессии'))
  } finally {
    signingOutEverywhere.value = false
  }
}

async function signOut() {
  await logout()
  toast.info('Вы вышли из аккаунта')
  await navigateTo('/')
}

/* ---- Settings: closing the account ------------------------------------- */
const deleteOpen = ref(false)
const deletePassword = ref('')
const deleteError = ref('')
const deleting = ref(false)

async function confirmDelete() {
  deleteError.value = ''
  if (!deletePassword.value) {
    deleteError.value = 'Введите пароль'
    return
  }
  deleting.value = true
  try {
    await deleteAccount(deletePassword.value)
    toast.info('Аккаунт удалён')
    await navigateTo('/')
  } catch (error) {
    deleteError.value = errorMessage(error, 'Не удалось удалить аккаунт')
  } finally {
    deleting.value = false
  }
}

/* ---- Display ----------------------------------------------------------- */
const dateFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const dateTimeFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const formatDate = (iso: string | null) => (iso ? dateFormatter.format(new Date(iso)) : '—')
const formatDateTime = (iso: string | null) =>
  iso ? dateTimeFormatter.format(new Date(iso)) : '—'

const TYPE_LABEL: Record<CustomerType, string> = {
  INDIVIDUAL: 'Физическое лицо',
  COMPANY: 'Юридическое лицо',
}

useSeoMeta({ title: 'Личный кабинет | Мультитул', robots: 'noindex,nofollow' })
</script>

<template>
  <div class="account-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Личный кабинет' }]" />

    <header class="head">
      <div>
        <h1>Личный кабинет</h1>
        <p v-if="user" class="who">
          {{ user.login }}
          <UiBadge size="sm">{{ TYPE_LABEL[user.customerType] }}</UiBadge>
          <UiBadge v-if="isAdmin" tone="brand" size="sm">Администратор</UiBadge>
        </p>
      </div>
      <div class="head-actions">
        <UiButton v-if="isAdmin" to="/admin" variant="secondary">Админка</UiButton>
        <UiButton variant="ghost" @click="signOut">Выйти</UiButton>
      </div>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <UiSkeleton v-if="loading" height="420px" radius="var(--radius-md)" />

    <template v-else>
      <UiTabs v-model="section" :tabs="tabs" />

      <!-- ============ Общая информация ============ -->
      <section v-if="section === 'overview'" class="pane">
        <div class="stats">
          <UiStat label="Заказов" :value="summary?.orders.total ?? 0" />
          <UiStat
            label="В работе"
            :value="activeOrdersCount"
            hint="новые, в сборке и в пути"
            tone="brand"
          />
          <UiStat
            label="Куплено на сумму"
            :value="formatPrice(summary?.orders.totalSpent ?? 0, 'BYN')"
            hint="без отменённых заказов"
          />
          <UiStat
            label="Промокодов доступно"
            :value="summary?.promoCodes.available ?? 0"
            tone="success"
          />
        </div>

        <div class="overview-grid">
          <UiCard title="Данные покупателя">
            <dl class="facts">
              <div>
                <dt>Логин</dt>
                <dd>{{ user?.login }}</dd>
              </div>
              <div>
                <dt>Тип покупателя</dt>
                <dd>{{ user ? TYPE_LABEL[user.customerType] : '—' }}</dd>
              </div>
              <div v-if="user?.customerType === 'COMPANY'">
                <dt>Организация</dt>
                <dd>{{ user?.companyName || '—' }}</dd>
              </div>
              <div v-if="user?.customerType === 'COMPANY'">
                <dt>УНП</dt>
                <dd>{{ user?.taxId || '—' }}</dd>
              </div>
              <div>
                <dt>{{ user?.customerType === 'COMPANY' ? 'Контактное лицо' : 'Имя' }}</dt>
                <dd>{{ user?.name || '—' }}</dd>
              </div>
              <div>
                <dt>Телефон</dt>
                <dd>{{ user?.phone || '—' }}</dd>
              </div>
              <div>
                <dt>E-mail</dt>
                <dd>{{ user?.email || '—' }}</dd>
              </div>
              <div>
                <dt>Регистрация</dt>
                <dd>{{ formatDate(user?.createdAt ?? null) }}</dd>
              </div>
            </dl>
            <template #actions>
              <UiButton size="sm" variant="ghost" @click="section = 'settings'">
                Изменить
              </UiButton>
            </template>
          </UiCard>

          <UiCard title="Последний заказ">
            <div v-if="summary?.orders.last" class="last-order">
              <div class="last-order-head">
                <strong>№ {{ summary.orders.last.number }}</strong>
                <UiBadge :tone="STATUS_TONE[summary.orders.last.status]" size="sm">
                  {{ STATUS_LABEL[summary.orders.last.status] }}
                </UiBadge>
              </div>
              <p class="muted">{{ formatDateTime(summary.orders.last.createdAt) }}</p>
              <strong class="last-order-total">
                {{ formatPrice(summary.orders.last.total, 'BYN') }}
              </strong>
              <UiButton size="sm" variant="secondary" @click="section = 'orders'">
                Все заказы
              </UiButton>
            </div>
            <UiEmpty
              v-else
              icon="cart"
              title="Заказов пока нет"
              description="Оформленные заказы появятся здесь — вместе с составом и суммами."
            >
              <UiButton to="/catalog/">Перейти в каталог</UiButton>
            </UiEmpty>
          </UiCard>
        </div>
      </section>

      <!-- ============ История заказов ============ -->
      <section v-else-if="section === 'orders'" class="pane">
        <div class="pane-head">
          <div>
            <h2>История заказов</h2>
            <p class="muted">
              {{ ordersTotal }} всего<template v-if="activeOrders.length">
                , {{ activeOrders.length }} в работе на этой странице</template>
            </p>
          </div>
          <UiSelect
            v-model="statusFilter"
            size="sm"
            class="status-filter"
            :options="[
              { value: '', label: 'Все статусы' },
              { value: 'NEW', label: 'Новые' },
              { value: 'CONFIRMED', label: 'Подтверждённые' },
              { value: 'PROCESSING', label: 'В сборке' },
              { value: 'SHIPPED', label: 'Отправленные' },
              { value: 'DELIVERED', label: 'Доставленные' },
              { value: 'CANCELLED', label: 'Отменённые' }
            ]"
          />
        </div>

        <UiAlert v-if="ordersError" tone="danger">{{ ordersError }}</UiAlert>

        <div v-if="ordersLoading" class="order-list">
          <UiSkeleton v-for="i in 3" :key="i" height="130px" radius="var(--radius-md)" />
        </div>

        <UiEmpty
          v-else-if="!orders.length"
          icon="cart"
          :title="statusFilter ? 'Заказов с таким статусом нет' : 'Заказов пока нет'"
          description="Оформите первый заказ — он появится здесь со всеми позициями и суммами."
        >
          <UiButton to="/catalog/">Перейти в каталог</UiButton>
        </UiEmpty>

        <ul v-else class="order-list">
          <li v-for="order in orders" :key="order.id" class="order">
            <div class="order-head">
              <div class="order-title">
                <strong>Заказ № {{ order.number }}</strong>
                <UiBadge :tone="STATUS_TONE[order.status]" size="sm">
                  {{ STATUS_LABEL[order.status] }}
                </UiBadge>
              </div>
              <span class="muted">{{ formatDateTime(order.createdAt) }}</span>
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
                {{ expandedOrder === order.id ? 'Свернуть' : 'Состав заказа' }}
              </UiButton>
              <UiButton size="sm" variant="ghost" @click="repeatOrder(order)">
                Повторить заказ
              </UiButton>
            </div>

            <div v-if="expandedOrder === order.id" class="order-details">
              <ul class="order-items">
                <li v-for="item in order.items" :key="item.id" class="order-item">
                  <NuxtLink :to="`/product/${item.productSlug}`" class="order-item-link">
                    <img
                      v-if="item.productImage"
                      :src="item.productImage"
                      :alt="item.productName"
                      loading="lazy"
                    >
                    <span v-else class="order-item-thumb" aria-hidden="true" />
                    <span class="order-item-body">
                      <span class="order-item-name">{{ item.productName }}</span>
                      <span v-if="item.productSku" class="muted hint">
                        Арт. {{ item.productSku }}
                      </span>
                    </span>
                  </NuxtLink>
                  <span class="order-item-qty">
                    {{ item.quantity }} × {{ formatPrice(item.unitPrice, order.currency) }}
                  </span>
                  <strong class="order-item-total">
                    {{ formatPrice(item.lineTotal, order.currency) }}
                  </strong>
                </li>
              </ul>

              <dl class="order-totals">
                <div>
                  <dt>Товары</dt>
                  <dd>{{ formatPrice(order.itemsTotal, order.currency) }}</dd>
                </div>
                <div v-if="order.discountTotal">
                  <dt>
                    Скидка<template v-if="order.promoCodeLabel">
                      ({{ order.promoCodeLabel }})</template>
                  </dt>
                  <dd>−{{ formatPrice(order.discountTotal, order.currency) }}</dd>
                </div>
                <div>
                  <dt>Доставка</dt>
                  <dd>
                    {{ order.deliveryCost
                      ? formatPrice(order.deliveryCost, order.currency)
                      : 'бесплатно' }}
                  </dd>
                </div>
                <div class="is-total">
                  <dt>Итого</dt>
                  <dd>{{ formatPrice(order.total, order.currency) }}</dd>
                </div>
              </dl>

              <dl class="facts">
                <div>
                  <dt>Получатель</dt>
                  <dd>{{ order.customerName }}, {{ order.customerPhone }}</dd>
                </div>
                <div v-if="order.deliveryAddress">
                  <dt>Адрес</dt>
                  <dd>{{ order.deliveryAddress }}</dd>
                </div>
                <div v-if="order.comment">
                  <dt>Комментарий</dt>
                  <dd>{{ order.comment }}</dd>
                </div>
              </dl>
            </div>
          </li>
        </ul>

        <UiPagination
          :page="ordersPage"
          :pages="ordersPages"
          :total="ordersTotal"
          @change="goToOrdersPage"
        />
      </section>

      <!-- ============ Промокоды ============ -->
      <section v-else-if="section === 'promo'" class="pane">
        <div class="pane-head">
          <div>
            <h2>Доступные промокоды</h2>
            <p class="muted">
              Скидка применяется в корзине — код пересчитывается на сервере при
              оформлении заказа.
            </p>
          </div>
        </div>

        <UiAlert v-if="promoError" tone="danger">{{ promoError }}</UiAlert>

        <div v-if="promoLoading" class="promo-list">
          <UiSkeleton v-for="i in 3" :key="i" height="150px" radius="var(--radius-md)" />
        </div>

        <UiEmpty
          v-else-if="!promoCodes.length"
          icon="box"
          title="Сейчас нет активных промокодов"
          description="Как только появится новая акция, код будет здесь."
        >
          <UiButton to="/sales">Смотреть акции</UiButton>
        </UiEmpty>

        <ul v-else class="promo-list">
          <li v-for="code in promoCodes" :key="code.id" class="promo">
            <div class="promo-head">
              <code class="promo-code">{{ code.code }}</code>
              <strong class="promo-value">{{ discountLabel(code) }}</strong>
            </div>

            <p v-if="code.description" class="promo-description">{{ code.description }}</p>

            <dl class="facts">
              <div v-if="code.minOrderTotal">
                <dt>От суммы</dt>
                <dd>{{ formatPrice(code.minOrderTotal, 'BYN') }}</dd>
              </div>
              <div v-if="code.freeDelivery">
                <dt>Доставка</dt>
                <dd>бесплатно</dd>
              </div>
              <div v-if="code.endsAt">
                <dt>Действует до</dt>
                <dd>{{ formatDate(code.endsAt) }}</dd>
              </div>
              <div v-if="code.usesLeft != null">
                <dt>Осталось применений</dt>
                <dd>{{ code.usesLeft }}</dd>
              </div>
            </dl>

            <div class="promo-actions">
              <UiButton size="sm" variant="secondary" @click="copyCode(code.code)">
                {{ copiedCode === code.code ? 'Скопировано' : 'Скопировать код' }}
              </UiButton>
              <UiButton size="sm" variant="ghost" to="/cart">В корзину</UiButton>
            </div>
          </li>
        </ul>
      </section>

      <!-- ============ Настройки ============ -->
      <section v-else class="pane">
        <UiCard title="Данные покупателя">
          <form class="form" novalidate @submit.prevent="saveProfile">
            <UiAlert v-if="profileError" tone="danger">{{ profileError }}</UiAlert>

            <UiField
              label="Тип покупателя"
              hint="Для юридического лица нужны название организации и УНП"
              for="acc-type"
            >
              <UiSelect
                id="acc-type"
                v-model="profile.customerType"
                :options="[
                  { value: 'INDIVIDUAL', label: 'Физическое лицо' },
                  { value: 'COMPANY', label: 'Юридическое лицо' }
                ]"
              />
            </UiField>

            <div class="grid">
              <UiField :label="isCompany ? 'Контактное лицо' : 'Имя'" for="acc-name">
                <UiInput id="acc-name" v-model="profile.name" autocomplete="name" />
              </UiField>

              <UiField label="Телефон" for="acc-phone">
                <UiInput id="acc-phone" v-model="profile.phone" type="tel" autocomplete="tel" />
              </UiField>
            </div>

            <UiField label="E-mail" for="acc-email">
              <UiInput id="acc-email" v-model="profile.email" type="email" autocomplete="email" />
            </UiField>

            <template v-if="isCompany">
              <UiField label="Название организации" required for="acc-company">
                <UiInput id="acc-company" v-model="profile.companyName" />
              </UiField>

              <UiField label="УНП" for="acc-tax">
                <UiInput id="acc-tax" v-model="profile.taxId" />
              </UiField>
            </template>

            <div class="form-actions">
              <UiButton type="submit" :loading="savingProfile">Сохранить</UiButton>
            </div>
          </form>
        </UiCard>

        <UiCard title="Пароль">
          <form class="form" novalidate @submit.prevent="savePassword">
            <UiAlert v-if="passwordError" tone="danger">{{ passwordError }}</UiAlert>

            <UiField label="Текущий пароль" required for="acc-pass-current">
              <UiInput
                id="acc-pass-current"
                v-model="passwordForm.currentPassword"
                type="password"
                autocomplete="current-password"
              />
            </UiField>

            <div class="grid">
              <UiField
                label="Новый пароль"
                required
                hint="Минимум 8 символов"
                for="acc-pass-new"
              >
                <UiInput
                  id="acc-pass-new"
                  v-model="passwordForm.newPassword"
                  type="password"
                  autocomplete="new-password"
                />
              </UiField>

              <UiField label="Повторите пароль" required for="acc-pass-confirm">
                <UiInput
                  id="acc-pass-confirm"
                  v-model="passwordForm.confirm"
                  type="password"
                  autocomplete="new-password"
                />
              </UiField>
            </div>

            <p class="muted hint">
              После смены пароля остальные устройства разлогиниваются.
            </p>

            <div class="form-actions">
              <UiButton type="submit" :loading="savingPassword">Изменить пароль</UiButton>
            </div>
          </form>
        </UiCard>

        <UiCard title="Безопасность">
          <p class="muted">
            Если вы входили с чужого устройства, завершите все сессии — войти
            снова нужно будет с паролем.
          </p>
          <div class="form-actions">
            <UiButton
              variant="secondary"
              :loading="signingOutEverywhere"
              @click="signOutEverywhere"
            >
              Выйти на всех устройствах
            </UiButton>
          </div>
        </UiCard>

        <UiCard title="Удаление аккаунта">
          <p class="muted">
            Удалим профиль, корзину, избранное и сравнение. Оформленные заказы
            останутся в документах магазина — они нужны для бухгалтерии и
            гарантии, но перестанут быть связаны с аккаунтом. Отменить удаление
            нельзя.
          </p>
          <div class="form-actions">
            <UiButton variant="danger" @click="deleteOpen = true">
              Удалить аккаунт
            </UiButton>
          </div>
        </UiCard>
      </section>
    </template>

    <UiModal v-model:open="deleteOpen" title="Удалить аккаунт?" size="sm">
      <UiAlert v-if="deleteError" tone="danger" class="form-error">
        {{ deleteError }}
      </UiAlert>
      <p class="muted confirm-text">
        Введите пароль, чтобы подтвердить. Заказы останутся в документах
        магазина, но больше не будут связаны с этим аккаунтом.
      </p>
      <UiField label="Пароль" required for="delete-password">
        <UiInput
          id="delete-password"
          v-model="deletePassword"
          type="password"
          autocomplete="current-password"
        />
      </UiField>
      <template #footer>
        <UiButton variant="ghost" @click="deleteOpen = false">Отмена</UiButton>
        <UiButton variant="danger" :loading="deleting" @click="confirmDelete">
          Удалить навсегда
        </UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.account-page {
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

.who {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
  gap: var(--space-2);
}

.head-actions {
  display: flex;
  gap: var(--space-2);
}

.pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pane-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}

.pane-head h2 {
  font-size: var(--text-xl);
}

.status-filter {
  min-width: 220px;
}

.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.hint {
  font-size: var(--text-xs);
}

/* ---- Overview ---- */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-4);
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
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
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-2);
  gap: var(--space-4);
  font-size: var(--text-sm);
}

.facts > div:last-child {
  border-bottom: 0;
  padding-bottom: 0;
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

.last-order {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.last-order-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.last-order-total {
  font-size: var(--text-xl);
  letter-spacing: var(--tracking-tight);
}

/* ---- Orders ---- */
.order-list,
.promo-list {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-4);
  list-style: none;
}

.order {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
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
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
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
  gap: var(--space-2);
}

.order-details {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-4);
}

.order-items {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  gap: var(--space-3);
  list-style: none;
}

.order-item {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: var(--space-3);
}

.order-item-link {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-3);
}

.order-item-link img,
.order-item-thumb {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  object-fit: contain;
}

.order-item-body {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.order-item-name {
  overflow: hidden;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-item-qty {
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.order-item-total {
  white-space: nowrap;
}

.order-totals {
  display: flex;
  flex-direction: column;
  padding: var(--space-4);
  margin: 0;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  gap: var(--space-2);
}

.order-totals > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  font-size: var(--text-sm);
}

.order-totals dt {
  color: var(--text-muted);
}

.order-totals dd {
  margin: 0;
  font-weight: 600;
}

.order-totals .is-total {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-base);
}

.order-totals .is-total dd {
  font-weight: 800;
}

/* ---- Promo ---- */
.promo-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

.promo {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-3);
}

.promo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.promo-code {
  padding: var(--space-1) var(--space-3);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.promo-value {
  color: var(--sale);
  font-size: var(--text-xl);
  font-weight: 800;
}

.promo-description {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.promo-actions {
  display: flex;
  margin-top: auto;
  gap: var(--space-2);
}

/* ---- Settings ---- */
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-3);
}

.confirm-text {
  margin-bottom: var(--space-4);
}

.form-error {
  margin-bottom: var(--space-4);
}

@media (max-width: 900px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .order-item {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .order-item-qty {
    grid-column: 1 / -1;
  }
}
</style>
