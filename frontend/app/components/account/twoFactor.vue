<script setup lang="ts">
/**
 * «Вход с кодом из приложения» — the TOTP second factor (backend auth/totp).
 * Off → «Включить» gets a secret (shown as text and as an otpauth link a phone
 * opens in its authenticator) → the first valid code switches it on. On →
 * switching off needs the password and a current code. A lost phone is
 * rescued by an admin (/admin/users → «Снять блокировку входа»).
 */
const { user, authFetch, refresh, errorMessage } = useAuth()
const toast = useAppToast()

const setup = ref<{ secret: string, otpauthUrl: string } | null>(null)
const code = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')

const enabled = computed(() => Boolean(user.value?.totpEnabledAt))
/** The secret in groups of four: easier to type by hand. */
const secretGroups = computed(() => setup.value?.secret.match(/.{1,4}/g)?.join(' ') ?? '')

async function start() {
  busy.value = true
  error.value = ''
  try {
    setup.value = await authFetch<{ secret: string, otpauthUrl: string }>('/auth/totp/setup', { method: 'POST' })
  } catch (err) {
    error.value = errorMessage(err, 'Не удалось получить ключ')
  } finally {
    busy.value = false
  }
}

async function confirm() {
  busy.value = true
  error.value = ''
  try {
    await authFetch('/auth/totp/enable', { method: 'POST', body: { code: code.value.trim() } })
    await refresh()
    setup.value = null
    code.value = ''
    toast.success('Вход с кодом включён')
  } catch (err) {
    error.value = errorMessage(err, 'Код не подошёл')
  } finally {
    busy.value = false
  }
}

async function disable() {
  busy.value = true
  error.value = ''
  try {
    await authFetch('/auth/totp/disable', {
      method: 'POST',
      body: { password: password.value, code: code.value.trim() },
    })
    await refresh()
    password.value = ''
    code.value = ''
    toast.success('Вход с кодом выключен')
  } catch (err) {
    error.value = errorMessage(err, 'Не удалось выключить')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiCard title="Вход с кодом из приложения">
    <UiAlert v-if="error" tone="danger">{{ error }}</UiAlert>

    <template v-if="enabled">
      <p class="muted">
        Включён{{ user?.totpEnabledAt ? ` с ${formatDate(user.totpEnabledAt)}` : '' }}: после пароля
        сайт спрашивает шесть цифр из приложения на телефоне. Даже узнав пароль, без телефона
        войти нельзя.
      </p>
      <form class="form" @submit.prevent="disable">
        <UiField label="Пароль" for="totp-off-password">
          <UiInput id="totp-off-password" v-model="password" type="password" autocomplete="current-password" />
        </UiField>
        <UiField label="Код из приложения" for="totp-off-code">
          <UiInput id="totp-off-code" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
        </UiField>
        <div class="form-actions">
          <UiButton type="submit" variant="secondary" :loading="busy" :disabled="!password || code.trim().length < 6">
            Выключить
          </UiButton>
        </div>
      </form>
    </template>

    <template v-else-if="setup">
      <ol class="steps">
        <li>
          Откройте приложение-аутентификатор (Google Authenticator, Яндекс Ключ, 1Password…) и
          добавьте ключ вручную —
          <code class="secret">{{ secretGroups }}</code>
          — или <a :href="setup.otpauthUrl">откройте эту ссылку на телефоне</a>.
        </li>
        <li>Введите шесть цифр, которые покажет приложение.</li>
      </ol>
      <form class="form" @submit.prevent="confirm">
        <UiField label="Код из приложения" for="totp-on-code">
          <UiInput id="totp-on-code" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus />
        </UiField>
        <div class="form-actions">
          <UiButton type="submit" :loading="busy" :disabled="code.trim().length < 6">Включить</UiButton>
          <UiButton variant="ghost" @click="setup = null">Отмена</UiButton>
        </div>
      </form>
    </template>

    <template v-else>
      <p class="muted">
        Второй шаг входа: после пароля — код из приложения на вашем телефоне. Стоит включить
        администраторам и тем, кто оформляет заказы от организации.
      </p>
      <div class="form-actions">
        <UiButton variant="secondary" :loading="busy" @click="start">Включить вход с кодом</UiButton>
      </div>
    </template>
  </UiCard>
</template>

<style scoped>
.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.form {
  display: grid;
  gap: var(--space-3);
  max-width: 360px;
  margin-top: var(--space-3);
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.steps {
  display: grid;
  gap: var(--space-2);
  padding-left: var(--space-5);
  font-size: var(--text-sm);
}

.secret {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
  user-select: all;
}
</style>
