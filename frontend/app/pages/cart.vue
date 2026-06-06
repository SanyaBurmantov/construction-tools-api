<script setup lang="ts">
const config = useRuntimeConfig()
const apiBase = import.meta.server ? config.apiBaseServer : config.public.apiBase
const { items, totalQuantity, totalAmount, updateQuantity, removeItem, clearCart } = useCart()

const checkoutForm = reactive({
  customerName: '',
  phone: '',
  email: '',
  comment: ''
})
const checkoutPending = ref(false)
const checkoutSuccess = ref('')
const checkoutError = ref('')

function resetCheckoutForm() {
  checkoutForm.customerName = ''
  checkoutForm.phone = ''
  checkoutForm.email = ''
  checkoutForm.comment = ''
}

const currency = computed(() => normalizeCurrencyCode(items.value[0]?.product.priceCurrency))
const formattedTotal = computed(() => new Intl.NumberFormat('ru-BY', {
  style: 'currency',
  currency: currency.value,
  maximumFractionDigits: 2
}).format(totalAmount.value))

async function submitOrder() {
  checkoutError.value = ''
  checkoutSuccess.value = ''

  if (!checkoutForm.customerName.trim() || !checkoutForm.phone.trim()) {
    checkoutError.value = 'Заполните имя и телефон.'
    return
  }

  if (!items.value.length) {
    checkoutError.value = 'Корзина пуста.'
    return
  }

  checkoutPending.value = true

  const payload = {
    customerName: checkoutForm.customerName.trim(),
    phone: checkoutForm.phone.trim(),
    email: checkoutForm.email.trim() || undefined,
    comment: checkoutForm.comment.trim() || undefined,
    totalQuantity: totalQuantity.value,
    totalAmount: totalAmount.value || undefined,
    items: items.value.map(item => ({
      productId: item.product.id,
      productName: item.product.name,
      productSlug: item.product.slug,
      priceValue: item.product.priceValue,
      priceCurrency: item.product.priceCurrency,
      quantity: item.quantity,
    }))
  }

  try {
    await $fetch(`${apiBase}/orders`, {
      method: 'POST',
      body: payload
    })

    checkoutSuccess.value = 'Заказ отправлен. Мы свяжемся с вами в ближайшее время.'
    clearCart()
    resetCheckoutForm()
  } catch (error: any) {
    const isNetworkError = !error?.response

    if (import.meta.client && isNetworkError) {
      const drafts = JSON.parse(localStorage.getItem('multitool-order-drafts') || '[]')
      drafts.unshift({ ...payload, createdAt: new Date().toISOString() })
      localStorage.setItem('multitool-order-drafts', JSON.stringify(drafts))

      checkoutSuccess.value = 'Заявка сохранена локально. Если сервер недоступен, мы отправим ее при восстановлении связи.'
      clearCart()
      resetCheckoutForm()
      return
    }

    checkoutError.value = error?.data?.message || 'Не удалось оформить заказ. Проверьте данные и попробуйте снова.'
  } finally {
    checkoutPending.value = false
  }
}

useHead({
  title: 'Корзина | Мультитул',
  meta: [
    {
      name: 'description',
      content: 'Корзина интернет-магазина Мультитул с просмотром добавленных товаров.'
    }
  ]
})
</script>

