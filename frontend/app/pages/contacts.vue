<script setup lang="ts">
const description =
  'Контакты интернет-магазина Gost.by: телефон, e-mail, адрес магазина и реквизиты продавца.'

usePageSeo({ title: 'Контакты', description, path: '/contacts' })
</script>

<template>
  <section class="legal-page">
    <h1>Контакты</h1>

    <p>
      Звоните или пишите — поможем подобрать инструмент, уточним наличие и
      сроки доставки.
    </p>

    <StorefrontCompanyRequisites variant="contacts" />

    <h2>Реквизиты продавца</h2>
    <StorefrontCompanyRequisites variant="legal" />

    <p class="legal-note">
      Условия покупки — в <NuxtLink to="/usloviya">условиях продажи</NuxtLink>,
      порядок работы с данными — в
      <NuxtLink to="/privacy">политике обработки персональных данных</NuxtLink>.
    </p>
  </section>
</template>

