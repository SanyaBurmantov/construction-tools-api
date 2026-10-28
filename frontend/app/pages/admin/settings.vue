<script setup lang="ts">
definePageMeta({ layout: 'admin' })

/**
 * The shop's own requisites — printed on every invoice and quote, and shown
 * on the page for organisations. Until the bank details and the VAT status
 * are filled in, no invoice is issued automatically: the storefront tells a
 * company the manager will send it instead.
 */
type Seller = {
  name: string
  unp: string
  legalAddress: string
  bankAccount: string
  bankName: string
  bankBic: string
  phone: string
  email: string
  signatory: string
  vatMode: 'NONE' | 'INCLUDED' | null
  vatRate: number
  validDays: number
}
type Response = { seller: Seller, missing: Array<keyof Seller> }

const { adminFetch } = useAdminApi()
const { run, busy } = useAdminAction()

const form = reactive({
  name: '',
  unp: '',
  legalAddress: '',
  bankAccount: '',
  bankName: '',
  bankBic: '',
  phone: '',
  email: '',
  signatory: '',
  vatMode: '' as '' | 'NONE' | 'INCLUDED',
  vatRate: 20,
  validDays: 3,
})
const missing = ref<Array<keyof Seller>>([])
const loading = ref(true)
const loadError = ref('')
const formError = ref('')

const FIELD_LABELS: Partial<Record<keyof Seller, string>> = {
  name: 'наименование',
  unp: 'УНП',
  legalAddress: 'юридический адрес',
  bankAccount: 'расчётный счёт',
  bankName: 'банк',
  bankBic: 'БИК',
  vatMode: 'НДС',
}

function fill(response: Response) {
  const { seller } = response
  Object.assign(form, { ...seller, vatMode: seller.vatMode ?? '' })
  missing.value = response.missing
}

onMounted(async () => {
  try {
    fill(await adminFetch<Response>('/seller'))
  } catch {
    loadError.value = 'Не удалось загрузить реквизиты'
  } finally {
    loading.value = false
  }
})

async function save() {
  formError.value = requisitesProblem({ taxId: form.unp, bankAccount: form.bankAccount, bankBic: form.bankBic })
  if (formError.value) return
  const response = await run(
    () => adminFetch<Response>('/seller', { method: 'PATCH', body: { ...form } }),
    { key: 'save', error: 'Не удалось сохранить', success: 'Реквизиты сохранены' }
  )
  if (response) fill(response)
}

const vatOptions = [
  { value: '', label: 'Не указано — счета не выставляются' },
  { value: 'NONE', label: 'Без НДС (упрощённая система)' },
  { value: 'INCLUDED', label: 'Цены включают НДС' },
]
</script>

<template>
  <div class="admin-page">
    <AdminPageHead
      title="Реквизиты продавца"
      description="Печатаются в счетах и коммерческих предложениях, показываются на странице «Для организаций»"
    />

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>
    <UiSkeleton v-else-if="loading" height="420px" radius="var(--radius-md)" />

    <template v-else>
      <UiAlert v-if="missing.length" tone="warning">
        Счета не выставляются автоматически, пока не заполнено: {{ missing.map(key => FIELD_LABELS[key] || key).join(', ') }}.
        Сейчас покупатель-организация видит «счёт пришлёт менеджер».
      </UiAlert>
      <UiAlert v-else tone="success">
        Всё заполнено — счёт в PDF формируется сразу после заказа и приходит покупателю на e-mail.
      </UiAlert>

      <UiCard>
        <form class="admin-form" novalidate @submit.prevent="save">
          <UiAlert v-if="formError" tone="danger">{{ formError }}</UiAlert>

          <div class="admin-form-row">
            <UiField label="Наименование" required for="s-name">
              <UiInput id="s-name" v-model="form.name" />
            </UiField>
            <UiField label="УНП" required for="s-unp">
              <UiInput id="s-unp" v-model="form.unp" />
            </UiField>
          </div>
          <UiField label="Юридический адрес" required for="s-address">
            <UiInput id="s-address" v-model="form.legalAddress" />
          </UiField>
          <UiField label="Расчётный счёт (IBAN)" required for="s-account">
            <UiInput id="s-account" v-model="form.bankAccount" placeholder="BY00 XXXX 0000 0000 0000 0000 0000" />
          </UiField>
          <div class="admin-form-row">
            <UiField label="Банк" required for="s-bank">
              <UiInput id="s-bank" v-model="form.bankName" placeholder="ОАО «…»" />
            </UiField>
            <UiField label="БИК" required for="s-bic">
              <UiInput id="s-bic" v-model="form.bankBic" placeholder="AKBBBY2X" />
            </UiField>
          </div>
          <div class="admin-form-row">
            <UiField label="НДС" required for="s-vat">
              <UiSelect id="s-vat" v-model="form.vatMode" :options="vatOptions" />
            </UiField>
            <UiField v-if="form.vatMode === 'INCLUDED'" label="Ставка НДС, %" for="s-vat-rate">
              <UiInput id="s-vat-rate" v-model.number="form.vatRate" type="number" min="0" max="30" />
            </UiField>
          </div>
          <div class="admin-form-row">
            <UiField
              label="Подпись в счёте"
              hint="Должность и ФИО: «Директор Иванов И. И.»"
              for="s-sign"
            >
              <UiInput id="s-sign" v-model="form.signatory" />
            </UiField>
            <UiField
              label="Срок действия счёта и КП, дней"
              hint="Цены поставщиков меняются каждый день — фиксируем их на этот срок"
              for="s-days"
            >
              <UiInput id="s-days" v-model.number="form.validDays" type="number" min="1" max="30" />
            </UiField>
          </div>
          <div class="admin-form-row">
            <UiField label="Телефон в документах" for="s-phone">
              <UiInput id="s-phone" v-model="form.phone" />
            </UiField>
            <UiField label="E-mail в документах" for="s-email">
              <UiInput id="s-email" v-model="form.email" type="email" />
            </UiField>
          </div>

          <div>
            <UiButton type="submit" :loading="busy === 'save'">Сохранить</UiButton>
          </div>
        </form>
      </UiCard>
    </template>
  </div>
</template>
