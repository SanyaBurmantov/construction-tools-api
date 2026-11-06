<script setup lang="ts">
/**
 * Сноска под кнопкой покупки: сайт продаёт организациям и ИП по счёту
 * (решение собственника 06.11.2026), розница — в магазине или по телефону.
 * Кнопка «В корзину» остаётся у всех: смотреть и собирать корзину может
 * любой, оформить заказ — только организация с УНП.
 */
import { company } from '~/data/company'
</script>

<template>
  <p class="retail-note">
    Продаём организациям и ИП по безналичному расчёту. Розничные покупки —
    в магазине ({{ company.storeAddress }}) или по телефону
    <a :href="company.phoneHref">{{ company.phone }}</a>.
  </p>
</template>

<style scoped>
.retail-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.retail-note a {
  color: inherit;
  white-space: nowrap;
}
</style>
