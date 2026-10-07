<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { company } from '~/data/company'

interface OrderResponse {
  id: string
  number: number
  total: number
  currency: string
}

const cart = useCartStore()
const config = useRuntimeConfig()
const toast = useToast()
const { formatPrice } = useFormatPrice()
const promo = usePromoCode()
const cartValidation = useCartValidation()

// Costs come from runtimeConfig so they track the backend's DELIVERY_COST_*
// instead of drifting from it.
const deliveryOptions = computed(() => [
  {
    value: 'PICKUP' as const,
    label: 'Самовывоз',
    cost: 0,
    hint: company.storeAddress,
  },
  {
    value: 'COURIER' as const,
    label: 'Курьер',
    cost: Number(config.public.deliveryCourier),
    hint: 'По адресу, в течение 1–2 дней',
  },
  {
    value: 'POST' as const,
    label: 'Почта',
    cost: Number(config.public.deliveryPost),
    hint: 'Белпочта, по всей стране',
  },
])

const paymentOptions = [
  { value: 'CASH', label: 'Наличными', hint: 'При получении' },
  { value: 'CARD', label: 'Картой', hint: 'При получении' },
  { value: 'INVOICE', label: 'По счёту', hint: 'Для юридических лиц' },
] as const

const form = reactive({
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  comment: '',
  deliveryMethod: 'PICKUP' as 'PICKUP' | 'COURIER' | 'POST',
  deliveryAddress: '',
  paymentMethod: 'CASH' as 'CASH' | 'CARD' | 'INVOICE',
})

const submitting = ref(false)
const submitError = ref('')
const promoInput = ref('')

onMounted(async () => {
  cart.load()
  // Last chance to catch a stale price before the customer commits.
  await cartValidation.validate()
  await promo.restore()
  promoInput.value = promo.code.value
})

/** Blocking issues make the order impossible — the API would reject it. */
const hasBlockingIssues = computed(() => cartValidation.unavailableItems.value.length > 0)

const needsAddress = computed(() => form.deliveryMethod !== 'PICKUP')
const deliveryCost = computed(() => {
  const base
    = deliveryOptions.value.find((o) => o.value === form.deliveryMethod)?.cost ?? 0
  return promo.freeDelivery.value ? 0 : base
})
// Preview only — POST /orders recomputes every number server-side.
const estimatedTotal = computed(() =>
  Math.max(
    0,
    Math.round((cart.totalPrice - promo.discount.value + deliveryCost.value) * 100) / 100
  )
)

/* ---- Validation --------------------------------------------------------- */
// Errors are computed always but only shown for fields the user has left, or
// after a submit attempt — so the form doesn't shout at an untouched field.
const touched = reactive<Record<string, boolean>>({})
const submitAttempted = ref(false)

const errors = computed<Record<string, string>>(() => {
  const result: Record<string, string> = {}
  if (form.customerName.trim().length < 2) {
    result.customerName = 'Укажите имя, минимум 2 символа'
  }
  if (form.customerPhone.trim().length < 5) {
    result.customerPhone = 'Укажите телефон для связи'
  }
  if (form.customerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.customerEmail.trim())) {
    result.customerEmail = 'Проверьте адрес электронной почты'
  }
  if (needsAddress.value && form.deliveryAddress.trim().length < 3) {
    result.deliveryAddress = 'Для выбранной доставки нужен адрес'
  }
  return result
})

function visibleError(field: string) {
  return (touched[field] || submitAttempted.value) ? errors.value[field] : undefined
}

const canSubmit = computed(
  () =>
    !cart.isEmpty
    && !submitting.value
    && !hasBlockingIssues.value
    && Object.keys(errors.value).length === 0
)

/* ---- Promo -------------------------------------------------------------- */
async function applyPromo() {
  const ok = await promo.validate(promoInput.value)
  if (ok) toast.success(`Промокод ${promo.code.value} применён`)
}

function removePromo() {
  promo.clear()
  promoInput.value = ''
}