<template>
  <section class="cart-page">
    <div class="cart-hero">
      <span class="eyebrow">Корзина</span>
      <h1>Ваши товары под рукой</h1>
      <p>
        Проверяйте выбранные позиции, меняйте количество и возвращайтесь в каталог за новыми товарами.
      </p>
    </div>

    <div class="cart-grid">
      <article class="cart-card accent">
        <strong>{{ totalQuantity }} товаров</strong>
        <span>сейчас в корзине</span>
      </article>

      <article class="cart-card">
        <strong>{{ formattedTotal }}</strong>
        <p>Итоговая стоимость по товарам, у которых уже указана цена.</p>
      </article>
    </div>

    <div v-if="!items.length" class="cart-empty">
      Корзина пока пуста. Добавьте товары из каталога или со страницы товара.
    </div>

    <section v-else class="cart-list">
      <article v-for="item in items" :key="item.product.id" class="cart-item">
        <NuxtLink :to="`/product/${item.product.slug}`" class="item-image">
          <img
            v-if="item.product.images?.[0]?.url"
            :src="item.product.images[0].url"
            :alt="item.product.images[0].alt || item.product.name"
          >
          <div v-else class="image-placeholder">нет фото</div>
        </NuxtLink>

        <div class="item-main">
          <div class="item-meta">
            <span>{{ item.product.brand?.name || 'Без бренда' }}</span>
            <span>{{ item.product.category?.name || 'Каталог' }}</span>
          </div>

          <NuxtLink :to="`/product/${item.product.slug}`" class="item-title">
            {{ item.product.name }}
          </NuxtLink>

          <strong class="item-price">
            {{ item.product.priceValue == null ? 'Цена по запросу' : `${item.product.priceValue} ${item.product.priceCurrency || 'BYN'}` }}
          </strong>
        </div>

        <div class="item-controls">
          <div class="qty-box">
            <button type="button" @click="updateQuantity(item.product.id, item.quantity - 1)">-</button>
            <strong>{{ item.quantity }}</strong>
            <button type="button" @click="updateQuantity(item.product.id, item.quantity + 1)">+</button>
          </div>

          <button type="button" class="remove-button" @click="removeItem(item.product.id)">
            Удалить
          </button>
        </div>
      </article>

      <div class="cart-actions">
        <button type="button" class="checkout-button" @click="submitOrder()">Оформить заказ</button>
        <button type="button" class="clear-button" @click="clearCart()">Очистить корзину</button>
        <NuxtLink class="catalog-button" to="/catalog/">Вернуться в каталог</NuxtLink>
      </div>

      <section class="checkout-card">
        <div>
          <span class="eyebrow">Оформление</span>
          <h2>Оставьте заявку</h2>
          <p>Укажите контакты, и мы подтвердим заказ, наличие и детали доставки.</p>
        </div>

        <form class="checkout-form" @submit.prevent="submitOrder()">
          <label>
            <span>Имя</span>
            <input v-model.trim="checkoutForm.customerName" type="text" placeholder="Как к вам обращаться">
          </label>

          <label>
            <span>Телефон</span>
            <input v-model.trim="checkoutForm.phone" type="tel" placeholder="+375 ...">
          </label>

          <label>
            <span>Email</span>
            <input v-model.trim="checkoutForm.email" type="email" placeholder="mail@example.com">
          </label>

          <label class="full-width">
            <span>Комментарий</span>
            <textarea v-model.trim="checkoutForm.comment" rows="4" placeholder="Уточнения по доставке, времени звонка, составу заказа"></textarea>
          </label>

          <div v-if="checkoutError" class="checkout-state error">{{ checkoutError }}</div>
          <div v-if="checkoutSuccess" class="checkout-state success">{{ checkoutSuccess }}</div>

          <button type="submit" class="submit-order" :disabled="checkoutPending">
            {{ checkoutPending ? 'Отправляем...' : 'Подтвердить заказ' }}
          </button>
        </form>
      </section>
    </section>
  </section>
</template>

<style scoped lang="scss">
.cart-page {
  display: grid;
  gap: 20px;
}

.cart-hero,
.cart-card,
.cart-empty,
.cart-item {
  border: 2px solid var(--color-ink);
  border-radius: 26px;
  background: rgba(255, 250, 240, 0.96);
  box-shadow: 8px 8px 0 var(--color-ink);
}

.cart-hero {
  padding: clamp(18px, 3vw, 28px);

  h1 {
    margin: 8px 0 10px;
    font-size: clamp(28px, 4vw, 44px);
    line-height: 0.98;
  }

  p {
    max-width: 720px;
    color: var(--color-muted);
    line-height: 1.6;
  }
}

