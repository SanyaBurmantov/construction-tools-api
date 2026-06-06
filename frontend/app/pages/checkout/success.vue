<script setup lang="ts">
interface OrderItem {
  id: string
  productName: string
  productSlug: string
  productSku: string | null
  productImage: string | null
  unitPrice: number
  quantity: number
  lineTotal: number
}

interface OrderConfirmation {
  number: number
  status: string
  currency: string
  itemsTotal: number
  deliveryCost: number
  total: number
  deliveryMethod: string
  deliveryAddress: string | null
  paymentMethod: string
  customerName: string
  createdAt: string
  items: OrderItem[]
}

const route = useRoute()
const config = useRuntimeConfig()
const { formatPrice } = useFormatPrice()

const orderId = computed(() => String(route.query.id || ''))
const order = ref<OrderConfirmation | null>(null)
const pending = ref(true)
const failed = ref(false)

const deliveryLabels: Record<string, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
}
const paymentLabels: Record<string, string> = {
  CASH: 'Наличными',
  CARD: 'Картой',
  INVOICE: 'Счёт (для юр. лиц)',
}

async function loadOrder() {
  if (!orderId.value) {
    pending.value = false
    failed.value = true
    return
  }
  try {
    order.value = await $fetch<OrderConfirmation>(
      `${config.public.apiBase}/orders/${orderId.value}`
    )
  } catch {
    failed.value = true
  } finally {
    pending.value = false
  }
}

onMounted(loadOrder)

useHead({
  title: 'Заказ оформлен | Мультитул',
  meta: [{ name: 'robots', content: 'noindex,nofollow' }],
})
</script>

<template>
  <section class="success-page">
    <ClientOnly>
      <p v-if="pending" class="state">Загружаем заказ…</p>

      <div v-else-if="order" class="card">
        <div class="head">
          <div class="mark">✓</div>
          <div>
            <h1>Спасибо за заказ!</h1>
            <p class="sub">Заказ <strong>№{{ order.number }}</strong> принят. Мы свяжемся с вами для подтверждения.</p>
          </div>
        </div>

        <ul class="items">
          <li v-for="item in order.items" :key="item.id">
            <NuxtLink :to="`/product/${item.productSlug}`" class="thumb">
              <img v-if="item.productImage" :src="item.productImage" :alt="item.productName" loading="lazy" decoding="async">
              <span v-else class="thumb-empty">нет фото</span>
            </NuxtLink>
            <div class="item-main">
              <NuxtLink :to="`/product/${item.productSlug}`" class="item-name">{{ item.productName }}</NuxtLink>
              <span v-if="item.productSku" class="item-sku">Арт. {{ item.productSku }}</span>
              <span class="item-qty">{{ item.quantity }} × {{ formatPrice(item.unitPrice, order.currency) }}</span>
            </div>
            <strong class="item-total">{{ formatPrice(item.lineTotal, order.currency) }}</strong>
          </li>
        </ul>

        <dl class="summary">
          <div><dt>Получатель</dt><dd>{{ order.customerName }}</dd></div>
          <div>
            <dt>Доставка</dt>
            <dd>{{ deliveryLabels[order.deliveryMethod] || order.deliveryMethod }}<template v-if="order.deliveryAddress"> · {{ order.deliveryAddress }}</template></dd>
          </div>
          <div><dt>Оплата</dt><dd>{{ paymentLabels[order.paymentMethod] || order.paymentMethod }}</dd></div>
          <div><dt>Товары</dt><dd>{{ formatPrice(order.itemsTotal, order.currency) }}</dd></div>
          <div><dt>Доставка</dt><dd>{{ order.deliveryCost ? formatPrice(order.deliveryCost, order.currency) : 'бесплатно' }}</dd></div>
          <div class="total"><dt>Итого</dt><dd>{{ formatPrice(order.total, order.currency) }}</dd></div>
        </dl>

        <NuxtLink to="/catalog/" class="primary">Продолжить покупки</NuxtLink>
      </div>

      <div v-else class="card narrow">
        <div class="mark">✓</div>
        <h1>Спасибо за заказ!</h1>
        <p class="sub">{{ failed && orderId ? 'Не удалось загрузить детали заказа, но он принят. Мы свяжемся с вами для подтверждения.' : 'Ваш заказ принят. Мы свяжемся с вами для подтверждения.' }}</p>
        <NuxtLink to="/catalog/" class="primary">Продолжить покупки</NuxtLink>
      </div>
    </ClientOnly>
  </section>
</template>

<style scoped lang="scss">
.success-page {
  display: grid;
  gap: 24px;
}

.state {
  color: var(--color-muted);
  font-weight: 700;
}

.card {
  display: grid;
  gap: 22px;
  border: 1px solid var(--color-line);
  border-radius: 24px;
  background: white;
  box-shadow: var(--shadow-card);
  padding: clamp(24px, 4vw, 40px);

  &.narrow {
    justify-items: start;
    gap: 14px;
  }
}

.head {
  display: flex;
  align-items: center;
  gap: 18px;

  h1 {
    font-size: clamp(24px, 3.5vw, 36px);
  }
}

.sub {
  margin-top: 6px;
  color: var(--color-muted);
}

.mark {
  display: grid;
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 999px;
  background: #dcfce7;
  color: #16a34a;
  font-size: 28px;
  font-weight: 900;
}

.items {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 18px 0;
  border-top: 1px solid var(--color-line);
  border-bottom: 1px solid var(--color-line);
  list-style: none;
}

.items li {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.thumb {
  display: grid;
  width: 64px;
  height: 64px;
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

.thumb-empty {
  color: var(--color-subtle);
  font-size: 11px;
}

.item-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.item-name {
  color: #101828;
  font-weight: 800;
  text-decoration: none;

  &:hover {
    color: var(--color-primary);
  }
}

.item-sku {
  color: var(--color-subtle);
  font-size: 12px;
  font-weight: 700;
}

.item-qty {
  color: var(--color-muted);
  font-size: 13px;
}

.item-total {
  white-space: nowrap;
}

.summary {
  display: grid;
  gap: 8px;
  margin: 0;

  > div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--color-muted);
  }

  dt {
    color: var(--color-muted);
  }

  dd {
    margin: 0;
    font-weight: 700;
    text-align: right;
    color: #101828;
  }

  .total {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--color-line);
    font-size: 18px;

    dd {
      font-size: 22px;
    }
  }
}

.primary {
  display: inline-flex;
  justify-content: center;
  justify-self: start;
  border-radius: 12px;
  background: var(--color-primary);
  color: white;
  font-weight: 800;
  padding: 13px 20px;
  text-decoration: none;
}
</style>
