<script setup lang="ts">
definePageMeta({ layout: 'admin' })

type PromoCode = {
  id: string
  code: string
  description: string | null
  type: 'PERCENT' | 'FIXED'
  value: number
  minOrderTotal: number | null
  maxUses: number | null
  usedCount: number
  startsAt: string | null
  endsAt: string | null
  isActive: boolean
  freeDelivery: boolean
  createdAt: string
  _count?: { orders: number }
}

const { adminFetch, errorMessage } = useAdminApi()
const toast = useAppToast()
const { formatPrice } = useFormatPrice()

const codes = ref<PromoCode[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const response = await adminFetch<{ data: PromoCode[] }>('/promo-codes')
    codes.value = response.data
  } catch (error) {
    loadError.value = errorMessage(error, 'Не удалось загрузить промокоды')
  } finally {
    loading.value = false
  }
}

onMounted(load)

/* ---- Editor ------------------------------------------------------------ */
const editorOpen = ref(false)
const saving = ref(false)
const editing = ref<PromoCode | null>(null)
const formError = ref('')

const blankForm = () => ({
  code: '',
  description: '',
  type: 'PERCENT' as PromoCode['type'],
  value: 10 as number | null,
  minOrderTotal: null as number | null,
  maxUses: null as number | null,
  startsAt: '',
  endsAt: '',
  isActive: true,
  freeDelivery: false,
})

const form = reactive(blankForm())

/** `datetime-local` wants `YYYY-MM-DDTHH:mm`, the API returns ISO. */
const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : '')

function openCreate() {
  editing.value = null
  Object.assign(form, blankForm())
  formError.value = ''
  editorOpen.value = true
}

function openEdit(code: PromoCode) {
  editing.value = code
  Object.assign(form, {
    ...blankForm(),
    code: code.code,
    description: code.description ?? '',
    type: code.type,
    value: code.value,
    minOrderTotal: code.minOrderTotal,
    maxUses: code.maxUses,
    startsAt: toLocalInput(code.startsAt),
    endsAt: toLocalInput(code.endsAt),
    isActive: code.isActive,
    freeDelivery: code.freeDelivery,
  })
  formError.value = ''
  editorOpen.value = true
}

function toNumber(value: number | null) {
  return value === null || Number.isNaN(value) ? undefined : Number(value)
}

async function save() {
  formError.value = ''
  if (!form.code.trim()) {
    formError.value = 'Укажите код'
    return
  }
  if (form.value == null || form.value < 0) {
    formError.value = 'Укажите размер скидки'
    return
  }
  if (form.type === 'PERCENT' && form.value > 100) {
    formError.value = 'Процент скидки не может превышать 100'
    return
  }
  if (form.startsAt && form.endsAt && form.startsAt >= form.endsAt) {
    formError.value = 'Дата окончания должна быть позже даты начала'
    return
  }

  const body = {
    code: form.code.trim(),
    description: form.description.trim() || undefined,
    type: form.type,
    value: Number(form.value),
    minOrderTotal: toNumber(form.minOrderTotal),
    maxUses: toNumber(form.maxUses),
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
    isActive: form.isActive,
    freeDelivery: form.freeDelivery,
  }

  saving.value = true
  try {
    if (editing.value) {
      await adminFetch(`/promo-codes/${editing.value.id}`, { method: 'PATCH', body })
      toast.success('Промокод сохранён')
    } else {
      await adminFetch('/promo-codes', { method: 'POST', body })
      toast.success('Промокод создан')
    }
    editorOpen.value = false
    await load()
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось сохранить промокод')
  } finally {
    saving.value = false
  }
}

async function toggleActive(code: PromoCode) {
  try {
    await adminFetch(`/promo-codes/${code.id}`, {
      method: 'PATCH',
      body: { isActive: !code.isActive },
    })
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось изменить статус'))
  }
}

const deleting = ref<PromoCode | null>(null)
const deletingBusy = ref(false)

