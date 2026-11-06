<script setup lang="ts">
import type { CustomerType } from '~/composables/useAuth'

const { register, errorMessage } = useAuth()
const { redirect, reason, otherLink: loginLink, leaveIfSignedIn } = useAuthRedirect('/login')
const toast = useAppToast()

/**
 * Organisations and ИП only (owner, 2026-11-06): every account is a COMPANY
 * with a УНП the tax registry knows — the API refuses anything else.
 */
const form = reactive({
  customerType: 'COMPANY' as CustomerType,
  login: '',
  password: '',
  passwordConfirm: '',
  name: '',
  email: '',
  phone: '',
  companyName: '',
  taxId: '',
})

const unp = computed(() => form.taxId)
const { state: unpState, problem: unpProblem, hint: unpHint } = useUnpLookup(unp)
// The registry's name goes into a blank field, or replaces its own earlier pick.
let filledName = ''
watch(unpState, (current) => {
  if (current.status !== 'found' || !current.payer.active) return
  const now = form.companyName.trim()
  if (!now || now === filledName) {
    form.companyName = current.payer.shortName
    filledName = current.payer.shortName
  }
})
// Отдельное явное согласие по Закону № 99-З; проверяется только на клиенте.
const personalDataConsent = ref(false)
const submitting = ref(false)
const error = ref('')

onMounted(leaveIfSignedIn)

/** Shown under the field as soon as nine characters are typed. */
const taxIdError = computed(() =>
  (form.taxId.trim().length >= 9 ? requisitesProblem({ taxId: form.taxId }) : '')
  || unpProblem.value
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Mirrors the server's rules so a typo doesn't cost a round trip. */
function validate() {
  if (form.login.trim().length < 3) return 'Логин должен быть не короче 3 символов'
  if (!/^[a-zA-Z0-9._+@-]+$/.test(form.login.trim()))
    return 'Логин может содержать латинские буквы, цифры и символы . _ - + @'
  if (form.password.length < 8) return 'Пароль должен быть не короче 8 символов'
  if (form.password !== form.passwordConfirm) return 'Пароли не совпадают'
  if (!form.taxId.trim()) return 'Укажите УНП организации или ИП'
  if (!/^\d{9}$/.test(form.taxId.replace(/\s/g, '')))
    return 'УНП организации или ИП — 9 цифр'
  if (taxIdError.value) return taxIdError.value
  if (!form.companyName.trim()) return 'Укажите название организации или ИП'
  if (!form.email.trim() && !EMAIL_RE.test(form.login.trim()))
    return 'Укажите e-mail — на него придёт письмо для подтверждения регистрации'
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim()))
    return 'Проверьте e-mail'
  if (!personalDataConsent.value)
    return 'Дайте согласие на обработку персональных данных'
  return ''
}

async function submit() {
  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    const created = await register({
      login: form.login.trim(),
      password: form.password,
      customerType: form.customerType,
      name: form.name.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      companyName: form.companyName.trim(),
      taxId: form.taxId.trim(),
    })
    toast.success(
      created.email
        ? `Аккаунт создан. Письмо для подтверждения отправлено на ${created.email}`
        : 'Аккаунт создан'
    )
    // Straight back to what they were doing — the cart survived the detour.
    await navigateTo(redirect.value || '/account')
  } catch (err) {
    error.value = errorMessage(err, 'Не удалось зарегистрироваться')
  } finally {
    submitting.value = false
  }
}

useSeoMeta({ title: 'Регистрация | Gost.by', robots: 'noindex,nofollow' })
</script>

<template>
  <div class="auth-page">
    <UiCard title="Регистрация">
      <form class="form" novalidate @submit.prevent="submit">
        <UiAlert v-if="reason" tone="info">{{ reason }}</UiAlert>
        <UiAlert v-if="error" tone="danger">{{ error }}</UiAlert>

        <p class="b2b-note">
          Регистрация — для организаций и ИП: заказы оформляются по счёту.
          Розничные покупки — в магазине или по телефону.
        </p>

        <div class="grid">
          <UiField
            label="УНП"
            required
            for="reg-tax"
            :error="taxIdError"
            :hint="unpHint || 'Название подставим из реестра МНС'"
          >
            <UiInput id="reg-tax" v-model="form.taxId" placeholder="123456789" inputmode="numeric" />
          </UiField>

          <UiField label="Организация или ИП" required for="reg-company">
            <UiInput id="reg-company" v-model="form.companyName" placeholder="ООО «Ромашка»" autocomplete="organization" />
          </UiField>
        </div>

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
          label="Контактное лицо"
          for="reg-name"
        >
          <UiInput id="reg-name" v-model="form.name" autocomplete="name" />
        </UiField>

        <div class="grid">
          <UiField
            label="E-mail"
            :required="!EMAIL_RE.test(form.login.trim())"
            hint="Пришлём письмо для подтверждения"
            for="reg-email"
          >
            <UiInput id="reg-email" v-model="form.email" type="email" autocomplete="email" />
          </UiField>

          <UiField label="Телефон" for="reg-phone">
            <UiInput id="reg-phone" v-model="form.phone" type="tel" autocomplete="tel" />
          </UiField>
        </div>


        <UiCheckbox v-model="personalDataConsent" class="consent">
          Даю согласие на обработку персональных данных в соответствии с
          <NuxtLink to="/privacy" target="_blank">Политикой обработки персональных данных</NuxtLink>
        </UiCheckbox>

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

.b2b-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.form .consent {
  align-items: flex-start;
  font-size: var(--text-sm);
}

.consent a {
  color: var(--text-link);
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
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
