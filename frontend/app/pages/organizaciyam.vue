<script setup lang="ts">
import { company } from '~/data/company'
import type { SellerInfo } from '~/composables/useB2b'

/**
 * The page for organisations — what a purchaser needs to decide to buy here:
 * how paying by invoice works, what documents come with it, the shop's
 * requisites, the price list, and a way to ask for a supply contract.
 */
const description
  = 'Снабжение организаций инструментом, оборудованием и расходниками: 50 000+ позиций, счёт на оплату сразу на сайте, '
    + 'оплата по безналичному расчёту, договор поставки, доставка по Беларуси.'

usePageSeo({ title: 'Для организаций', description, path: '/organizaciyam' })

const { apiBase } = useSite()
const { priceListUrl } = useB2b()

// Requisites come from the API (edited in /admin/settings), so the page and
// the invoices never disagree. A failure only hides the bank details.
const { data: seller } = await useAsyncData('b2b-seller-page', () =>
  $fetch<SellerInfo>(`${apiBase}/seller`).catch(() => null)
)

/* ---- Contact form: a lead for a manager ---- */
const toast = useAppToast()
const { user, authFetch, errorMessage } = useAuth()
const form = reactive({
  companyName: '',
  taxId: '',
  contactName: '',
  phone: '',
  email: '',
  message: 'Хотим работать по договору поставки. Пришлите, пожалуйста, проект договора.',
  website: '',
})
const consent = ref(false)
const sending = ref(false)
const sent = ref(false)
const formError = ref('')

onMounted(() => {
  const account = user.value
  if (!account) return
  form.companyName ||= account.companyName || ''
  form.taxId ||= account.taxId || ''
  form.contactName ||= account.name || ''
  form.phone ||= account.phone || ''
  form.email ||= account.email || ''
})

async function send() {
  formError.value = ''
  if (form.contactName.trim().length < 2) formError.value = 'Укажите контактное лицо'
  else if (form.phone.trim().length < 5) formError.value = 'Укажите телефон'
  else if (form.taxId.trim() && !isValidUnp(form.taxId)) formError.value = 'Проверьте УНП'
  else if (!consent.value) formError.value = 'Дайте согласие на обработку персональных данных'
  if (formError.value) return
  sending.value = true
  try {
    await authFetch('/leads', {
      method: 'POST',
      body: {
        companyName: form.companyName.trim() || undefined,
        taxId: form.taxId.trim() || undefined,
        contactName: form.contactName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        message: form.message.trim() || 'Запрос со страницы «Для организаций»',
        website: form.website || undefined,
        attribution: getAttribution(),
      },
    })
    sent.value = true
    toast.success('Заявка отправлена — менеджер свяжется с вами')
  } catch (error) {
    formError.value = errorMessage(error, 'Не удалось отправить. Позвоните нам — ответим сразу.')
  } finally {
    sending.value = false
  }
}

const steps = [
  { title: 'Соберите корзину', text: 'Поиск по названию, артикулу и штрихкоду. Сохраните корзину как список закупок — в следующий раз она соберётся одной кнопкой.' },
  { title: 'Получите счёт', text: 'Кнопка «Получить счёт на организацию» в корзине — без регистрации. Счёт в PDF приходит на e-mail сразу; цены в нём зафиксированы на несколько дней.' },
  { title: 'Оплатите', text: 'Менеджер подтверждает наличие и срок. Оплата по безналичному расчёту с расчётного счёта организации или ИП.' },
  { title: 'Получите товар с документами', text: 'Самовывоз в Витебске или доставка по Беларуси. Товарная накладная — при отгрузке.' },
]

const tools = [
  { title: 'Прайс-лист в Excel', text: 'Весь каталог или раздел — с артикулами, ценами и наличием. Ссылка «Прайс-лист» есть на странице каждого раздела.' },
  { title: 'Коммерческое предложение', text: 'КП в PDF из корзины одной кнопкой — для согласования внутри компании.' },
  { title: 'Списки закупок и история', text: 'В кабинете: регулярные закупки, история заказов, счета в PDF, реквизиты сохраняются для следующих счетов.' },
  { title: 'Аналоги и сроки', text: 'Нет нужной позиции — кнопка «Подобрать аналог» на карточке товара, менеджер предложит замену.' },
]
</script>

