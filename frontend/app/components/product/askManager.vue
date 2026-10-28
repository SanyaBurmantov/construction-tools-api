<script setup lang="ts">
/**
 * «Уточнить наличие / подобрать аналог». A purchaser with a list to fill
 * often needs a replacement for what is out of stock, or a firm date — a
 * question to a manager, not a cart. Goes to `POST /leads` (Telegram + mail).
 */
const props = defineProps<{
  productId: string
  productName: string
  inStock: boolean
}>()

const open = ref(false)
const toast = useAppToast()
const { user, authFetch, errorMessage } = useAuth()

const form = reactive({
  contactName: '',
  phone: '',
  email: '',
  companyName: '',
  message: '',
  website: '',
})
const consent = ref(false)
const sending = ref(false)
const error = ref('')

function start() {
  error.value = ''
  const account = user.value
  if (account) {
    form.contactName ||= account.name || ''
    form.phone ||= account.phone || ''
    form.email ||= account.email || ''
    form.companyName ||= account.companyName || ''
  }
  form.message ||= props.inStock
    ? 'Нужно N шт. — подтвердите наличие и срок поставки.'
    : 'Когда будет в наличии? Если долго — подберите, пожалуйста, аналог.'
  open.value = true
}

async function send() {
  error.value = ''
  if (form.contactName.trim().length < 2) error.value = 'Укажите имя'
  else if (form.phone.trim().length < 5) error.value = 'Укажите телефон'
  else if (form.message.trim().length < 2) error.value = 'Напишите вопрос'
  else if (!consent.value) error.value = 'Дайте согласие на обработку персональных данных'
  if (error.value) return

  sending.value = true
  try {
    await authFetch('/leads', {
      method: 'POST',
      body: {
        productId: props.productId,
        contactName: form.contactName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        message: form.message.trim(),
        website: form.website || undefined,
        attribution: getAttribution(),
      },
    })
    open.value = false
    toast.success('Вопрос отправлен — менеджер перезвонит в рабочее время')
  } catch (err) {
    error.value = errorMessage(err, 'Не удалось отправить. Позвоните нам — ответим сразу.')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <span class="ask-manager">
  <button type="button" class="ask" @click="start">
    <UiIcon name="alert" :stroke-width="1.8" />
    {{ inStock ? 'Уточнить наличие и срок' : 'Подобрать аналог' }}
  </button>

  <UiModal v-model:open="open" title="Вопрос менеджеру">
    <form class="ask-form" novalidate @submit.prevent="send">
      <p class="about">{{ productName }}</p>
      <UiAlert v-if="error" tone="danger">{{ error }}</UiAlert>
      <div class="grid">
        <UiField label="Имя" required for="ask-name">
          <UiInput id="ask-name" v-model="form.contactName" autocomplete="name" />
        </UiField>
        <UiField label="Телефон" required for="ask-phone">
          <UiInput id="ask-phone" v-model="form.phone" type="tel" autocomplete="tel" />
        </UiField>
        <UiField label="E-mail" for="ask-email">
          <UiInput id="ask-email" v-model="form.email" type="email" autocomplete="email" />
        </UiField>
        <UiField label="Организация" for="ask-company">
          <UiInput id="ask-company" v-model="form.companyName" autocomplete="organization" />
        </UiField>
      </div>
      <UiField label="Вопрос" required for="ask-message">
        <UiTextarea id="ask-message" v-model="form.message" :rows="3" :maxlength="2000" />
      </UiField>
      <!-- Honeypot: off-screen, only a bot fills it. -->
      <input v-model="form.website" class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <UiCheckbox v-model="consent">
        Даю согласие на обработку персональных данных в соответствии с
        <NuxtLink to="/privacy" target="_blank">Политикой</NuxtLink>
      </UiCheckbox>
    </form>
    <template #footer>
      <UiButton variant="ghost" @click="open = false">Отмена</UiButton>
      <UiButton :loading="sending" @click="send">Отправить</UiButton>
    </template>
  </UiModal>
  </span>
</template>

<style scoped>
/* Same look as the page's «В избранное» / «Сравнить» links. */
.ask {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-weight: 600;
  transition: color var(--duration-fast) var(--ease-out);
}

.ask:hover {
  color: var(--brand);
}

.ask svg {
  width: 18px;
  height: 18px;
}

.ask-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.about {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.hp {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
}
</style>
