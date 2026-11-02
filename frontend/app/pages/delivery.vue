<script setup lang="ts">
import { company } from '~/data/company'

const { terms } = useOrderTerms()
const { formatPrice } = useFormatPrice()

const description =
  'Оплата и доставка в Gost.by: самовывоз в Витебске бесплатно, курьер, почта; организациям доставка бесплатно от 300 BYN. Оплата наличными, картой или по счёту.'

usePageSeo({ title: 'Оплата и доставка', description, path: '/delivery' })
</script>

<template>
  <section class="legal-page">
    <h1>Оплата и доставка</h1>

    <h2>Минимальная сумма заказа</h2>
    <ul>
      <li>
        <strong>Для физических лиц</strong> — от {{ formatPrice(terms.minIndividual, 'BYN') }}.
      </li>
      <li>
        <strong>Для организаций</strong> при оплате по безналичному расчёту — от
        {{ formatPrice(terms.minCompany, 'BYN') }}.
      </li>
    </ul>

    <h2>Способы получения заказа</h2>
    <ul>
      <li>
        <strong>Самовывоз — бесплатно.</strong>
        Адрес: {{ company.storeAddress }}. После подтверждения заказа мы
        сообщим, когда товар будет готов к выдаче.
      </li>
      <li>
        <strong>Курьерская доставка — {{ formatPrice(terms.courier, 'BYN') }}.</strong>
        Срок и время доставки согласуем по телефону при подтверждении заказа.
      </li>
      <li>
        <strong>Почта — {{ formatPrice(terms.post, 'BYN') }}.</strong>
        Отправка по Беларуси.
      </li>
      <li>
        <strong>Организациям — бесплатно</strong> курьером или почтой при заказе от
        {{ formatPrice(terms.freeDeliveryCompanyFrom, 'BYN') }}.
      </li>
    </ul>

    <h2>Способы оплаты</h2>
    <ul>
      <li><strong>Наличными</strong> — при получении заказа.</li>
      <li><strong>Банковской картой</strong> — при получении заказа.</li>
      <li>
        <strong>По счёту</strong> — для юридических лиц и индивидуальных
        предпринимателей. В корзине нажмите «Получить счёт на организацию» —
        регистрация не нужна, счёт придёт на e-mail. Подробнее — на странице
        <NuxtLink to="/organizaciyam">«Для организаций»</NuxtLink>.
      </li>
    </ul>

    <h2>Как проходит заказ</h2>
    <ul>
      <li>
        Вы оформляете заказ на сайте. Для этого нужен аккаунт — регистрация
        занимает минуту, а корзина при входе сохраняется.
      </li>
      <li>Мы перезваниваем, подтверждаем состав, цену и способ получения.</li>
      <li>Вы получаете товар выбранным способом и оплачиваете при получении.</li>
    </ul>

    <h2>Возврат и обмен</h2>
    <p>
      Возврат и обмен товара осуществляются в соответствии с Законом
      Республики Беларусь «О защите прав потребителей»: товар надлежащего
      качества можно вернуть или обменять в течение 14 дней, товар с
      недостатками — в порядке, установленном законом. Подробнее — на странице
      <NuxtLink to="/garantiya">«Гарантия и сервис»</NuxtLink> и в
      <NuxtLink to="/usloviya">условиях продажи</NuxtLink>.
    </p>

    <h2>Остались вопросы?</h2>
    <p>
      Позвоните <a :href="company.phoneHref">{{ company.phone }}</a> или
      напишите на <a :href="company.emailHref">{{ company.email }}</a> —
      поможем подобрать товар и оформить доставку.
    </p>
  </section>
</template>

