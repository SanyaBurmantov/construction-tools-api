<script setup lang="ts">
import { useCartStore } from '~/stores/cart'
import { company } from '~/data/company'
import type { DeliveryMethod, Order } from '~/types/api'
import type { CompanyRequisitesModel } from '~/utils/requisites'

/**
 * «Счёт без регистрации»: a company gets an invoice for the cart without
 * creating an account first — a purchaser usually needs the invoice to get the
 * purchase approved, and an account is one more reason to leave. It is an
 * ordinary order (`POST /orders` accepts guests), paid by invoice, so the
 * manager, the PDF and the letters all work exactly as for checkout.
 */
const open = defineModel<boolean>('open', { required: true })

const cart = useCartStore()
// The discount the cart summary beside this panel shows must be on the invoice
// too — the order used to go out at full price.
const promo = usePromoCode()
const config = useRuntimeConfig()
const toast = useAppToast()
const { user, authFetch, errorMessage } = useAuth()
const cartValidation = useCartValidation()

const payer = reactive<CompanyRequisitesModel>({
  companyName: '',
  taxId: '',
  legalAddress: '',
  bankAccount: '',
  bankName: '',
  bankBic: '',
})
const form = reactive({
  contactName: '',
  phone: '',
  email: '',
  deliveryMethod: 'PICKUP' as DeliveryMethod,
  deliveryAddress: '',
  comment: '',
})
const consent = ref(false)
const submitting = ref(false)
const error = ref('')

const deliveryOptions = computed(() => [
  { value: 'PICKUP' as const, label: DELIVERY_LABEL.PICKUP, hint: company.storeAddress },
  {
    value: 'COURIER' as const,
    label: DELIVERY_LABEL.COURIER,
    hint: `${Number(config.public.deliveryCourier)} BYN, 1–2 дня`,
  },
  {
    value: 'POST' as const,
    label: DELIVERY_LABEL.POST,
    hint: `${Number(config.public.deliveryPost)} BYN, по всей стране`,
  },
])

/** A signed-in company starts with its own requisites. Blank fields only. */
watch(open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  const account = user.value
  if (!account) return
  if (!form.contactName) form.contactName = account.name || ''
  if (!form.phone) form.phone = account.phone || ''
  if (!form.email) form.email = account.email || ''
  if (account.customerType !== 'COMPANY') return
  if (!payer.companyName) payer.companyName = account.companyName || ''
  if (!payer.taxId) payer.taxId = account.taxId || ''
  if (!payer.legalAddress) payer.legalAddress = account.legalAddress || ''
  if (!payer.bankAccount) payer.bankAccount = account.bankAccount || ''
  if (!payer.bankName) payer.bankName = account.bankName || ''
  if (!payer.bankBic) payer.bankBic = account.bankBic || ''
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(): string {
  if (payer.companyName.trim().length < 2) return 'Укажите название организации'
  if (!payer.taxId.trim()) return 'Укажите УНП организации'
  const problem = requisitesProblem(payer)
  if (problem) return problem
  if (form.contactName.trim().length < 2) return 'Укажите контактное лицо'
  if (form.phone.trim().length < 5) return 'Укажите телефон'
  if (!EMAIL_RE.test(form.email.trim())) return 'Укажите e-mail — на него придёт счёт'
  if (form.deliveryMethod !== 'PICKUP' && form.deliveryAddress.trim().length < 3)
    return 'Для доставки нужен адрес'
  if (!consent.value) return 'Дайте согласие на обработку персональных данных'
  return ''
}

async function submit() {
  error.value = validate()
  if (error.value) return
  submitting.value = true
  try {
    const order = await authFetch<Pick<Order, 'id'>>('/orders', {
      method: 'POST',
      body: {
        items: cart.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
        customerName: form.contactName.trim(),
        customerPhone: form.phone.trim(),
        customerEmail: form.email.trim(),
        comment: form.comment.trim() || undefined,
        deliveryMethod: form.deliveryMethod,
        deliveryAddress: form.deliveryMethod === 'PICKUP' ? undefined : form.deliveryAddress.trim(),
        paymentMethod: 'INVOICE',
        payerName: payer.companyName.trim(),
        payerTaxId: payer.taxId.trim(),
        payerAddress: payer.legalAddress.trim() || undefined,
        payerAccount: payer.bankAccount.trim() || undefined,
        payerBankName: payer.bankName.trim() || undefined,
        payerBankBic: payer.bankBic.trim() || undefined,
        promoCode: promo.appliedCode.value || undefined,
        expectedItemsTotal: cart.totalPrice,
        attribution: getAttribution(),
      },
    })
    cart.clear()
    promo.clear()
    open.value = false
    await navigateTo({ path: '/checkout/success', query: { id: order.id } })
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode ?? (err as { status?: number }).status
    if (status === 409) {
      await cartValidation.validate()
      open.value = false
      toast.warning('Цены в корзине изменились — проверьте суммы и запросите счёт ещё раз')
      return
    }
    error.value = errorMessage(err, 'Не удалось выставить счёт. Попробуйте ещё раз или позвоните нам.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UiModal v-model:open="open" title="Счёт на организацию" size="lg">
    <form class="invoice-form" novalidate @submit.prevent="submit">
      <p class="lead">
        Без регистрации: заполните реквизиты — счёт придёт на e-mail, а менеджер
        подтвердит наличие. Цены в счёте фиксируются на несколько дней.
      </p>

      <UiAlert v-if="error" tone="danger">{{ error }}</UiAlert>

      <section>
        <h3>Плательщик</h3>
        <AccountCompanyRequisites v-model="payer" id-prefix="inv" require-tax-id />
      </section>

      <section>
        <h3>Контакт</h3>
        <div class="grid">
          <UiField label="Контактное лицо" required for="inv-contact">
            <UiInput id="inv-contact" v-model="form.contactName" autocomplete="name" />
          </UiField>
          <UiField label="Телефон" required for="inv-phone">
            <UiInput id="inv-phone" v-model="form.phone" type="tel" autocomplete="tel" placeholder="+375 (__) ___-__-__" />
          </UiField>
        </div>
        <UiField label="E-mail для счёта" required for="inv-email">
          <UiInput id="inv-email" v-model="form.email" type="email" autocomplete="email" />
        </UiField>
      </section>

      <section>
        <h3>Получение</h3>
        <UiRadioCards v-model="form.deliveryMethod" :options="deliveryOptions" legend="Способ получения" hide-legend />
        <UiField v-if="form.deliveryMethod !== 'PICKUP'" label="Адрес доставки" required for="inv-address">
          <UiInput id="inv-address" v-model="form.deliveryAddress" autocomplete="street-address" />
        </UiField>
        <UiField label="Комментарий" for="inv-comment">
          <UiTextarea id="inv-comment" v-model="form.comment" :rows="2" :maxlength="2000" placeholder="Номер заявки, договор, сроки…" />
        </UiField>
      </section>

      <UiCheckbox v-model="consent">
        Даю согласие на обработку персональных данных в соответствии с
        <NuxtLink to="/privacy" target="_blank">Политикой обработки персональных данных</NuxtLink>
      </UiCheckbox>
    </form>

    <template #footer>
      <UiButton variant="ghost" @click="open = false">Отмена</UiButton>
      <UiButton :loading="submitting" @click="submit">Получить счёт</UiButton>
    </template>
  </UiModal>
</template>

<style scoped>
.invoice-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.lead {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

h3 {
  margin: 0;
  font-size: var(--text-md);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}
</style>