async function confirmDelete() {
  if (!deleting.value) return
  deletingBusy.value = true
  try {
    await adminFetch(`/promo-codes/${deleting.value.id}`, { method: 'DELETE' })
    toast.success('Промокод удалён')
    deleting.value = null
    await load()
  } catch (error) {
    toast.error(errorMessage(error, 'Не удалось удалить промокод'))
  } finally {
    deletingBusy.value = false
  }
}

/* ---- Display ----------------------------------------------------------- */
const dateFormatter = new Intl.DateTimeFormat('ru-BY', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const formatDate = (iso: string | null) => (iso ? dateFormatter.format(new Date(iso)) : '—')

function discountLabel(code: PromoCode) {
  return code.type === 'PERCENT' ? `${code.value}%` : formatPrice(code.value, 'BYN')
}

/** Why a code isn't usable right now, or null when it is. */
function inactiveReason(code: PromoCode) {
  if (!code.isActive) return 'Выключен'
  const now = Date.now()
  if (code.startsAt && new Date(code.startsAt).getTime() > now) return 'Ещё не начался'
  if (code.endsAt && new Date(code.endsAt).getTime() < now) return 'Истёк'
  if (code.maxUses != null && code.usedCount >= code.maxUses) return 'Исчерпан'
  return null
}
</script>

<template>
  <div class="admin-promo">
    <header class="head">
      <div>
        <h1>Промокоды</h1>
        <p>Скидка пересчитывается на сервере при оформлении заказа</p>
      </div>
      <UiButton @click="openCreate">Создать промокод</UiButton>
    </header>

    <UiAlert v-if="loadError" tone="danger">{{ loadError }}</UiAlert>

    <div v-if="loading" class="cards">
      <UiSkeleton v-for="i in 3" :key="i" height="150px" radius="var(--radius-md)" />
    </div>

    <UiEmpty
      v-else-if="!codes.length"
      icon="box"
      title="Промокодов пока нет"
      description="Создайте код на процент или фиксированную сумму — покупатели введут его в корзине."
    >
      <UiButton @click="openCreate">Создать промокод</UiButton>
    </UiEmpty>

    <ul v-else class="cards">
      <li v-for="code in codes" :key="code.id" class="promo-card" :class="{ 'is-off': inactiveReason(code) }">
        <div class="promo-head">
          <code class="promo-code">{{ code.code }}</code>
          <UiBadge :tone="inactiveReason(code) ? 'neutral' : 'success'" size="sm">
            {{ inactiveReason(code) || 'Активен' }}
          </UiBadge>
        </div>

        <strong class="promo-value">−{{ discountLabel(code) }}</strong>
        <p v-if="code.description" class="promo-description">{{ code.description }}</p>

        <dl class="promo-facts">
          <div v-if="code.minOrderTotal">
            <dt>От суммы</dt>
            <dd>{{ formatPrice(code.minOrderTotal, 'BYN') }}</dd>
          </div>
          <div>
            <dt>Использован</dt>
            <dd>{{ code.usedCount }}{{ code.maxUses != null ? ` / ${code.maxUses}` : '' }}</dd>
          </div>
          <div v-if="code.startsAt || code.endsAt">
            <dt>Срок</dt>
            <dd>{{ formatDate(code.startsAt) }} — {{ formatDate(code.endsAt) }}</dd>
          </div>
          <div v-if="code.freeDelivery">
            <dt>Доставка</dt>
            <dd>бесплатно</dd>
          </div>
        </dl>

        <div class="promo-actions">
          <UiButton size="sm" variant="ghost" @click="openEdit(code)">Изменить</UiButton>
          <UiButton size="sm" variant="ghost" @click="toggleActive(code)">
            {{ code.isActive ? 'Выключить' : 'Включить' }}
          </UiButton>
          <UiButton size="sm" variant="ghost" @click="deleting = code">Удалить</UiButton>
        </div>
      </li>
    </ul>

    <UiModal
      v-model:open="editorOpen"
      :title="editing ? 'Редактирование промокода' : 'Новый промокод'"
      size="md"
    >
      <UiAlert v-if="formError" tone="danger" class="form-error">{{ formError }}</UiAlert>

      <div class="form">
        <UiField label="Код" required hint="Регистр не важен — сохраняется в верхнем" for="pc-code">
          <UiInput id="pc-code" v-model="form.code" placeholder="SALE10" />
        </UiField>

        <UiField label="Описание" hint="Видно только в админке" for="pc-desc">
          <UiInput id="pc-desc" v-model="form.description" />
        </UiField>

        <div class="form-row">
          <UiField label="Тип скидки" for="pc-type">
            <UiSelect
              id="pc-type"
              v-model="form.type"
              :options="[
                { value: 'PERCENT', label: 'Процент' },
                { value: 'FIXED', label: 'Фиксированная сумма' }
              ]"
            />
          </UiField>

          <UiField
            :label="form.type === 'PERCENT' ? 'Процент' : 'Сумма, BYN'"
            required
            for="pc-value"
          >
            <UiInput
              id="pc-value"
              v-model="form.value"
              type="number"
              step="0.01"
              min="0"
              :max="form.type === 'PERCENT' ? 100 : undefined"
            />
          </UiField>
        </div>

        <div class="form-row">
          <UiField label="Минимальная сумма заказа" for="pc-min">
            <UiInput id="pc-min" v-model="form.minOrderTotal" type="number" step="0.01" min="0" />
          </UiField>

          <UiField label="Лимит применений" hint="Пусто — без ограничений" for="pc-max">
            <UiInput id="pc-max" v-model="form.maxUses" type="number" min="1" />
          </UiField>
        </div>

        <div class="form-row">
          <UiField label="Действует с" for="pc-starts">
            <UiInput id="pc-starts" v-model="form.startsAt" type="datetime-local" />
          </UiField>

          <UiField label="Действует до" for="pc-ends">
            <UiInput id="pc-ends" v-model="form.endsAt" type="datetime-local" />
          </UiField>
        </div>

        <UiCheckbox v-model="form.isActive" label="Активен" />
        <UiCheckbox v-model="form.freeDelivery" label="Бесплатная доставка" />
      </div>

      <template #footer>
        <UiButton variant="ghost" @click="editorOpen = false">Отмена</UiButton>
        <UiButton :loading="saving" @click="save">
          {{ editing ? 'Сохранить' : 'Создать' }}
        </UiButton>
      </template>
    </UiModal>

    <UiModal
      :open="Boolean(deleting)"
      title="Удалить промокод?"
      size="sm"
      @update:open="deleting = null"
    >
      <p class="confirm-text">
        Код «{{ deleting?.code }}» перестанет действовать. Заказы, где он был применён,
        сохранят название кода в истории.
      </p>
      <template #footer>
        <UiButton variant="ghost" @click="deleting = null">Отмена</UiButton>
        <UiButton variant="danger" :loading="deletingBusy" @click="confirmDelete">Удалить</UiButton>
      </template>
    </UiModal>
  </div>
</template>

<style scoped>
.admin-promo {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.head h1 {
  font-size: var(--text-2xl);
}

.head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.cards {
  display: grid;
  padding: 0;
  margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-4);
  list-style: none;
}

.promo-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  gap: var(--space-2);
}

.promo-card.is-off {
  opacity: 0.65;
}

.promo-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.promo-code {
  padding: var(--space-1) var(--space-3);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-xs);
  background: var(--surface-sunken);
  color: var(--text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.promo-value {
  color: var(--sale);
  font-size: var(--text-2xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
}

.promo-description {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.promo-facts {
  display: flex;
  flex-direction: column;
  padding-top: var(--space-3);
  margin: 0;
  border-top: 1px solid var(--border-subtle);
  gap: var(--space-1);
}

.promo-facts > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--text-xs);
}

.promo-facts dt {
  color: var(--text-muted);
}

.promo-facts dd {
  margin: 0;
  color: var(--text-strong);
  font-weight: 600;
}

.promo-actions {
  display: flex;
  margin-top: auto;
  padding-top: var(--space-3);
  gap: var(--space-1);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.form-error {
  margin-bottom: var(--space-4);
}

.confirm-text {
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