/* ---- Submit ------------------------------------------------------------- */
async function submit() {
  submitAttempted.value = true
  if (!canSubmit.value) return

  submitting.value = true
  submitError.value = ''
  try {
    const order = await $fetch<OrderResponse>(`${config.public.apiBase}/orders`, {
      method: 'POST',
      body: {
        items: cart.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        customerEmail: form.customerEmail.trim() || undefined,
        comment: form.comment.trim() || undefined,
        deliveryMethod: form.deliveryMethod,
        deliveryAddress: needsAddress.value ? form.deliveryAddress.trim() : undefined,
        paymentMethod: form.paymentMethod,
        promoCode: promo.code.value || undefined,
        // Lets the API refuse the order rather than charge a total the
        // customer never saw.
        expectedItemsTotal: cart.totalPrice,
      },
    })
    cart.clear()
    promo.clear()
    await navigateTo({ path: '/checkout/success', query: { id: order.id } })
  } catch (error) {
    const status
      = (error as { statusCode?: number }).statusCode
        ?? (error as { status?: number }).status

    // 409 means the prices moved between loading the page and submitting.
    // Re-validate so the warning block shows exactly what changed.
    if (status === 409) {
      await cartValidation.validate()
      submitError.value
        = 'Цены изменились, пока вы оформляли заказ. Проверьте суммы и подтвердите ещё раз.'
      return
    }

    const message = (error as { data?: { message?: string | string[] } }).data?.message
    submitError.value = Array.isArray(message)
      ? message.join(', ')
      : message || 'Не удалось оформить заказ. Попробуйте ещё раз.'
  } finally {
    submitting.value = false
  }
}

