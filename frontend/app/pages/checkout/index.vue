<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

interface OrderResponse {
  id: string
  number: number
  total: number
  currency: string
}

const cart = useCartStore()
const config = useRuntimeConfig()
const { formatPrice } = useFormatPrice()

const deliveryOptions = [
  { value: 'PICKUP', label: 'Самовывоз', cost: 0 },
  { value: 'COURIER', label: 'Курьер', cost: 15 },
  { value: 'POST', label: 'Почта', cost: 10 },
] as const

const paymentOptions = [
  { value: 'CASH', label: 'Наличными' },
  { value: 'CARD', label: 'Картой' },
  { value: 'INVOICE', label: 'Счёт (для юр. лиц)' },
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
const errorMessage = ref('')

onMounted(() => cart.load())

const needsAddress = computed(() => form.deliveryMethod !== 'PICKUP')
const deliveryCost = computed(
  () => deliveryOptions.find((o) => o.value === form.deliveryMethod)?.cost ?? 0
)
const estimatedTotal = computed(() => cart.totalPrice + deliveryCost.value)

const canSubmit = computed(() => {
  if (cart.isEmpty || submitting.value) return false
  if (form.customerName.trim().length < 2) return false
  if (form.customerPhone.trim().length < 5) return false
  if (needsAddress.value && form.deliveryAddress.trim().length < 3) return false
  return true
})

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  errorMessage.value = ''
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
      },
    })
    cart.clear()
    await navigateTo({ path: '/checkout/success', query: { id: order.id } })
  } catch (error) {
    const err = error as { data?: { message?: string | string[] } }
    const message = err?.data?.message
    errorMessage.value = Array.isArray(message)
      ? message.join(', ')
      : message || 'Не удалось оформить заказ. Попробуйте ещё раз.'
  } finally {
    submitting.value = false
  }
}

useHead({ title: 'Оформление заказа | Мультитул' })
</script>

<template>
  <section class="checkout-page">
    <h1>Оформление заказа</h1>

    <ClientOnly>
      <div v-if="cart.isEmpty" class="empty">
        <p>Корзина пуста — нечего оформлять.</p>
        <NuxtLink to="/catalog/" class="primary">Перейти в каталог</NuxtLink>
      </div>

      <form v-else class="checkout-grid" @submit.prevent="submit">
        <div class="fields">
          <fieldset>
            <legend>Контактные данные</legend>
            <label>
              <span>Имя <em>*</em></span>
              <input v-model="form.customerName" type="text" required minlength="2" placeholder="Как к вам обращаться">
            </label>
            <label>
              <span>Телефон <em>*</em></span>
              <input v-model="form.customerPhone" type="tel" required placeholder="+375 (__) ___-__-__">
            </label>
            <label>
              <span>Email</span>
              <input v-model="form.customerEmail" type="email" placeholder="для копии заказа">
            </label>
          </fieldset>

          <fieldset>
            <legend>Доставка</legend>
            <div class="radio-cards">
              <label v-for="option in deliveryOptions" :key="option.value" :class="{ active: form.deliveryMethod === option.value }">
                <input v-model="form.deliveryMethod" type="radio" :value="option.value">
                <span class="radio-title">{{ option.label }}</span>
                <span class="radio-cost">{{ option.cost ? formatPrice(option.cost, cart.currency) : 'бесплатно' }}</span>
              </label>
            </div>
            <label v-if="needsAddress">
              <span>Адрес доставки <em>*</em></span>
              <input v-model="form.deliveryAddress" type="text" required placeholder="Город, улица, дом, квартира">
            </label>
          </fieldset>

          <fieldset>
            <legend>Оплата</legend>
            <div class="radio-cards">
              <label v-for="option in paymentOptions" :key="option.value" :class="{ active: form.paymentMethod === option.value }">
                <input v-model="form.paymentMethod" type="radio" :value="option.value">
                <span class="radio-title">{{ option.label }}</span>
              </label>
            </div>
            <label>
              <span>Комментарий</span>
              <textarea v-model="form.comment" rows="3" placeholder="Пожелания к заказу" />
            </label>
          </fieldset>
        </div>

        <aside class="summary">
          <h2>Ваш заказ</h2>
          <ul class="summary-items">
            <li v-for="item in cart.items" :key="item.productId">
              <span class="qty">{{ item.quantity }}×</span>
              <span class="name">{{ item.name }}</span>
              <span class="sum">{{ formatPrice(item.price * item.quantity, item.currency) }}</span>
            </li>
          </ul>
          <div class="summary-row">
            <span>Товары</span>
            <strong>{{ formatPrice(cart.totalPrice, cart.currency) }}</strong>
          </div>
          <div class="summary-row">
            <span>Доставка</span>
            <strong>{{ deliveryCost ? formatPrice(deliveryCost, cart.currency) : 'бесплатно' }}</strong>
          </div>
          <div class="summary-row total">
            <span>Итого</span>
            <strong>{{ formatPrice(estimatedTotal, cart.currency) }}</strong>
          </div>

          <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

          <button type="submit" class="primary" :disabled="!canSubmit">
            {{ submitting ? 'Оформляем…' : 'Подтвердить заказ' }}
          </button>
          <p class="consent">
            Нажимая «Подтвердить заказ», вы принимаете условия
            <NuxtLink to="/oferta/">публичной оферты</NuxtLink> и даёте
            согласие на обработку персональных данных в соответствии с
            <NuxtLink to="/privacy/">политикой</NuxtLink>.
          </p>
          <NuxtLink to="/cart/" class="back">Вернуться в корзину</NuxtLink>
        </aside>
      </form>
    </ClientOnly>
  </section>
