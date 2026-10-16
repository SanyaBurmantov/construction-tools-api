<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { company } from '~/data/company'
import type { DeliveryMethod, Order, PaymentMethod } from '~/types/api'

const cart = useCartStore()
const config = useRuntimeConfig()
const { ensureAuthenticated } = useCheckoutAuth()
const { user, authFetch, errorMessage } = useAuth()
const { formatPrice } = useFormatPrice()
const promo = usePromoCode()
const cartValidation = useCartValidation()

// Costs come from runtimeConfig so they track the backend's DELIVERY_COST_*
// instead of drifting from it.
const deliveryOptions = computed(() => [
  {
    value: 'PICKUP' as const,
    label: DELIVERY_LABEL.PICKUP,
    cost: 0,
    hint: company.storeAddress,
  },
  {
    value: 'COURIER' as const,
    label: DELIVERY_LABEL.COURIER,
    cost: Number(config.public.deliveryCourier),
    hint: 'По адресу, в течение 1–2 дней',
  },
  {
    value: 'POST' as const,
    label: DELIVERY_LABEL.POST,
    cost: Number(config.public.deliveryPost),
    hint: 'Белпочта, по всей стране',
  },
])

const paymentOptions = [
  { value: 'CASH' as const, label: PAYMENT_LABEL.CASH, hint: 'При получении' },
  { value: 'CARD' as const, label: PAYMENT_LABEL.CARD, hint: 'При получении' },
  { value: 'INVOICE' as const, label: PAYMENT_LABEL.INVOICE, hint: 'Для юридических лиц' },
]

const form = reactive({
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  comment: '',
  deliveryMethod: 'PICKUP' as DeliveryMethod,
  deliveryAddress: '',
  paymentMethod: 'CASH' as PaymentMethod,
})

const submitting = ref(false)
const submitError = ref('')

onMounted(async () => {
  cart.load()
  // An account is required to order; a guest is sent to the login screen and
  // comes straight back here with the cart intact.
  if (!(await ensureAuthenticated('/checkout'))) return
  prefillFromAccount()
  // Last chance to catch a stale price before the customer commits.
  await cartValidation.validate()
})

/**
 * Saves retyping what the account already knows. Only fills blanks, so a
 * different recipient typed for this order is never overwritten.
 */
function prefillFromAccount() {
  const account = user.value
  if (!account) return
  if (!form.customerName.trim())
    form.customerName = account.name || account.companyName || ''
  if (!form.customerPhone.trim()) form.customerPhone = account.phone || ''
  if (!form.customerEmail.trim()) form.customerEmail = account.email || ''
}

/** Blocking issues make the order impossible — the API would reject it. */
const hasBlockingIssues = computed(() => cartValidation.unavailableItems.value.length > 0)

const needsAddress = computed(() => form.deliveryMethod !== 'PICKUP')
const deliveryCost = computed(() => {
  const base
    = deliveryOptions.value.find((o) => o.value === form.deliveryMethod)?.cost ?? 0
  return promo.freeDelivery.value ? 0 : base
})

/* ---- Validation --------------------------------------------------------- */
// Errors are computed always but only shown for fields the user has left, or
// after a submit attempt — so the form doesn't shout at an untouched field.
const touched = reactive<Record<string, boolean>>({})
const submitAttempted = ref(false)
/**
 * Согласие на обработку ПДн по Закону № 99-З — отдельное и явное, поэтому
 * чекбокс, не отмеченный заранее, а не «нажимая кнопку, вы соглашаетесь».
 * Проверяется только здесь: API заказа его не принимает и не хранит.
 */
const personalDataConsent = ref(false)

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
    && personalDataConsent.value
)

/* ---- Submit ------------------------------------------------------------- */
async function submit() {
  submitAttempted.value = true
  if (!canSubmit.value) return

  submitting.value = true
  submitError.value = ''
  try {
    // The session is what links the order to the account, so it shows up in
    // «История заказов». authFetch carries the cookie and the CSRF header.
    const order = await authFetch<Pick<Order, 'id'>>('/orders', {
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

    submitError.value = errorMessage(error, 'Не удалось оформить заказ. Попробуйте ещё раз.')
  } finally {
    submitting.value = false
  }
}

useHead({
  title: 'Оформление заказа | Gost.by',
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
        <UiButton to="/catalog">Перейти в каталог</UiButton>
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
            <UiRadioCards
              v-model="form.deliveryMethod"
              :options="deliveryOptions"
              legend="Способ доставки"
              hide-legend
            >
              <template #extra="{ option }">
                <span class="option-cost">
                  {{ option.cost ? formatPrice(option.cost, cart.currency) : 'бесплатно' }}
                </span>
              </template>
            </UiRadioCards>

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
            <UiRadioCards
              v-model="form.paymentMethod"
              :options="paymentOptions"
              legend="Способ оплаты"
              hide-legend
            />
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

        <CartOrderSummary
          title="Ваш заказ"
          total-label="Итого"
          :delivery-cost="deliveryCost"
          compact
        >
          <template #lines>
            <ul class="summary-items">
              <li v-for="item in cart.items" :key="item.productId">
                <span class="qty">{{ item.quantity }}×</span>
                <NuxtLink :to="`/product/${item.slug}`" class="name">{{ item.name }}</NuxtLink>
                <span class="sum">{{ formatPrice(item.price * item.quantity, item.currency) }}</span>
              </li>
            </ul>
          </template>

          <UiAlert v-if="submitError" tone="danger">{{ submitError }}</UiAlert>
          <UiAlert v-else-if="hasBlockingIssues" tone="danger">
            Уберите недоступные товары, чтобы продолжить.
          </UiAlert>
          <UiAlert
            v-else-if="submitAttempted && Object.keys(errors).length"
            tone="warning"
          >
            Заполните обязательные поля, отмеченные звёздочкой.
          </UiAlert>
          <UiAlert v-else-if="submitAttempted && !personalDataConsent" tone="warning">
            Чтобы оформить заказ, дайте согласие на обработку персональных данных.
          </UiAlert>

          <UiCheckbox v-model="personalDataConsent" class="consent-check">
            <span class="consent">
              Даю согласие на обработку персональных данных в соответствии с
              <NuxtLink to="/privacy" target="_blank">Политикой обработки персональных данных</NuxtLink>,
              в том числе на их трансграничную передачу для уведомления
              сотрудников магазина о заказе через Telegram.
            </span>
          </UiCheckbox>

          <UiButton type="submit" size="lg" block :loading="submitting">
            Подтвердить заказ
          </UiButton>

          <p class="consent">
            Заказ — это заявка: договор заключается, когда мы подтвердим
            заказ по телефону или e-mail. Оформляя заказ, вы соглашаетесь с
            <NuxtLink to="/usloviya" target="_blank">условиями продажи</NuxtLink>.
          </p>

          <UiButton variant="ghost" block to="/cart">Вернуться в корзину</UiButton>
        </CartOrderSummary>
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

.consent {
  color: var(--text-subtle);
  font-size: var(--text-xs);
  line-height: var(--leading-snug);
}

.layout .consent-check {
  align-items: flex-start;
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
}

@media (max-width: 560px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
