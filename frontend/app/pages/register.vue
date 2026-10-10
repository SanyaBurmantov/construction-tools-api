<script setup lang="ts">
import type { CustomerType } from '~/composables/useAuth'

const { register, refresh, isAuthenticated, errorMessage } = useAuth()
const route = useRoute()
const toast = useAppToast()

/** Same pair as the login screen: where to return and why we are here. */
const redirect = computed(() => {
  const target = route.query.redirect
  return typeof target === 'string' && target.startsWith('/') ? target : ''
})

const reason = computed(() => {
  const key = route.query.reason
  return typeof key === 'string' ? AUTH_REASONS[key] || '' : ''
})

const loginLink = computed(() => ({
  path: '/login',
  query: {
    ...(redirect.value ? { redirect: redirect.value } : {}),
    ...(typeof route.query.reason === 'string' ? { reason: route.query.reason } : {}),
  },
}))

const customerTypes: Array<{ value: CustomerType, label: string, hint: string }> = [
  { value: 'INDIVIDUAL', label: 'Физическое лицо', hint: 'Покупки для себя' },
  { value: 'COMPANY', label: 'Юридическое лицо', hint: 'Счёт на организацию, оплата по счёту' },
]

const form = reactive({
  customerType: 'INDIVIDUAL' as CustomerType,
  login: '',
  password: '',
  passwordConfirm: '',
  name: '',
  email: '',
  phone: '',
  companyName: '',
  taxId: '',
})

const isCompany = computed(() => form.customerType === 'COMPANY')
const submitting = ref(false)
const error = ref('')

onMounted(async () => {
  await refresh()
  if (isAuthenticated.value) await navigateTo(redirect.value || '/account')
})

/** Mirrors the server's rules so a typo doesn't cost a round trip. */
function validate() {
  if (form.login.trim().length < 3) return 'Логин должен быть не короче 3 символов'
  if (!/^[a-zA-Z0-9._+@-]+$/.test(form.login.trim()))
    return 'Логин может содержать латинские буквы, цифры и символы . _ - + @'
  if (form.password.length < 8) return 'Пароль должен быть не короче 8 символов'
  if (form.password !== form.passwordConfirm) return 'Пароли не совпадают'
  if (isCompany.value && !form.companyName.trim())
    return 'Для юридического лица укажите название организации'
  return ''
}

async function submit() {
  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    await register({
      login: form.login.trim(),
      password: form.password,
      customerType: form.customerType,
      name: form.name.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      companyName: isCompany.value ? form.companyName.trim() : undefined,
      taxId: isCompany.value ? form.taxId.trim() || undefined : undefined,
    })
    toast.success('Аккаунт создан')
    // Straight back to what they were doing — the cart survived the detour.
    await navigateTo(redirect.value || '/account')
  } catch (err) {
    error.value = errorMessage(err, 'Не удалось зарегистрироваться')
  } finally {
    submitting.value = false
  }
}

useSeoMeta({ title: 'Регистрация | Мультитул', robots: 'noindex,nofollow' })
</script>

<template>
  <div class="auth-page">
    <UiCard title="Регистрация">
      <form class="form" novalidate @submit.prevent="submit">
        <UiAlert v-if="reason" tone="info">{{ reason }}</UiAlert>
        <UiAlert v-if="error" tone="danger">{{ error }}</UiAlert>

        <fieldset class="options">
          <legend>Тип покупателя</legend>
          <label
            v-for="option in customerTypes"
            :key="option.value"
            class="option"
            :class="{ 'is-active': form.customerType === option.value }"
          >
            <input v-model="form.customerType" type="radio" :value="option.value">
            <span class="option-body">
              <span class="option-label">{{ option.label }}</span>
              <span class="option-hint">{{ option.hint }}</span>
            </span>
          </label>
        </fieldset>

        <UiField
          label="Логин"
          required
          hint="Латинские буквы, цифры или e-mail"
          for="reg-login"
        >
          <UiInput id="reg-login" v-model="form.login" autocomplete="username" placeholder="ivanov" />
        </UiField>

        <div class="grid">
          <UiField label="Пароль" required hint="Минимум 8 символов" for="reg-password">
            <UiInput
              id="reg-password"
              v-model="form.password"
              type="password"
              autocomplete="new-password"
              placeholder="••••••••"
            />
          </UiField>

          <UiField label="Пароль ещё раз" required for="reg-password2">
            <UiInput
              id="reg-password2"
              v-model="form.passwordConfirm"
              type="password"
              autocomplete="new-password"
              placeholder="••••••••"
            />
          </UiField>
        </div>

        <UiField
          :label="isCompany ? 'Контактное лицо' : 'Имя'"
          for="reg-name"
        >
          <UiInput id="reg-name" v-model="form.name" autocomplete="name" />
        </UiField>

        <div class="grid">
          <UiField label="E-mail" for="reg-email">
            <UiInput id="reg-email" v-model="form.email" type="email" autocomplete="email" />
          </UiField>

          <UiField label="Телефон" for="reg-phone">
            <UiInput id="reg-phone" v-model="form.phone" type="tel" autocomplete="tel" />
          </UiField>
        </div>

        <template v-if="isCompany">
          <UiField label="Название организации" required for="reg-company">
            <UiInput id="reg-company" v-model="form.companyName" placeholder="ООО «Ромашка»" />
          </UiField>

          <UiField label="УНП" for="reg-tax">
            <UiInput id="reg-tax" v-model="form.taxId" placeholder="123456789" />
          </UiField>
        </template>

        <UiButton type="submit" size="lg" block :loading="submitting">
          Зарегистрироваться
        </UiButton>

        <p class="switch">
          Уже есть аккаунт?
          <NuxtLink :to="loginLink">Войти</NuxtLink>
        </p>
      </form>
    </UiCard>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  width: min(560px, 100%);
  flex-direction: column;
  margin: 0 auto;
  gap: var(--space-4);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.options {
  display: grid;
  border: 0;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.options legend {
  margin-bottom: var(--space-2);
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.option {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  cursor: pointer;
  gap: var(--space-3);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.option:hover {
  border-color: var(--border-strong);
}

.option.is-active {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.option input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.option:has(input:focus-visible) {
  box-shadow: var(--shadow-focus);
}

.option-body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.option-label {
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 700;
}

.option-hint {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.switch {
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}

.switch a {
  color: var(--text-link);
  font-weight: 600;
}

@media (max-width: 640px) {
  .grid,
  .options {
    grid-template-columns: 1fr;
  }
}
</style>
