<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

/**
 * 503 is the storefront saying «API не отвечает» (see `isApiUnavailable`):
 * technical works, not a mistake the visitor made. Going to the home page
 * would only land on the same outage, so the action here is «обновить».
 */
const isMaintenance = computed(() => props.error.statusCode === 503)
/**
 * 404 has its own fixed copy: Nuxt's default statusMessage is English
 * («Page not found: /…») and went straight into the <h1> a crawler reads.
 */
const isNotFound = computed(() => props.error.statusCode === 404)

// The error page used to have no <title> at all, so an outage answer or a 404
// read in a crawler (or an audit) as «page without a title».
useHead(() => ({
  title: isMaintenance.value
    ? 'Технические работы | Gost.by'
    : props.error.statusCode === 404
      ? 'Страница не найдена | Gost.by'
      : 'Ошибка | Gost.by',
  meta: [{ name: 'robots', content: 'noindex' }],
}))

/**
 * Nuxt fills `message` with `statusMessage` when nothing else was given, so
 * printing both repeated the heading word for word under itself.
 */
const detail = computed(() => {
  const message = props.error.message
  if (!message || message === props.error.statusMessage) return ''
  return message
})

const handleError = () => clearError({ redirect: '/' })
const retry = () => reloadNuxtApp({ persistState: false })
</script>

<template>
  <div class="error-page">
    <div v-if="isMaintenance" class="error-card">
      <span class="eyebrow">Технические работы</span>
      <!-- Fixed copy: Nuxt may rewrite an error's `message` in production. -->
      <h1>Магазин временно недоступен</h1>
      <p>Мы уже чиним — обновите страницу через пару минут. Заказы и корзина
        никуда не делись.</p>
      <UiButton class="error-action" size="lg" @click="retry">Обновить страницу</UiButton>
    </div>

    <div v-else-if="isNotFound" class="error-card">
      <span class="eyebrow">Ошибка 404</span>
      <h1>Страница не найдена</h1>
      <p>Возможно, товар снят с продажи, раздел переехал или в ссылке опечатка.
        Найдите нужное через каталог или поиск — в каталоге больше 50 000 позиций.</p>
      <div class="error-actions">
        <UiButton size="lg" @click="clearError({ redirect: '/catalog' })">Перейти в каталог</UiButton>
        <UiButton size="lg" variant="secondary" @click="handleError">На главную</UiButton>
      </div>
    </div>

    <div v-else class="error-card">
      <span class="eyebrow">Ошибка {{ error.statusCode || error.status }}</span>
      <h1>{{ error.statusMessage || 'Что-то пошло не так' }}</h1>
      <p>{{ detail || 'Попробуйте обновить страницу или вернуться на главную.' }}</p>
      <UiButton class="error-action" size="lg" @click="handleError">Вернуться на главную</UiButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.error-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--surface-page);
}

.error-card {
  max-width: 640px;
  border: 2px solid var(--text-strong);
  border-radius: 34px;
  background: var(--surface-card);
  box-shadow: 10px 10px 0 var(--text-strong);
  padding: clamp(28px, 6vw, 56px);
}

h1 {
  margin-top: 12px;
  font-size: clamp(34px, 7vw, 64px);
}

p {
  margin-top: 16px;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1.7;
}

.error-action {
  margin-top: 28px;
}

.error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}
</style>