<template>
  <div class="b2b-page">
    <UiBreadcrumbs :items="[{ label: 'Главная', to: '/' }, { label: 'Для организаций' }]" />

    <header class="hero">
      <h1>Снабжение организаций инструментом и расходниками</h1>
      <p class="hero-lead">
        50 000+ позиций от проверенных поставщиков с ежедневным обновлением цен.
        Счёт на оплату — сразу на сайте, оплата по безналичному расчёту, работа по договору поставки,
        доставка по всей Беларуси и самовывоз в Витебске.
      </p>
      <div class="hero-actions">
        <UiButton to="/catalog" size="lg">Перейти в каталог</UiButton>
        <UiButton :href="priceListUrl()" variant="secondary" size="lg" rel="nofollow" download>
          Скачать прайс-лист (Excel)
        </UiButton>
      </div>
    </header>

    <section>
      <h2>Как купить по безналичному расчёту</h2>
      <ol class="steps">
        <li v-for="(step, i) in steps" :key="step.title">
          <span class="step-number">{{ i + 1 }}</span>
          <div>
            <h3>{{ step.title }}</h3>
            <p>{{ step.text }}</p>
          </div>
        </li>
      </ol>
    </section>

    <section>
      <h2>Удобно для закупщиков</h2>
      <ul class="tools">
        <li v-for="tool in tools" :key="tool.title">
          <h3>{{ tool.title }}</h3>
          <p>{{ tool.text }}</p>
        </li>
      </ul>
    </section>

    <section class="two-col">
      <div class="card">
        <h2>Договор поставки</h2>
        <p>
          Для регулярных закупок работаем по договору поставки. Оставьте заявку —
          пришлём проект договора и ответим на вопросы по ассортименту, срокам и
          документам. Или позвоните: <a :href="company.phoneHref">{{ company.phone }}</a>.
        </p>

        <UiAlert v-if="sent" tone="success">
          Заявка отправлена. Менеджер свяжется с вами в рабочее время.
        </UiAlert>
        <form v-else class="lead-form" novalidate @submit.prevent="send">
          <UiAlert v-if="formError" tone="danger">{{ formError }}</UiAlert>
          <div class="grid">
            <UiField label="Организация" for="b2b-company">
              <UiInput id="b2b-company" v-model="form.companyName" autocomplete="organization" />
            </UiField>
            <UiField label="УНП" for="b2b-unp">
              <UiInput id="b2b-unp" v-model="form.taxId" inputmode="numeric" />
            </UiField>
            <UiField label="Контактное лицо" required for="b2b-name">
              <UiInput id="b2b-name" v-model="form.contactName" autocomplete="name" />
            </UiField>
            <UiField label="Телефон" required for="b2b-phone">
              <UiInput id="b2b-phone" v-model="form.phone" type="tel" autocomplete="tel" />
            </UiField>
          </div>
          <UiField label="E-mail" for="b2b-email">
            <UiInput id="b2b-email" v-model="form.email" type="email" autocomplete="email" />
          </UiField>
          <UiField label="Сообщение" for="b2b-message">
            <UiTextarea id="b2b-message" v-model="form.message" :rows="3" :maxlength="2000" />
          </UiField>
          <input v-model="form.website" class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
          <UiCheckbox v-model="consent">
            Даю согласие на обработку персональных данных в соответствии с
            <NuxtLink to="/privacy" target="_blank">Политикой</NuxtLink>
          </UiCheckbox>
          <UiButton type="submit" :loading="sending">Отправить заявку</UiButton>
        </form>
      </div>

      <div class="card">
        <h2>Реквизиты</h2>
        <dl class="requisites">
          <div><dt>Организация</dt><dd>{{ seller?.name || company.name }}</dd></div>
          <div><dt>УНП</dt><dd>{{ seller?.unp || company.unp }}</dd></div>
          <div><dt>Юридический адрес</dt><dd>{{ seller?.legalAddress || company.legalAddress }}</dd></div>
          <div v-if="seller?.bankAccount"><dt>Расчётный счёт</dt><dd>{{ seller.bankAccount }}</dd></div>
          <div v-if="seller?.bankName"><dt>Банк</dt><dd>{{ seller.bankName }}</dd></div>
          <div v-if="seller?.bankBic"><dt>БИК</dt><dd>{{ seller.bankBic }}</dd></div>
          <div><dt>Склад и самовывоз</dt><dd>{{ company.storeAddress }}</dd></div>
          <div><dt>Телефон</dt><dd><a :href="company.phoneHref">{{ company.phone }}</a></dd></div>
          <div><dt>E-mail</dt><dd><a :href="company.emailHref">{{ company.email }}</a></dd></div>
        </dl>
      </div>
    </section>
  </div>
</template>

<style scoped>
.b2b-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.hero {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  background: var(--surface-sunken);
}

.hero h1 {
  margin: 0;
  font-size: var(--text-2xl);
}

.hero-lead {
  max-width: 75ch;
  margin: 0;
  color: var(--text-default);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

h2 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-xl);
}

h3 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-md);
}

p {
  margin: 0;
}

.steps,
.tools {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: 0;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  list-style: none;
}

.steps li,
.tools li {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.tools li {
  flex-direction: column;
}

.steps p,
.tools p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.step-number {
  display: grid;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--text-inverse);
  font-weight: 700;
  place-items: center;
}

.two-col {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}

.card h2 {
  margin: 0;
}

.lead-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.requisites {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
}

.requisites dt {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.requisites dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.hp {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
}

@media (max-width: 900px) {
  .two-col {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .hero {
    padding: var(--space-4);
  }
}
</style>