.eyebrow {
  color: var(--color-accent-strong);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.cart-grid {
  display: grid;
  gap: 16px;

  @include media-breakpoint-up(md) {
    grid-template-columns: 280px minmax(0, 1fr);
  }
}

.cart-card {
  display: grid;
  gap: 8px;
  padding: 18px 20px;

  strong {
    font-size: 26px;
    line-height: 1.05;
  }

  span,
  p {
    color: var(--color-muted);
  }

  span {
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  p {
    margin: 0;
    line-height: 1.6;
  }
}

.cart-card.accent {
  background: linear-gradient(135deg, rgba(243, 182, 31, 0.24), rgba(255, 250, 240, 0.96));
}

.cart-empty {
  padding: 20px;
  color: var(--color-muted);
  font-weight: 800;
}

.cart-list {
  display: grid;
  gap: 16px;
}

.cart-item {
  display: grid;
  gap: 16px;
  padding: 16px;

  @include media-breakpoint-up(md) {
    grid-template-columns: 120px minmax(0, 1fr) auto;
    align-items: center;
  }
}

.item-image {
  display: grid;
  min-height: 120px;
  place-items: center;
  overflow: hidden;
  border: 2px solid var(--color-ink);
  border-radius: 18px;
  background: white;

  img {
    width: 100%;
    height: 120px;
    object-fit: contain;
    padding: 10px;
  }
}

.image-placeholder {
  color: var(--color-muted);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.item-main {
  display: grid;
  gap: 10px;
}

.item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  span {
    padding: 6px 10px;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 800;
  }
}

.item-title {
  color: var(--color-ink);
  font-family: var(--font-heading);
  font-size: 22px;
  line-height: 1.1;
  text-decoration: none;
}

.item-price {
  font-size: 18px;
}

.item-controls {
  display: grid;
  gap: 10px;
}

.qty-box {
  display: inline-grid;
  grid-template-columns: 42px auto 42px;
  align-items: center;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  overflow: hidden;

  button {
    border: 0;
    background: white;
    cursor: pointer;
    font-size: 18px;
    font-weight: 900;
    height: 42px;
  }

  strong {
    min-width: 44px;
    text-align: center;
  }
}

.remove-button,
.checkout-button,
.clear-button,
.catalog-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 16px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: white;
  color: var(--color-ink);
  cursor: pointer;
  font-weight: 900;
  text-decoration: none;
}

.checkout-button {
  background: var(--color-ink);
  color: white;
}

.clear-button {
  background: rgba(222, 77, 47, 0.12);
}

.catalog-button {
  background: var(--color-accent);
}

.cart-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.checkout-card {
  display: grid;
  gap: 18px;
  padding: 20px;
  border: 2px solid var(--color-ink);
  border-radius: 26px;
  background: rgba(255, 250, 240, 0.96);
  box-shadow: 8px 8px 0 var(--color-ink);

  h2 {
    margin: 8px 0 10px;
    font-size: clamp(24px, 3vw, 34px);
  }

  p {
    color: var(--color-muted);
    line-height: 1.6;
  }
}

.checkout-form {
  display: grid;
  gap: 14px;

  @include media-breakpoint-up(md) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  label {
    display: grid;
    gap: 8px;
  }

  span {
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  input,
  textarea {
    width: 100%;
    border: 2px solid var(--color-ink);
    border-radius: 18px;
    background: white;
    font: inherit;
    padding: 14px 16px;
  }
}

.full-width {
  @include media-breakpoint-up(md) {
    grid-column: 1 / -1;
  }
}

.checkout-state {
  padding: 14px 16px;
  border-radius: 18px;
  font-weight: 800;

  @include media-breakpoint-up(md) {
    grid-column: 1 / -1;
  }
}

.checkout-state.error {
  background: rgba(222, 77, 47, 0.12);
  color: var(--color-accent-strong);
}

.checkout-state.success {
  background: rgba(56, 161, 105, 0.14);
  color: #226b47;
}

.submit-order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  border: 2px solid var(--color-ink);
  border-radius: 999px;
  background: var(--color-ink);
  color: white;
  cursor: pointer;
  font-weight: 900;
  padding: 0 20px;

  @include media-breakpoint-up(md) {
    width: max-content;
  }
}
</style>
