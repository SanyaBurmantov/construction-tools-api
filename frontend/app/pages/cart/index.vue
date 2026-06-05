<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

const cart = useCartStore()
const { formatPrice } = useFormatPrice()

onMounted(() => cart.load())

useHead({ title: 'Корзина | Мультитул' })
</script>

<template>
  <section class="cart-page">
    <h1>Корзина</h1>

    <ClientOnly>
      <div v-if="cart.isEmpty" class="empty">
        <p>Корзина пуста.</p>
        <NuxtLink to="/catalog/" class="primary">Перейти в каталог</NuxtLink>
      </div>

      <div v-else class="cart-grid">
        <ul class="lines">
          <li v-for="item in cart.items" :key="item.productId" class="line">
            <NuxtLink :to="`/product/${item.slug}`" class="thumb">
              <img v-if="item.image" :src="item.image" :alt="item.name" loading="lazy" decoding="async">
              <span v-else class="thumb-placeholder">нет фото</span>
            </NuxtLink>

            <div class="line-main">
              <NuxtLink :to="`/product/${item.slug}`" class="line-name">{{ item.name }}</NuxtLink>
              <span class="line-price">{{ formatPrice(item.price, item.currency) }} / шт.</span>
            </div>

            <div class="qty-control">
              <button type="button" aria-label="Меньше" @click="cart.setQuantity(item.productId, item.quantity - 1)">−</button>
              <input
                :value="item.quantity"
                type="number"
                min="1"
                max="999"
                @change="cart.setQuantity(item.productId, Number(($event.target as HTMLInputElement).value))"
              >
              <button type="button" aria-label="Больше" @click="cart.setQuantity(item.productId, item.quantity + 1)">+</button>
            </div>

            <strong class="line-total">{{ formatPrice(item.price * item.quantity, item.currency) }}</strong>

            <button type="button" class="remove" aria-label="Удалить" @click="cart.remove(item.productId)">✕</button>
          </li>
        </ul>

        <aside class="summary">
          <h2>Итого</h2>
          <div class="summary-row">
            <span>Товары ({{ cart.count }})</span>
            <strong>{{ formatPrice(cart.totalPrice, cart.currency) }}</strong>
          </div>
          <p class="hint">Стоимость доставки рассчитывается при оформлении.</p>
          <NuxtLink to="/checkout/" class="primary">Оформить заказ</NuxtLink>
          <button type="button" class="clear" @click="cart.clear()">Очистить корзину</button>
        </aside>
      </div>
    </ClientOnly>
  </section>
</template>

<style scoped lang="scss">
.cart-page {
  display: grid;
  gap: 24px;

  h1 {
    font-size: clamp(28px, 4vw, 42px);
  }
}

.empty {
  display: grid;
  gap: 16px;
  justify-items: start;
  border: 1px solid var(--color-line);
  border-radius: 24px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: 40px;
  color: var(--color-muted);
}

.cart-grid {
  display: grid;
  gap: 24px;

  @include media-breakpoint-up(lg) {
    grid-template-columns: minmax(0, 1fr) 340px;
    align-items: start;
  }
}

.lines {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.line {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  border: 1px solid var(--color-line);
  border-radius: 18px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: 14px;

  @include media-breakpoint-up(md) {
    grid-template-columns: 72px minmax(0, 1fr) auto auto auto;
  }
}

.thumb {
  display: grid;
  width: 72px;
  height: 72px;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: #f8fafc;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 6px;
  }
}

.thumb-placeholder {
  color: var(--color-subtle);
  font-size: 11px;
}

.line-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.line-name {
  color: #101828;
  font-weight: 800;
  text-decoration: none;

  &:hover {
    color: var(--color-primary);
  }
}

.line-price {
  color: var(--color-muted);
  font-size: 13px;
}

.qty-control {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  overflow: hidden;

  button {
    width: 36px;
    height: 38px;
    border: 0;
    background: #f8fafc;
    cursor: pointer;
    font-size: 18px;
    font-weight: 900;
  }

  input {
    width: 48px;
    height: 38px;
    border: 0;
    border-left: 1px solid var(--color-line);
    border-right: 1px solid var(--color-line);
    text-align: center;
    font-weight: 800;
    outline: 0;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
}

.line-total {
  font-size: 16px;
  white-space: nowrap;
}

.remove {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: #fef2f2;
  color: #b42318;
  cursor: pointer;
  font-weight: 900;
}

.summary {
  display: grid;
  gap: 14px;
  border: 1px solid var(--color-line);
  border-radius: 20px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: 22px;

  h2 {
    font-size: 22px;
  }
}

.summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;

  strong {
    font-size: 22px;
  }
}

.hint {
  color: var(--color-muted);
  font-size: 13px;
}

.primary {
  display: inline-flex;
  justify-content: center;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 800;
  padding: 13px 18px;
  text-decoration: none;
}

.clear {
  border: 0;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  font-weight: 700;
  text-decoration: underline;
}
</style>
