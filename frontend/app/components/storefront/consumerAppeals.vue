<script setup lang="ts">
/**
 * Порядок обращений покупателей и контакты органов, которые их
 * рассматривают (`data/company.ts` → `consumerAppeals`). Один текст для
 * подвала (`compact`, есть на главной — п. 13.1 Правил № 31) и для
 * страницы «Контакты».
 */
import { company, consumerAppeals } from '~/data/company'

defineProps<{ compact?: boolean }>()
</script>

<template>
  <p v-if="compact" class="appeals-compact">
    Обращения покупателей рассматривает {{ company.name }}:
    <a :href="company.phoneHref">{{ company.phone }}</a>,
    <a :href="company.emailHref">{{ company.email }}</a>.
    По вопросам защиты прав потребителей:
    <template v-for="(item, i) in consumerAppeals" :key="item.phone">
      {{ item.org }} — <a :href="item.phoneHref">{{ item.phone }}</a>{{ i < consumerAppeals.length - 1 ? '; ' : '.' }}
    </template>
  </p>
  <div v-else class="appeals">
    <p>
      Обращения и претензии принимает {{ company.name }}: по телефону
      <a :href="company.phoneHref">{{ company.phone }}</a>, по e-mail
      <a :href="company.emailHref">{{ company.email }}</a> или письменно по
      юридическому адресу: {{ company.legalAddress }}.
    </p>
    <p>
      Письменное и электронное обращение рассматривается не позднее 15 дней
      со дня получения, а требующее дополнительного изучения — не позднее
      месяца (Закон Республики Беларусь «Об обращениях граждан и
      юридических лиц»). Претензии по качеству товара — в сроки, указанные в
      <NuxtLink to="/usloviya">условиях продажи</NuxtLink>.
    </p>
    <p>Если вопрос не решён, обратиться можно также:</p>
    <ul>
      <li v-for="item in consumerAppeals" :key="item.phone">
        {{ item.org }} ({{ item.who }}), {{ item.address }}, тел.
        <a :href="item.phoneHref">{{ item.phone }}</a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.appeals-compact {
  margin: 0;
  font-size: 12px;
}

.appeals-compact a {
  color: inherit;
  white-space: nowrap;
}
</style>
