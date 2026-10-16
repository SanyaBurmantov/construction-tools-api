<script setup lang="ts">
const { verifyEmail, whenReady, isAuthenticated, errorMessage } = useAuth()
const route = useRoute()

const state = ref<'pending' | 'done' | 'failed'>('pending')
const email = ref('')
const error = ref('')

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!token) {
    state.value = 'failed'
    error.value = 'В ссылке нет кода подтверждения'
    return
  }
  // The link is often opened on another device — knowing the session only
  // decides where the button below leads.
  await whenReady()
  try {
    email.value = (await verifyEmail(token)).email
    state.value = 'done'
  } catch (err) {
    state.value = 'failed'
    error.value = errorMessage(err, 'Не удалось подтвердить e-mail')
  }
})

useSeoMeta({ title: 'Подтверждение e-mail | Gost.by', robots: 'noindex,nofollow' })
</script>

<template>
  <div class="verify-page">
    <UiCard title="Подтверждение e-mail">
      <UiSkeleton v-if="state === 'pending'" height="64px" />
      <template v-else-if="state === 'done'">
        <UiAlert tone="success">E-mail {{ email }} подтверждён. Спасибо!</UiAlert>
        <UiButton :to="isAuthenticated ? '/account' : '/login'" class="action">
          {{ isAuthenticated ? 'В личный кабинет' : 'Войти' }}
        </UiButton>
      </template>
      <template v-else>
        <UiAlert tone="danger">{{ error }}</UiAlert>
        <UiButton :to="isAuthenticated ? '/account' : '/login'" variant="secondary" class="action">
          {{ isAuthenticated ? 'В личный кабинет' : 'Войти' }}
        </UiButton>
      </template>
    </UiCard>
  </div>
</template>

<style scoped>
.verify-page {
  width: min(560px, 100%);
  margin: 0 auto;
}

.action {
  margin-top: var(--space-4);
}
</style>
