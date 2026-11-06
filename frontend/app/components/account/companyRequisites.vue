<script setup lang="ts">
import type { CompanyRequisitesModel } from '~/utils/requisites'

/**
 * The organisation's invoice requisites — one set of fields for the account
 * settings, checkout and the admin user page. Each field reports its own
 * problem as soon as there is enough of it to judge.
 */
const model = defineModel<CompanyRequisitesModel>({ required: true })

const props = withDefaults(
  defineProps<{
    /** Prefix for input ids, so two instances on a page don't collide. */
    idPrefix?: string
    /** УНП is mandatory when paying by invoice. */
    requireTaxId?: boolean
  }>(),
  { idPrefix: 'req', requireTaxId: false }
)

const id = (name: string) => `${props.idPrefix}-${name}`

/**
 * The tax registry fills the name and address from the УНП
 * (`useUnpLookup`). Only blank fields — or what the registry itself filled a
 * moment ago — are overwritten, so a name typed by hand is kept.
 */
const unp = computed(() => model.value.taxId)
const { state: unpState, problem: unpProblem, hint: unpHint } = useUnpLookup(unp)
const filledFromRegistry = { companyName: '', legalAddress: '' }
watch(unpState, (current) => {
  if (current.status !== 'found' || !current.payer.active) return
  const fill = (key: 'companyName' | 'legalAddress', value: string | null) => {
    if (!value) return
    const now = model.value[key].trim()
    if (!now || now === filledFromRegistry[key]) {
      model.value[key] = value
      filledFromRegistry[key] = value
    }
  }
  fill('companyName', current.payer.shortName)
  fill('legalAddress', current.payer.address)
})

const taxIdError = computed(() =>
  model.value.taxId.trim().length >= 9 && !isValidUnp(model.value.taxId)
    ? 'Контрольная цифра УНП не сходится — проверьте номер'
    : ''
)
const accountError = computed(() =>
  model.value.bankAccount.trim().length >= 28 && !isValidAccount(model.value.bankAccount)
    ? 'Проверьте номер счёта: формат BY00XXXX0000…, 28 символов'
    : ''
)
const bicError = computed(() =>
  model.value.bankBic.trim().length >= 8 && !isValidBic(model.value.bankBic)
    ? 'БИК белорусского банка — например AKBBBY2X'
    : ''
)
</script>

<template>
  <div class="requisites">
    <div class="grid">
      <UiField
        label="УНП"
        :required="requireTaxId"
        :for="id('tax')"
        :error="taxIdError || unpProblem"
        :hint="unpHint || 'Название и адрес подставим из реестра МНС'"
      >
        <UiInput :id="id('tax')" v-model="model.taxId" placeholder="123456789" inputmode="numeric" />
      </UiField>

      <UiField label="Название организации или ИП" required :for="id('company')">
        <UiInput :id="id('company')" v-model="model.companyName" placeholder="ООО «Ромашка»" autocomplete="organization" />
      </UiField>
    </div>

    <UiField label="Юридический адрес" :for="id('address')">
      <UiInput :id="id('address')" v-model="model.legalAddress" placeholder="г. Витебск, ул. …, д. …" />
    </UiField>

    <UiField label="Расчётный счёт" :for="id('account')" :error="accountError">
      <UiInput :id="id('account')" v-model="model.bankAccount" placeholder="BY00 XXXX 0000 0000 0000 0000 0000" />
    </UiField>

    <div class="grid">
      <UiField label="Банк" :for="id('bank')">
        <UiInput :id="id('bank')" v-model="model.bankName" placeholder="ОАО «…»" />
      </UiField>

      <UiField label="БИК" :for="id('bic')" :error="bicError">
        <UiInput :id="id('bic')" v-model="model.bankBic" placeholder="AKBBBY2X" />
      </UiField>
    </div>
  </div>
</template>

<style scoped lang="scss">
.requisites {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}
</style>
