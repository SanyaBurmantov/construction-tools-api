<script setup lang="ts">
import {
  COMPANY_FIELD_LABELS,
  companyPlaceholderFields,
} from '~/data/company'

/**
 * Launch blockers that are invisible from the admin side but very visible to
 * customers. Company details in particular render in the footer — that is,
 * on every page — and in the offer and privacy pages, where placeholder text
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
      странице, в оферте, политике и контактах. Заполните
      <code>frontend/app/data/company.ts</code>:
      <strong>{{ missing.join(', ') }}</strong>.
    </span>
  </UiAlert>
</template>

<style scoped>
code {
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  background: rgb(0 0 0 / 8%);
  font-family: var(--font-mono);
  font-size: 0.9em;
}
</style>
