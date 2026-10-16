<script setup lang="ts">
import {
  COMPANY_FIELD_LABELS,
  companyPlaceholderFields,
} from '~/data/company'

/**
 * Launch blockers that are invisible from the admin side but very visible to
 * customers. Company details in particular render in the footer — that is,
 * on every page — and in the terms-of-sale and privacy pages, where placeholder text
 * is not just ugly but legally meaningless.
 */
const missing = computed(() =>
  companyPlaceholderFields.map((field) => COMPANY_FIELD_LABELS[field] ?? field)
)
</script>

<template>
  <UiAlert v-if="missing.length" tone="warning" title="Реквизиты не заполнены">
    <span>
      Покупатели видят вместо них текст в квадратных скобках — в футере на каждой
      странице, в условиях продажи, политике и контактах. Заполните
      <code>frontend/app/data/company.ts</code>:
      <strong>{{ missing.join(', ') }}</strong>.
    </span>
  </UiAlert>
</template>

<style scoped>
code {
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  /* A tint of the alert's own text colour, so it reads on any tone. */
  background: color-mix(in srgb, currentcolor 10%, transparent);
  font-family: var(--font-mono);
  font-size: 0.9em;
}
</style>
