<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()

const handleError = () => clearError({ redirect: '/' })
</script>

<template>
  <div class="error-page">
    <div class="error-card">
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