</template>

<style scoped lang="scss">
.checkout-page {
  display: grid;
  gap: 24px;

  h1 {
    font-size: clamp(28px, 4vw, 42px);
  }
}

.checkout-grid {
  display: grid;
  gap: 24px;

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) 360px;
    align-items: start;
  }
}

.fields {
  display: grid;
  gap: 18px;
}

fieldset {
  display: grid;
  gap: 14px;
  border: 1px solid var(--color-line);
  border-radius: 18px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: 20px;
}

legend {
  padding: 0 8px;
  font-weight: 900;
  font-size: 15px;
}

label {
  display: grid;
  gap: 6px;

  span {
    color: var(--color-muted);
    font-size: 13px;
    font-weight: 700;

    em {
      color: #b42318;
      font-style: normal;
    }
  }
}

input,
textarea {
  width: 100%;
  border: 1px solid var(--color-line);
  border-radius: 12px;
  background: #f8fafc;
  padding: 12px 14px;
  font: inherit;
  outline: 0;

  &:focus {
    border-color: var(--color-primary);
    background: white;
  }
}

.radio-cards {
  display: grid;
  gap: 10px;

  @include media-breakpoint-up(sm) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  label {
    position: relative;
    gap: 4px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: #f8fafc;
    cursor: pointer;
    padding: 12px 14px;

    &.active {
      border-color: var(--color-primary);
      background: #eef4ff;
    }

    input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
  }
}

.radio-title {
  color: #101828 !important;
  font-size: 14px !important;
  font-weight: 800 !important;
}

.radio-cost {
  font-size: 12px !important;
}

.summary {
  display: grid;
  gap: 12px;
  border: 1px solid var(--color-line);
  border-radius: 20px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: 22px;

  h2 {
    font-size: 22px;
  }
}

.summary-items {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--color-line);
  list-style: none;

  li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    font-size: 13px;
  }

  .qty {
    color: var(--color-muted);
    font-weight: 800;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sum {
    font-weight: 800;
    white-space: nowrap;
  }
}

.summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--color-muted);

  &.total {
    color: #101828;
    font-size: 18px;

    strong {
      font-size: 24px;
    }
  }
}

.primary {
  display: inline-flex;
  justify-content: center;
  border: 0;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  padding: 14px 18px;
  text-decoration: none;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
}

.consent {
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.5;

  a {
    color: inherit;
    text-decoration: underline;
  }
}

.back {
  text-align: center;
  color: var(--color-muted);
  font-weight: 700;
  text-decoration: underline;
}

.error {
  border-radius: 10px;
  background: #fef2f2;
  color: #b42318;
  font-size: 13px;
  font-weight: 700;
  padding: 10px 12px;
}

.empty {
  display: grid;
  gap: 14px;
  justify-items: start;
  border: 1px solid var(--color-line);
  border-radius: 24px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: 40px;
}
</style>
