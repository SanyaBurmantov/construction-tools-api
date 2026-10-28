<script setup lang="ts">
import type { Order, OrderItem } from '~/types/api'

/** What the public `GET /orders/:id` projects — no contact details beyond the name. */
type OrderConfirmation = Pick<
  Order,
  | 'number'
  | 'status'
  | 'currency'
  | 'itemsTotal'
  | 'deliveryCost'
  | 'total'
  | 'deliveryMethod'
  | 'deliveryAddress'
  | 'paymentMethod'
  | 'payerName'
  | 'customerName'
  | 'createdAt'
> & {
  items: Array<
    Pick<
      OrderItem,
      | 'id'
      | 'productName'
      | 'productSlug'
      | 'productSku'
      | 'productImage'
      | 'unitPrice'
      | 'quantity'
      | 'lineTotal'
    >
  >
}

const route = useRoute()
const config = useRuntimeConfig()
const { formatPrice } = useFormatPrice()
// Orders placed from an account show up in its history — point there instead
// of leaving this page as the only record of the order.
const { isAuthenticated } = useAuth()
const { loadSeller, invoiceUrl, isInvoiceable } = useB2b()
const invoiceReady = ref(false)

const orderId = computed(() => String(route.query.id || ''))
const order = ref<OrderConfirmation | null>(null)
const pending = ref(true)
const failed = ref(false)

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
    if (isInvoiceable(order.value)) invoiceReady.value = Boolean((await loadSeller())?.invoiceReady)
  } catch {
    failed.value = true
  } finally {
    pending.value = false
  }
}

onMounted(loadOrder)

useHead({
  title: 'Заказ оформлен | Gost.by',
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

        <div v-if="isInvoiceable(order)" class="invoice">
          <template v-if="invoiceReady">
            <p>Счёт на <strong>{{ order.payerName }}</strong> готов. Копия — в письме на ваш e-mail.</p>
            <UiButton :href="invoiceUrl(orderId)" target="_blank" rel="noopener" size="lg">
              Скачать счёт (PDF)
            </UiButton>
          </template>
          <p v-else>
            Счёт на <strong>{{ order.payerName }}</strong> менеджер пришлёт на ваш e-mail в рабочее время.
          </p>
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
            <dd>{{ DELIVERY_LABEL[order.deliveryMethod] }}<template v-if="order.deliveryAddress"> · {{ order.deliveryAddress }}</template></dd>
          </div>
          <div><dt>Оплата</dt><dd>{{ PAYMENT_LABEL[order.paymentMethod] }}</dd></div>
          <div><dt>Товары</dt><dd>{{ formatPrice(order.itemsTotal, order.currency) }}</dd></div>
          <div><dt>Стоимость доставки</dt><dd>{{ order.deliveryCost ? formatPrice(order.deliveryCost, order.currency) : 'бесплатно' }}</dd></div>
          <div class="total"><dt>Итого</dt><dd>{{ formatPrice(order.total, order.currency) }}</dd></div>
        </dl>

        <div class="actions">
          <UiButton to="/catalog" size="lg">Продолжить покупки</UiButton>
          <UiButton v-if="isAuthenticated" to="/account?tab=orders" size="lg" variant="secondary">
            Мои заказы
          </UiButton>
        </div>
      </div>

      <div v-else class="card narrow">
        <div class="mark">✓</div>
        <h1>Спасибо за заказ!</h1>
        <p class="sub">{{ failed && orderId ? 'Не удалось загрузить детали заказа, но он принят. Мы свяжемся с вами для подтверждения.' : 'Ваш заказ принят. Мы свяжемся с вами для подтверждения.' }}</p>
        <UiButton to="/catalog" size="lg">Продолжить покупки</UiButton>
      </div>
    </ClientOnly>
  </section>
</template>

<style scoped lang="scss">
.success-page {
  display: grid;
  gap: 24px;
}

.invoice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  padding: 16px 20px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);

  p {
    margin: 0;
  }
}

.state {
  color: var(--text-muted);
  font-weight: 700;
}

.card {
  display: grid;
  gap: 22px;
  border: 1px solid var(--border-subtle);
  border-radius: 24px;
  background: var(--surface-card);
  box-shadow: var(--shadow-sm);
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
  color: var(--text-muted);
}

.mark {
  display: grid;
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 999px;
  background: var(--success-soft);
  color: var(--success);
  font-size: 28px;
  font-weight: 900;
}

.items {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 18px 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
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
  background: var(--surface-sunken);

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    padding: 6px;
  }
}

.thumb-empty {
  color: var(--text-subtle);
  font-size: 11px;
}

.item-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.item-name {
  color: var(--text-strong);
  font-weight: 800;
  text-decoration: none;

  &:hover {
    color: var(--brand);
  }
}

.item-sku {
  color: var(--text-subtle);
  font-size: 12px;
  font-weight: 700;
}

.item-qty {
  color: var(--text-muted);
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
    color: var(--text-muted);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    font-weight: 700;
    text-align: right;
    color: var(--text-strong);
  }

  .total {
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
    font-size: 18px;

    dd {
      font-size: 22px;
    }
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
</style>
