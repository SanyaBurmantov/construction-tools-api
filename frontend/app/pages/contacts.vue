<script setup lang="ts">
import { company } from '~/data/company'

const config = useRuntimeConfig()
const siteUrl = String(config.public.siteUrl).replace(/\/$/, '')
const description =
  'Контакты интернет-магазина Мультитул: телефон, e-mail, адрес магазина и реквизиты продавца.'

useSeoMeta({
  title: 'Контакты | Мультитул',
  description,
  ogTitle: 'Контакты | Мультитул',
  ogDescription: description
})

useHead({
  link: [{ rel: 'canonical', href: `${siteUrl}/contacts` }]
})
</script>

<template>
  <section class="legal-page">
    <h1>Контакты</h1>

    <p>
      Звоните или пишите — поможем подобрать инструмент, уточним наличие и
      сроки доставки.
    </p>

    <dl class="requisites">
      <div>
        <dt>Телефон</dt>
        <dd><a :href="company.phoneHref">{{ company.phone }}</a></dd>
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

    <h2>Реквизиты продавца</h2>
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
        <dt>Регистрация в Торговом реестре</dt>
        <dd>{{ company.tradeRegistry }}</dd>
      </div>
      <div>
        <dt>Юридический адрес</dt>
        <dd>{{ company.legalAddress }}</dd>
      </div>
    </dl>

    <p style="margin-top: 16px;">
      Условия покупки — в <NuxtLink to="/oferta/">публичной оферте</NuxtLink>,
      порядок работы с данными — в
      <NuxtLink to="/privacy/">политике обработки персональных данных</NuxtLink>.
    </p>
  </section>
</template>

<style scoped lang="scss">
@use '@/assets/scss/legal-page.scss' as *;
</style>