useHead({
  title: 'Оформление заказа | Мультитул',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <div class="checkout-page">
    <UiBreadcrumbs
      :items="[
        { label: 'Главная', to: '/' },
        { label: 'Корзина', to: '/cart' },
        { label: 'Оформление' }
      ]"
    />

    <h1>Оформление заказа</h1>

    <ClientOnly>
      <template #fallback>
        <UiSkeleton height="400px" radius="var(--radius-md)" />
      </template>

      <UiEmpty
        v-if="cart.isEmpty"
        icon="cart"
        title="Корзина пуста"
        description="Нечего оформлять — добавьте товары из каталога."
      >
        <UiButton to="/catalog/">Перейти в каталог</UiButton>
      </UiEmpty>

      <form v-else class="layout" novalidate @submit.prevent="submit">
        <CartIssues class="issues" />

        <div class="fields">
          <UiCard title="Контактные данные">
            <div class="field-grid">
              <UiField
                label="Имя"
                required
                :error="visibleError('customerName')"
                for="co-name"
              >
                <UiInput
                  id="co-name"
                  v-model="form.customerName"
                  placeholder="Как к вам обращаться"
                  autocomplete="name"
                  :invalid="Boolean(visibleError('customerName'))"
                  @blur="touched.customerName = true"
                />
              </UiField>

              <UiField
                label="Телефон"
                required
                :error="visibleError('customerPhone')"
                for="co-phone"
              >
                <UiInput
                  id="co-phone"
                  v-model="form.customerPhone"
                  type="tel"
                  placeholder="+375 (__) ___-__-__"
                  autocomplete="tel"
                  :invalid="Boolean(visibleError('customerPhone'))"
                  @blur="touched.customerPhone = true"
                />
              </UiField>

              <UiField
                label="Email"
                hint="Пришлём копию заказа"
                :error="visibleError('customerEmail')"
                for="co-email"
                class="span-2"
              >
                <UiInput
                  id="co-email"
                  v-model="form.customerEmail"
                  type="email"
                  placeholder="you@example.com"
                  autocomplete="email"
                  :invalid="Boolean(visibleError('customerEmail'))"
                  @blur="touched.customerEmail = true"
                />
              </UiField>
            </div>
          </UiCard>

          <UiCard title="Доставка">
            <fieldset class="options">
              <legend class="sr-only">Способ доставки</legend>
              <label
                v-for="option in deliveryOptions"
                :key="option.value"
                class="option"
                :class="{ 'is-active': form.deliveryMethod === option.value }"
              >
                <input v-model="form.deliveryMethod" type="radio" :value="option.value">
                <span class="option-body">
                  <span class="option-label">{{ option.label }}</span>
                  <span class="option-hint">{{ option.hint }}</span>
                </span>
                <span class="option-cost">
                  {{ option.cost ? formatPrice(option.cost, cart.currency) : 'бесплатно' }}
                </span>
              </label>
            </fieldset>

            <UiField
              v-if="needsAddress"
              label="Адрес доставки"
              required
              :error="visibleError('deliveryAddress')"
              for="co-address"
              class="address"
            >
              <UiInput
                id="co-address"
                v-model="form.deliveryAddress"
                placeholder="Город, улица, дом, квартира"
                autocomplete="street-address"
                :invalid="Boolean(visibleError('deliveryAddress'))"
                @blur="touched.deliveryAddress = true"
              />
            </UiField>
          </UiCard>

          <UiCard title="Оплата">
            <fieldset class="options">
              <legend class="sr-only">Способ оплаты</legend>
              <label
                v-for="option in paymentOptions"
                :key="option.value"
                class="option"
                :class="{ 'is-active': form.paymentMethod === option.value }"
              >
                <input v-model="form.paymentMethod" type="radio" :value="option.value">
                <span class="option-body">
                  <span class="option-label">{{ option.label }}</span>
                  <span class="option-hint">{{ option.hint }}</span>
                </span>
              </label>
            </fieldset>
          </UiCard>

          <UiCard title="Комментарий">
            <UiField label="Пожелания к заказу" for="co-comment">
              <UiTextarea
                id="co-comment"
                v-model="form.comment"
                :rows="3"
                :maxlength="2000"
                placeholder="Удобное время доставки, детали по товару и т. п."
              />
            </UiField>
          </UiCard>
        </div>

        <aside class="summary">
          <div class="summary-card">
            <h2>Ваш заказ</h2>

            <ul class="summary-items">
              <li v-for="item in cart.items" :key="item.productId">
                <span class="qty">{{ item.quantity }}×</span>
                <NuxtLink :to="`/product/${item.slug}`" class="name">{{ item.name }}</NuxtLink>
                <span class="sum">{{ formatPrice(item.price * item.quantity, item.currency) }}</span>
              </li>
            </ul>

            <UiField label="Промокод" :error="promo.error.value">
              <div v-if="!promo.preview.value" class="promo-input">
                <UiInput
                  v-model="promoInput"
                  placeholder="Введите код"
                  size="sm"
                  :invalid="Boolean(promo.error.value)"
                  @keydown.enter.prevent="applyPromo"
                />
                <UiButton
                  variant="secondary"
                  size="sm"
                  :loading="promo.validating.value"
                  @click="applyPromo"
                >
                  ОК
                </UiButton>
              </div>
              <div v-else class="promo-applied">
                <div>
                  <code>{{ promo.preview.value.code }}</code>
                  <span v-if="promo.preview.value.freeDelivery">+ бесплатная доставка</span>
                </div>
                <button type="button" aria-label="Убрать промокод" @click="removePromo">✕</button>
              </div>
            </UiField>

            <dl class="totals">
              <div>
                <dt>Товары ({{ cart.count }})</dt>
                <dd>{{ formatPrice(cart.totalPrice, cart.currency) }}</dd>
              </div>
              <div v-if="promo.discount.value" class="is-discount">
                <dt>Скидка ({{ promo.code.value }})</dt>
                <dd>−{{ formatPrice(promo.discount.value, cart.currency) }}</dd>
              </div>
              <div>
                <dt>
                  Доставка<template v-if="promo.freeDelivery.value"> (по промокоду)</template>
                </dt>
                <dd>
                  {{ deliveryCost ? formatPrice(deliveryCost, cart.currency) : 'бесплатно' }}
                </dd>
              </div>
              <div class="is-total">
                <dt>Итого</dt>
                <dd>{{ formatPrice(estimatedTotal, cart.currency) }}</dd>
              </div>
            </dl>

            <UiAlert v-if="submitError" tone="danger">{{ submitError }}</UiAlert>
            <UiAlert v-else-if="hasBlockingIssues" tone="danger">
              Уберите недоступные товары, чтобы продолжить.
            </UiAlert>
            <UiAlert v-else-if="submitAttempted && !canSubmit" tone="warning">
              Заполните обязательные поля, отмеченные звёздочкой.
            </UiAlert>

            <UiButton type="submit" size="lg" block :loading="submitting">
              Подтвердить заказ
            </UiButton>

            <p class="consent">
              Нажимая «Подтвердить заказ», вы принимаете условия
              <NuxtLink to="/oferta">публичной оферты</NuxtLink> и даёте согласие
              на обработку персональных данных в соответствии с
              <NuxtLink to="/privacy">политикой</NuxtLink>.
            </p>

            <UiButton variant="ghost" block to="/cart">Вернуться в корзину</UiButton>
          </div>
        </aside>
      </form>
    </ClientOnly>
  </div>
</template>

<style scoped>
.checkout-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.layout {
  display: grid;
  align-items: start;
  gap: var(--space-6);
  grid-template-columns: minmax(0, 1fr) 380px;
}

/* Warnings span both columns, above the form and the summary. */
.issues {
  grid-column: 1 / -1;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.field-grid .span-2 {
  grid-column: 1 / -1;
}

/* ---- Radio cards ---- */
.options {
  display: grid;
  padding: 0;
  border: 0;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}

.option {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  cursor: pointer;
  gap: var(--space-3);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.option:hover {
  border-color: var(--border-strong);
}

.option.is-active {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.option input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.option:has(input:focus-visible) {
  box-shadow: var(--shadow-focus);
}

.option-body {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.option-label {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.option-hint {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.option-cost {
  flex-shrink: 0;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
  white-space: nowrap;
}

.address {
  margin-top: var(--space-4);
}

/* ---- Summary ---- */
.summary {
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
}

.summary-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
  gap: var(--space-4);
}

.summary-card h2 {
  font-size: var(--text-lg);
}

.summary-items {
  display: flex;
  max-height: 260px;
  overflow-y: auto;
  flex-direction: column;
  padding: 0 0 var(--space-4);
  margin: 0;
  border-bottom: 1px solid var(--border-subtle);
  gap: var(--space-2);
  list-style: none;
}

.summary-items li {
  display: grid;
  align-items: baseline;
  gap: var(--space-2);
  grid-template-columns: auto 1fr auto;
  font-size: var(--text-sm);
}

.qty {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.name {
  overflow: hidden;
  color: var(--text-default);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name:hover {
  color: var(--text-link);
}

.sum {
  color: var(--text-strong);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.promo-input {
  display: flex;
  gap: var(--space-2);
}

.promo-applied {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--success-soft);
  border-radius: var(--radius-sm);
  background: var(--success-soft);
  gap: var(--space-2);
}

.promo-applied > div {
  display: flex;
  flex-direction: column;
}

.promo-applied code {
  color: var(--success-soft-text);
  font-family: var(--font-mono);
  font-weight: 700;
}

.promo-applied span {
  color: var(--success-soft-text);
  font-size: var(--text-xs);
}

.promo-applied button {
  color: var(--success-soft-text);
}

.totals {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-4);
  margin: 0;
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-2);
}

.totals > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.totals dd {
  margin: 0;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.totals .is-discount,
.totals .is-discount dd {
  color: var(--sale);
  font-weight: 600;
}

.totals .is-total {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-strong);
  font-size: var(--text-lg);
  font-weight: 800;
}

.consent {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  line-height: var(--leading-snug);
}

.consent a {
  color: var(--text-link);
}

.consent a:hover {
  text-decoration: underline;
}

/* ---- Responsive ---- */
@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .summary {
    position: static;
  }
}

@media (max-width: 560px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
