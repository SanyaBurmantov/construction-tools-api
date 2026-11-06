<script setup lang="ts">
/**
 * Баннер согласия на аналитические cookie (`useCookieConsent`). Рисуется
 * только в браузере после чтения выбора: в общем кешированном HTML его нет,
 * и посетитель, который уже выбрал, его не видит.
 */
const { bannerVisible, choice, load, accept, decline } = useCookieConsent()
onMounted(load)
</script>

<template>
  <section
    v-if="bannerVisible"
    class="cookie-consent"
    role="dialog"
    aria-live="polite"
    aria-labelledby="cookie-consent-title"
  >
    <div class="cookie-consent__text">
      <h2 id="cookie-consent-title">Мы используем cookie</h2>
      <p>
        Необходимые — для входа, корзины и избранного — работают всегда.
        С вашего согласия подключим Яндекс.Метрику: она собирает статистику
        посещений и записывает действия на страницах, чтобы мы делали сайт
        удобнее. Подробнее — в
        <NuxtLink to="/privacy">Политике обработки персональных данных</NuxtLink>.
      </p>
      <p v-if="choice" class="cookie-consent__current">
        Сейчас: {{ choice === 'all' ? 'Метрика разрешена' : 'только необходимые' }}.
      </p>
    </div>
    <div class="cookie-consent__actions">
      <UiButton size="sm" @click="accept">Принять все</UiButton>
      <UiButton size="sm" variant="secondary" @click="decline">Только необходимые</UiButton>
    </div>
  </section>
</template>

<style scoped>
.cookie-consent {
  position: fixed;
  z-index: var(--z-overlay);
  right: var(--space-4);
  bottom: var(--space-4);
  left: var(--space-4);
  display: flex;
  max-width: 760px;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  margin: 0 auto;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
  box-shadow: var(--shadow-xl);
  color: var(--text-default);
}

.cookie-consent__text {
  flex: 1 1 360px;
  min-width: 0;
}

.cookie-consent h2 {
  margin: 0 0 var(--space-1);
  color: var(--text-strong);
  font-size: var(--text-md);
}

.cookie-consent p {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.5;
}

.cookie-consent__current {
  margin-top: var(--space-1) !important;
  color: var(--text-muted);
}

.cookie-consent__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* Над нижней навигацией телефона (62px, см. layouts/default.vue). */
@media (max-width: 860px) {
  .cookie-consent {
    right: var(--space-3);
    bottom: calc(62px + env(safe-area-inset-bottom) + var(--space-3));
    left: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .cookie-consent__actions {
    width: 100%;
  }

  .cookie-consent__actions > * {
    flex: 1 1 0;
  }
}
</style>
