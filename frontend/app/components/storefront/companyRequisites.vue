<script setup lang="ts">
import { company } from '~/data/company'

type Field =
  | 'phone'
  | 'messengers'
  | 'email'
  | 'storeAddress'
  | 'workingHours'
  | 'name'
  | 'unp'
  | 'legalAddress'

/**
 * The seller's contacts and requisites as a `<dl>`. About, contacts and the
 * terms of sale each wrote the same rows out by hand; the presets keep the
 * order each page had.
 */
const PRESETS: Record<'contacts' | 'legal' | 'seller', Field[]> = {
  contacts: ['phone', 'messengers', 'email', 'storeAddress', 'workingHours'],
  legal: ['name', 'unp', 'legalAddress'],
  seller: ['name', 'unp', 'legalAddress', 'storeAddress', 'workingHours', 'phone', 'email'],
}

const LABELS: Record<Field, string> = {
  phone: 'Телефон',
  messengers: 'Viber, Telegram',
  email: 'E-mail',
  storeAddress: 'Адрес магазина (самовывоз)',
  workingHours: 'Режим работы',
  name: 'Наименование',
  unp: 'УНП',
  legalAddress: 'Юридический адрес',
}

const props = defineProps<{ variant: keyof typeof PRESETS }>()
const fields = computed(() => PRESETS[props.variant])
</script>

<template>
  <dl class="requisites">
    <div v-for="field in fields" :key="field">
      <dt>{{ LABELS[field] }}</dt>
      <dd v-if="field === 'phone'"><a :href="company.phoneHref">{{ company.phone }}</a></dd>
      <dd v-else-if="field === 'messengers'">
        {{ company.phone }} —
        <a :href="company.viberHref">Viber</a>,
        <a :href="company.telegramHref" target="_blank" rel="noopener">Telegram</a>
      </dd>
      <dd v-else-if="field === 'email'"><a :href="company.emailHref">{{ company.email }}</a></dd>
      <dd v-else>{{ company[field] }}</dd>
    </div>
  </dl>
</template>

<style scoped lang="scss">
.requisites {
  display: grid;
  gap: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  margin-top: 14px;
  overflow: hidden;

  > div {
    display: grid;
    gap: 4px;
    border-bottom: 1px solid var(--border-subtle);
    padding: 12px 16px;

    &:last-child {
      border-bottom: 0;
    }

    @media (min-width: 640px) {
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 16px;
    }
  }

  dt {
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 700;
  }

  dd {
    margin: 0;
    color: var(--text-strong);
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  a {
    color: var(--brand);
  }
}
</style>
