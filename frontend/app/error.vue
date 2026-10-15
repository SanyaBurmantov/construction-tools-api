<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

/**
 * 503 is the storefront saying «API не отвечает» (see `isApiUnavailable`):
 * technical works, not a mistake the visitor made. Going to the home page
 * would only land on the same outage, so the action here is «обновить».
 */
const isMaintenance = computed(() => props.error.statusCode === 503)

// The error page used to have no <title> at all, so an outage answer or a 404
// read in a crawler (or an audit) as «page without a title».
useHead(() => ({
  title: isMaintenance.value
    ? 'Технические работы | Мультитул'
    : props.error.statusCode === 404
      ? 'Страница не найдена | Мультитул'
      : 'Ошибка | Мультитул',
  meta: [{ name: 'robots', content: 'noindex' }],
}))

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
      <button type="button" @click="retry">Обновить страницу</button>
    </div>

    <div v-else class="error-card">
      <span class="eyebrow">Ошибка {{ error.statusCode || error.status }}</span>
      <h1>{{ error.statusMessage || 'Что-то пошло не так' }}</h1>
      <p>{{ error.message || 'Попробуйте обновить страницу или вернуться на главную.' }}</p>
      <button type="button" @click="handleError">Вернуться на главную</button>
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

.eyebrow {
  color: var(--brand-hover);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
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

button {
  margin-top: 28px;
  border: 2px solid var(--text-strong);
  border-radius: 999px;
  background: var(--brand);
  color: var(--text-strong);
  cursor: pointer;
  font-weight: 900;
  padding: 13px 18px;
}
</style>
