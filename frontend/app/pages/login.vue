<script setup lang="ts">
const { login, isAdmin, errorMessage, errorCode } = useAuth()
const { redirect, reason, otherLink: registerLink, leaveIfSignedIn } = useAuthRedirect('/register')
const toast = useAppToast()

const form = reactive({ login: '', password: '', otp: '' })
/** The account has the second factor on: the code field is shown. */
const needsOtp = ref(false)
const submitting = ref(false)
const error = ref('')

onMounted(leaveIfSignedIn)

async function submit() {
  error.value = ''
  if (!form.login.trim() || !form.password) {
    error.value = 'Введите логин и пароль'
    return
  }
  submitting.value = true
  try {
    await login({
      login: form.login.trim(),
      password: form.password,
      otp: needsOtp.value ? form.otp.trim() : undefined,
    })
    toast.success('Вы вошли в аккаунт')
    await navigateTo(redirect.value || (isAdmin.value ? '/admin' : '/account'))
  } catch (err) {
    const code = errorCode(err)
    if (code === 'OTP_REQUIRED') {
      // The password was right: now the code. Not an error to show in red.
      needsOtp.value = true
      return
    }
    if (code === 'OTP_INVALID') form.otp = ''
    error.value = errorMessage(err, 'Не удалось войти')
  } finally {
    submitting.value = false
  }
}

useSeoMeta({ title: 'Вход | Gost.by', robots: 'noindex,nofollow' })
</script>

<template>
  <div class="auth-page">
    <UiCard title="Вход в аккаунт">
      <form class="form" novalidate @submit.prevent="submit">
        <UiAlert v-if="reason" tone="info">{{ reason }}</UiAlert>
        <UiAlert v-if="error" tone="danger">{{ error }}</UiAlert>

        <UiField label="Логин" required hint="Логин или e-mail" for="login-login">
          <UiInput
            id="login-login"
            v-model="form.login"
            autocomplete="username"
            placeholder="ivanov"
            :invalid="Boolean(error)"
          />
        </UiField>

        <UiField label="Пароль" required for="login-password">
          <UiInput
            id="login-password"
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            :invalid="Boolean(error)"
          />
        </UiField>

        <UiField
          v-if="needsOtp"
          label="Код из приложения"
          required
          hint="Шесть цифр из Google Authenticator, Яндекс Ключа или другого приложения-аутентификатора"
          for="login-otp"
        >
          <UiInput
            id="login-otp"
            v-model="form.otp"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="123456"
            autofocus
          />
        </UiField>

        <UiButton type="submit" size="lg" block :loading="submitting">Войти</UiButton>

        <p class="switch">
          Нет аккаунта?
          <NuxtLink :to="registerLink">Зарегистрироваться</NuxtLink>
        </p>
      </form>
    </UiCard>

    <p class="note">
      Корзина сохраняется — после входа вы вернётесь к оформлению с теми же
      товарами.
    </p>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  width: min(460px, 100%);
  flex-direction: column;
  margin: 0 auto;
  gap: var(--space-4);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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

.note {
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
