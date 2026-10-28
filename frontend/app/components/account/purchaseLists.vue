<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

/**
 * «Списки закупок»: named carts a company reorders from — расходники на
 * месяц, комплект на объект. The API stores only ids and quantities and
 * answers with today's names and prices; «В корзину» then goes through the
 * cart's own re-pricing like any other line.
 */
type ListItem = {
  productId: string
  quantity: number
  available: boolean
  name: string
  slug: string | null
  sku: string | null
  price: number | null
  currency: string
  image: string | null
}
type PurchaseList = {
  id: string
  name: string
  updatedAt: string
  total: number
  items: ListItem[]
}

const cart = useCartStore()
const toast = useAppToast()
const { authFetch, errorMessage } = useAuth()
const { formatPrice } = useFormatPrice()
const { downloadQuote } = useB2b()

const lists = ref<PurchaseList[]>([])
const loading = ref(true)
const loadError = ref('')
const expanded = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    lists.value = await authFetch<PurchaseList[]>('/account/purchase-lists')
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить списки')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function toCart(list: PurchaseList) {
  const items = list.items.filter(item => item.available && item.slug && item.price != null)
  if (!items.length) {
    toast.warning('Товары из этого списка сейчас недоступны')
    return
  }
  for (const item of items) {
    cart.add(
      {
        productId: item.productId,
        slug: item.slug!,
        name: item.name,
        sku: item.sku,
        image: item.image,
        price: item.price!,
        currency: item.currency,
      },
      item.quantity
    )
  }
  const skipped = list.items.length - items.length
  toast.success(skipped ? `Добавлено в корзину, ${skipped} поз. недоступно` : 'Список добавлен в корзину')
  void navigateTo('/cart')
}

/** Replaces the list with what is in the cart now. */
async function updateFromCart(list: PurchaseList) {
  if (cart.isEmpty) {
    toast.warning('Корзина пуста')
    return
  }
  try {
    const updated = await authFetch<PurchaseList>(`/account/purchase-lists/${list.id}`, {
      method: 'PATCH',
      body: { items: cart.items.map(item => ({ productId: item.productId, quantity: item.quantity })) },
    })
    lists.value = lists.value.map(l => (l.id === list.id ? updated : l))
    toast.success('Список обновлён из корзины')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось обновить список'))
  }
}

async function quote(list: PurchaseList) {
  try {
    await downloadQuote(list.items.filter(i => i.available).map(i => ({ productId: i.productId, quantity: i.quantity })))
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось сформировать предложение'))
  }
}

/* ---- Rename / delete ---- */
const renaming = ref<PurchaseList | null>(null)
const newName = ref('')
const renameOpen = computed({
  get: () => Boolean(renaming.value),
  set: (value) => { if (!value) renaming.value = null },
})

function startRename(list: PurchaseList) {
  renaming.value = list
  newName.value = list.name
}

async function rename() {
  const list = renaming.value
  if (!list || !newName.value.trim()) return
  try {
    const updated = await authFetch<PurchaseList>(`/account/purchase-lists/${list.id}`, {
      method: 'PATCH',
      body: { name: newName.value.trim() },
    })
    lists.value = lists.value.map(l => (l.id === list.id ? updated : l))
    renaming.value = null
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось переименовать список'))
  }
}

const deleting = ref<PurchaseList | null>(null)
const deleteOpen = computed({
  get: () => Boolean(deleting.value),
  set: (value) => { if (!value) deleting.value = null },
})

async function confirmDelete() {
  const list = deleting.value
  if (!list) return
  try {
    await authFetch(`/account/purchase-lists/${list.id}`, { method: 'DELETE' })
    lists.value = lists.value.filter(l => l.id !== list.id)
    toast.success('Список удалён')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить список'))
  } finally {
    deleting.value = null
  }
}
</script>

<template>
  <div class="purchase-lists">
    <div class="head">
      <h2>Списки закупок</h2>
      <p class="muted">
        Сохраните корзину как список («расходники на месяц», «комплект на объект») —
        в следующий раз она соберётся одной кнопкой по сегодняшним ценам.
        Сохранить можно из корзины или из истории заказов.
      </p>
    </div>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="loading" height="120px" radius="var(--radius-md)" />

    <UiEmpty
      v-else-if="!lists.length"
      icon="cart"
      title="Списков пока нет"
      description="Соберите корзину и нажмите «Сохранить как список закупок»."
    >
      <UiButton to="/cart">Открыть корзину</UiButton>
    </UiEmpty>

    <ul v-else class="lists">
      <li v-for="list in lists" :key="list.id" class="list">
        <div class="list-head">
          <div>
            <strong>{{ list.name }}</strong>
            <span class="muted">
              {{ list.items.length }} поз. · {{ formatPrice(list.total, list.items[0]?.currency || 'BYN') }} по текущим ценам
            </span>
          </div>
          <div class="list-actions">
            <UiButton size="sm" @click="toCart(list)">В корзину</UiButton>
            <UiButton size="sm" variant="ghost" @click="expanded = expanded === list.id ? '' : list.id">
              {{ expanded === list.id ? 'Свернуть' : 'Состав' }}
            </UiButton>
            <UiButton size="sm" variant="ghost" @click="quote(list)">КП (PDF)</UiButton>
            <UiButton size="sm" variant="ghost" @click="updateFromCart(list)">Заменить корзиной</UiButton>
            <UiButton size="sm" variant="ghost" @click="startRename(list)">Переименовать</UiButton>
            <UiButton size="sm" variant="ghost" class="is-danger" @click="deleting = list">Удалить</UiButton>
          </div>
        </div>

        <ul v-if="expanded === list.id" class="items">
          <li v-for="item in list.items" :key="item.productId" :class="{ 'is-off': !item.available }">
            <NuxtLink v-if="item.slug" :to="`/product/${item.slug}`">{{ item.name }}</NuxtLink>
            <span v-else>{{ item.name }}</span>
            <span class="muted">
              {{ item.quantity }} шт.<template v-if="item.price != null"> × {{ formatPrice(item.price, item.currency) }}</template>
              <template v-if="!item.available"> · недоступен</template>
            </span>
          </li>
        </ul>
      </li>
    </ul>

    <UiModal v-model:open="renameOpen" title="Переименовать список" size="sm">
      <form novalidate @submit.prevent="rename">
        <UiField label="Название" for="pl-rename">
          <UiInput id="pl-rename" v-model="newName" :maxlength="100" />
        </UiField>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="renaming = null">Отмена</UiButton>
        <UiButton @click="rename">Сохранить</UiButton>
      </template>
    </UiModal>

    <UiConfirm v-model:open="deleteOpen" title="Удалить список?" @confirm="confirmDelete">
      «{{ deleting?.name }}» будет удалён. Заказы это не затронет.
    </UiConfirm>
  </div>
</template>

<style scoped>
.purchase-lists {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head h2 {
  margin: 0 0 var(--space-2);
}

.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.head .muted {
  margin: 0;
}

.lists,
.items {
  display: flex;
  flex-direction: column;
  padding: 0;
  margin: 0;
  list-style: none;
}

.lists {
  gap: var(--space-3);
}

.list {
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.list-head > div:first-child {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.list-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.items {
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
}

.items li {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
}

.items li.is-off {
  opacity: 0.6;
}

.is-danger {
  color: var(--danger);
}
</style>
