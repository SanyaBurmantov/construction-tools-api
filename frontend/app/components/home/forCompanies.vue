<script setup lang="ts">
/**
 * «Закупаете для организации?» on the home page: the three steps of a
 * purchase by invoice, the actions a buyer came for (price list, invoice and
 * commercial offer from the cart, a supply contract) and the seller's own
 * requisites — a buyer checks who they are paying before anything else.
 */
import { company } from '~/data/company'
import { reachGoal } from '~/utils/metrika'

const { priceListUrl } = useB2b()
const { terms } = useOrderTerms()
const { formatPrice } = useFormatPrice()
const unp = company.unp.startsWith('[') ? '' : company.unp

const steps = computed(() => [
  {
    title: 'Соберите заказ',
    text: 'Поиск по названию, артикулу или штрихкоду. Для заявки по списку — прайс-лист раздела в Excel.',
  },
  {
    title: 'Счёт или КП за минуту',
    text: 'Из корзины — счёт на оплату в PDF, без регистрации, или коммерческое предложение для согласования.',
  },
  {
    title: 'Оплата и отгрузка',
    text: `Безналичный расчёт. Доставка по Беларуси, бесплатно от ${formatPrice(terms.freeDeliveryCompanyFrom, 'BYN')}, или самовывоз в Витебске.`,
  },
])
</script>

<template>
  <section class="b2b" aria-labelledby="b2b-title">
    <div class="b2b-main">
      <span class="eyebrow">Для организаций</span>
      <h2 id="b2b-title">Закупаете для организации?</h2>
      <ol class="steps">
        <li v-for="(step, index) in steps" :key="step.title" class="step">
          <span class="step-num" aria-hidden="true">{{ index + 1 }}</span>
          <div>
            <h3>{{ step.title }}</h3>
            <p>{{ step.text }}</p>
          </div>
        </li>
      </ol>
      <div class="actions">
        <UiButton to="/cart">Счёт и КП из корзины</UiButton>
        <UiButton
          variant="secondary"
          :href="priceListUrl()"
          rel="nofollow"
          download
          @click="reachGoal('price_list')"
        >
          Скачать прайс-лист (Excel)
        </UiButton>
        <UiButton variant="ghost" to="/organizaciyam">Договор поставки →</UiButton>
      </div>
    </div>

    <aside class="seller" aria-label="Реквизиты продавца">
      <span class="eyebrow">Продавец</span>
      <dl>
        <div>
          <dt>Организация</dt>
          <dd>{{ company.name }}</dd>
        </div>
        <div v-if="unp">
          <dt>УНП</dt>
          <dd class="mono">{{ unp }}</dd>
        </div>
        <div>
          <dt>Склад и самовывоз</dt>
          <dd>{{ company.storeAddress }}</dd>
        </div>
        <div>
          <dt>Отдел продаж</dt>
          <dd><a :href="company.phoneHref">{{ company.phone }}</a></dd>
        </div>
      </dl>
      <NuxtLink to="/organizaciyam" class="seller-link">Все реквизиты и условия →</NuxtLink>
    </aside>
  </section>
</template>

<style scoped>
.b2b {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: minmax(0, 1fr) 320px;
  padding: var(--space-8);
  border: 1px solid color-mix(in srgb, var(--brand) 18%, var(--border-subtle));
  border-radius: var(--radius-lg);
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--brand-soft) 90%, transparent), transparent 60%),
    var(--surface-card);
}

.b2b-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--space-5);
}

.eyebrow {
  color: var(--brand);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

h2 {
  margin: calc(var(--space-3) * -1) 0 0;
  color: var(--text-strong);
  font-size: var(--text-2xl);
  line-height: 1.2;
  text-wrap: balance;
}

.steps {
  display: grid;
  margin: 0;
  padding: 0;
  gap: var(--space-4);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
}

.step {
  display: flex;
  gap: var(--space-3);
}

.step-num {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: var(--radius-full);
  background: var(--brand);
  color: #fff;
  font-weight: 800;
  place-items: center;
}

.step h3 {
  margin: 4px 0 var(--space-1);
  color: var(--text-strong);
  font-size: var(--text-md, 15px);
}

.step p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}

.seller {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.seller dl {
  display: grid;
  margin: 0;
  gap: var(--space-3);
}

.seller dt {
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.seller dd {
  margin: 2px 0 0;
  color: var(--text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
}

.mono {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.seller-link {
  margin-top: auto;
  color: var(--text-link);
  font-size: var(--text-sm);
  font-weight: 600;
}

@media (max-width: 1024px) {
  .b2b {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .b2b {
    padding: var(--space-5);
  }

  .steps {
    grid-template-columns: minmax(0, 1fr);
  }

  h2 {
    font-size: var(--text-xl);
  }
}
</style>
