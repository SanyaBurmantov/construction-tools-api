<script setup lang="ts">
import { company } from '~/data/company'

const config = useRuntimeConfig()
const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')
const description =
  'Мультитул — интернет-магазин инструмента, оборудования, крепежа и расходных материалов. Магазин и самовывоз в Витебске, доставка по Беларуси.'

useSeoMeta({
  title: 'О компании | Мультитул',
  description,
  ogTitle: 'О компании | Мультитул',
  ogDescription: description
})

useHead({
  link: [{ rel: 'canonical', href: `${siteUrl}/about` }]
})
</script>

<!--
  Только проверяемые факты. Годы на рынке, дилерские статусы и цифры, которых
  нет в company.ts или на /delivery, сюда не добавлять без подтверждения
  владельца.
-->
<template>
  <section class="legal-page">
    <h1>О компании</h1>

    <p>
      «Мультитул» — интернет-магазин {{ company.name }}. В каталоге более
      50&nbsp;тысяч товаров: инструмент, оборудование, крепёж и расходные
      материалы. Цены и наличие обновляются ежедневно.
    </p>

    <h2>Магазин и самовывоз</h2>
    <p>
      Магазин и пункт самовывоза находятся в Витебске:
      {{ company.storeAddress }}. Режим работы: {{ company.workingHours }}.
      Самовывоз бесплатный — после подтверждения заказа мы сообщим, когда
      товар будет готов к выдаче.
    </p>

    <h2>Доставка и оплата</h2>
    <ul>
      <li>доставка по Беларуси курьером и почтой;</li>
      <li>оплата наличными или банковской картой при получении;</li>
      <li>для юридических лиц и индивидуальных предпринимателей — оплата по счёту.</li>
    </ul>
    <p>
      Подробнее — на странице <NuxtLink to="/delivery">«Оплата и доставка»</NuxtLink>,
      порядок оформления и подтверждения заказа — в
      <NuxtLink to="/usloviya">условиях продажи</NuxtLink>, возврат и
      гарантия — на странице <NuxtLink to="/garantiya">«Гарантия и сервис»</NuxtLink>.
    </p>

    <h2>Контакты</h2>
    <dl class="requisites">
      <div>
        <dt>Телефон</dt>
        <dd><a :href="company.phoneHref">{{ company.phone }}</a></dd>
      </div>
      <div>
        <dt>Viber, Telegram</dt>
        <dd>
          {{ company.phone }} —
          <a :href="company.viberHref">Viber</a>,
          <a :href="company.telegramHref" target="_blank" rel="noopener">Telegram</a>
        </dd>
      </div>
      <div>
        <dt>E-mail</dt>
        <dd><a :href="company.emailHref">{{ company.email }}</a></dd>
      </div>
      <div>
        <dt>Адрес магазина (самовывоз)</dt>
        <dd>{{ company.storeAddress }}</dd>
      </div>
      <div>
        <dt>Режим работы</dt>
        <dd>{{ company.workingHours }}</dd>
      </div>
    </dl>

    <h2>Реквизиты</h2>
    <dl class="requisites">
      <div>
        <dt>Наименование</dt>
        <dd>{{ company.name }}</dd>
      </div>
      <div>
        <dt>УНП</dt>
        <dd>{{ company.unp }}</dd>
      </div>
      <div>
        <dt>Юридический адрес</dt>
        <dd>{{ company.legalAddress }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped lang="scss">
@use '@/assets/scss/legal-page.scss' as *;
</style>
