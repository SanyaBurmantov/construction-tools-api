<script setup lang="ts">
import { useCartStore } from '~/stores/cart'

/**
 * The cart's corner for organisations: an invoice without registering, a
 * commercial offer as PDF, and — for an account — saving the cart as a
 * purchase list for next month.
 */
const cart = useCartStore()
const toast = useAppToast()
const { isAuthenticated, authFetch, errorMessage } = useAuth()
const { downloadQuote } = useB2b()

const invoiceOpen = ref(false)
const quoteLoading = ref(false)

const lines = () => cart.items.map(item => ({ productId: item.productId, quantity: item.quantity }))

async function quote() {
  quoteLoading.value = true
  try {
    await downloadQuote(lines())
    toast.success('Коммерческое предложение скачано')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось сформировать предложение'))
  } finally {
    quoteLoading.value = false
  }
}

/* ---- Save as a purchase list ---- */
const listOpen = ref(false)
const listName = ref('')
const savingList = ref(false)

function openSaveList() {
  listName.value = `Закупка ${new Date().toLocaleDateString('ru-RU')}`
  listOpen.value = true
}

async function saveList() {
  if (!listName.value.trim()) return
  savingList.value = true
  try {
    await authFetch('/account/purchase-lists', {
      method: 'POST',
      body: { name: listName.value.trim(), items: lines() },
    })
    listOpen.value = false
    toast.success('Список сохранён — он в кабинете, во вкладке «Списки закупок»')
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось сохранить список'))
  } finally {
    savingList.value = false
  }
}
</script>

<template>
  <section class="b2b-panel">
    <h2>Для организаций</h2>
    <p>Счёт на оплату и коммерческое предложение — сразу, без регистрации.</p>
    <UiButton variant="secondary" block @click="invoiceOpen = true">
      Получить счёт на организацию
    </UiButton>
    <UiButton variant="ghost" block :loading="quoteLoading" @click="quote">
      Скачать КП (PDF)
    </UiButton>
    <UiButton v-if="isAuthenticated" variant="ghost" block @click="openSaveList">
      Сохранить как список закупок
    </UiButton>

    <CartInvoiceRequest v-model:open="invoiceOpen" />

    <UiModal v-model:open="listOpen" title="Список закупок" size="sm">
      <form novalidate @submit.prevent="saveList">
        <UiField label="Название" hint="Например: «Расходники на объект» или «Ежемесячная закупка»" for="list-name">
          <UiInput id="list-name" v-model="listName" :maxlength="100" />
        </UiField>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="listOpen = false">Отмена</UiButton>
        <UiButton :loading="savingList" @click="saveList">Сохранить</UiButton>
      </template>
    </UiModal>
  </section>
</template>

<style scoped>
.b2b-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

h2 {
  margin: 0;
  font-size: var(--text-md);
}

p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
