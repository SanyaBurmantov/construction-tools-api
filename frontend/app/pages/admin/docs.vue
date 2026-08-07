<script setup lang="ts">
definePageMeta({ layout: 'admin' })

/**
 * Operator-facing documentation. Deliberately plain data rather than prose in
 * the template: adding a supplier means adding one object here, and the page
 * stays the single place an operator looks up "why did this product not import".
 */

type Field = { label: string, value: string }
type Gotcha = { title: string, text: string }

type SourceDoc = {
  code: string
  name: string
  site: string
  role: string
  discovery: string
  productUrl: string
  fields: Field[]
  filter: string
  gotchas: Gotcha[]
}

const sources: SourceDoc[] = [
  {
    code: 'th-tools',
    name: 'TH-Tools',
    site: 'th-tool.by',
    role: 'Действующий поставщик. Основной источник каталога, ~39 000 товаров.',
    discovery:
      'Есть sitemap.xml (индекс из четырёх файлов). «Загрузить sitemap» складывает '
      + 'в очередь только ссылки на товары: адреса вида /category/… и статические '
      + 'страницы отсеиваются ещё до HTTP-запроса, иначе каждая из ~710 категорий '
      + 'стоила бы одной загрузки впустую. Дополнительно работает очередь категорий: '
      + 'обход страниц категории с пагинацией находит товары, которых в sitemap ещё нет.',
    productUrl: 'https://th-tool.by/<слаг-товара>/ — один сегмент пути',
    fields: [
      { label: 'Название, описание', value: 'h1 и описание карточки' },
      { label: 'Артикул', value: 'таблица характеристик' },
      { label: 'Штрихкод', value: 'строка «Штрихкод» в характеристиках' },
      { label: 'Наличие', value: '[itemprop="availability"]' },
      { label: 'Фото', value: 'галерея, три размера (.750x0 / .970 / .0x600) — дедуплицируются' },
      { label: 'Категория', value: 'хлебные крошки' },
    ],
    filter:
      'Поставщик кроме инструмента возит автоаксессуары, велотехнику, товары для '
      + 'дачи и косметику — они отсекаются EXCLUDE-регуляркой. Специально оставлены '
      + '«Аксессуары / Измерительные приборы» и «Аксессуары / Спецодежда, защита»: '
      + 'там лежат сварочные маски и СИЗ.',
    gotchas: [
      {
        title: 'Штрихкод трогать нельзя',
        text: 'Это единственный сигнал кроме «бренд + артикул», по которому товар '
          + 'автоматически склеивается с предложением другого поставщика. Уберёте — '
          + 'получите дубли карточек вместо одной с двумя офферами.',
      },
      {
        title: 'Регулярки категорий покрыты тестами',
        text: 'Опечатка в EXCLUDE молча опустошает каталог, поэтому правила '
          + 'проверяются юнит-тестами. Если правите их в админке — сверьтесь с '
          + 'превью товара перед тем, как запускать полный прогон.',
      },
    ],
  },
  {
    code: 'tools-by',
    name: 'Tools.by',
    site: 'tools.by',
    role: 'Действующий поставщик. Выгрузка каталога с ними согласована.',
    discovery:
      'Sitemap у сайта нет вообще. «Загрузить sitemap» для этого источника — это '
      + 'обход каталога: /catalog → /catalog/<id>/<id> → ссылки на товары. Он же '
      + 'единственный способ находить новинки, поэтому запускается ежедневно. '
      + 'Глубина ограничена настройкой «Страниц за обход».',
    productUrl: 'https://tools.by/product/<числовой-id>',
    fields: [
      { label: 'Название', value: 'h1 без вложенного уточнения в скобках' },
      { label: 'Артикул', value: '#product_artikul' },
      { label: 'Штрихкод', value: 'строка «Штрихкод» в характеристиках' },
      { label: 'Бренд, наличие', value: 'JSON-LD' },
      { label: 'Цена', value: 'блок .js-markup-price этого товара — см. ниже' },
      { label: 'Фото', value: 'content.tools.by, берётся вариант 1200×900' },
      { label: 'Категория', value: 'хлебные крошки без последней (это фильтр по бренду)' },
    ],
    filter:
      'Сам по себе магазин инструмента, поэтому INCLUDE пустой. EXCLUDE убирает '
      + 'хозтовары, посуду, текстиль, канцелярию и зоотовары.',
    gotchas: [
      {
        title: 'На странице товара живут чужие цены',
        text: 'Карточка встраивает карусели рекомендаций, у каждой свой data-price. '
          + 'Цена берётся строго из блока, чей data-product-id совпадает с id из h1. '
          + '«Первая цена на странице» сработает сегодня и подставит цену соседнего '
          + 'товара после ближайшей перевёрстки.',
      },
      {
        title: 'JSON-LD врёт про цену',
        text: 'Магазин публикует в разметке "price": "0.00". Оттуда берутся только '
          + 'бренд и наличие, цена — никогда.',
      },
      {
        title: 'robots.txt закрыт полностью',
        text: 'Disallow: / для всех, включая поисковики. Это защита от конкурентов, '
          + 'с поставщиком выгрузка согласована — но темп запросов держим вежливым.',
      },
    ],
  },
  {
    code: 'dukon',
    name: 'Dukon',
    site: 'dukon.by',
    role: 'Действующий поставщик.',
    discovery:
      'Комбинированно: sitemap-iblock-7.xml плюс обход приоритетных разделов '
      + 'каталога с пагинацией. Раз в месяц — полная ревалидация: вся очередь '
      + 'возвращается в PENDING и перечитывается заново.',
    productUrl: 'https://dukon.by/catalog/<раздел>/<товар>/',
    fields: [
      { label: 'Название, цена, фото', value: 'карточка товара' },
      { label: 'Категория', value: 'хлебные крошки' },
    ],
    filter: 'Фильтр по категориям по умолчанию не задан — берётся весь каталог.',
    gotchas: [
      {
        title: 'Обход тяжелее остальных',
        text: 'Разделов много, поэтому потолок страниц за обход по умолчанию 5000, '
          + 'а пауза между запросами больше, чем у других источников.',
      },
    ],
  },
  {
    code: '7745',
    name: '7745.by',
    site: '7745.by',
    role: 'НЕ поставщик. Это пример сайта от заказчика, оставлен как эталонная '
      + 'реализация парсера — по нему пишутся новые. Крон выключен, и так и должно быть.',
    discovery: 'sitemap.xml. Запускать имеет смысл только для проверки кода.',
    productUrl: 'https://7745.by/…',
    fields: [{ label: '—', value: 'структура та же, что у остальных источников' }],
    filter: 'Заданы и INCLUDE, и EXCLUDE — как демонстрация обоих режимов.',
    gotchas: [
      {
        title: 'Не включайте крон',
        text: 'Товары этого сайта не должны попадать на витрину. Источник держится '
          + 'в коде только как образец для новых парсеров.',
      },
    ],
  },
]

const pipeline = [
  { step: '1. Очередь', text: 'URL товаров складываются в очередь со статусом PENDING — из sitemap или обходом каталога.' },
  { step: '2. Разбор', text: 'Крон раз в 30 минут берёт из очереди пачку, качает страницы и разбирает их.' },
  { step: '3. Сохранение', text: 'Пишутся две записи: карточка каталога (Product) и снимок предложения поставщика (SourceProduct).' },
  { step: '4. Склейка', text: 'По штрихкоду или «бренд + артикул» предложения разных поставщиков сходятся в одну карточку.' },
  { step: '5. Цена', text: 'Закупочная цена — от самого дешёвого предложения в наличии. Витринная считается из неё по правилам наценки.' },
]

const reliability = [
  { title: 'Повторы при сбоях', text: 'Таймаут, 502 или 429 от поставщика — запрос повторяется с нарастающей паузой, уважая заголовок Retry-After. На 404 повторов нет: он постоянный.' },
  { title: 'Товар пропал у поставщика', text: '404 означает, что предложение снято. Цена и наличие у этого поставщика обнуляются, товар переоценивается по остальным. Если предложений не осталось — карточка скрывается с витрины (архивные и скрытые вручную не трогаем).' },
  { title: 'Очередь чинит себя сама', text: 'Каждые полчаса упавшие URL старше часа возвращаются в очередь — до трёх попыток. После этого нужен разработчик, и такие строки видно по фильтру «Проблемные».' },
  { title: 'Слежение за долей ошибок', text: 'Прогон, где упало больше половины URL, помечается ошибкой, даже если он завершился. Это ловит смену вёрстки у поставщика — раньше крон бодро работал, а каталог не наполнялся.' },
  { title: 'Оповещение в Telegram', text: 'О поломке приходит сообщение — один раз на поломку, а не каждые 15 минут. Работает, если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.' },
]

const statuses = [
  { status: 'PENDING', tone: 'warning' as const, text: 'В очереди, ещё не обрабатывался.' },
  { status: 'DONE', tone: 'success' as const, text: 'Разобран и сохранён.' },
  { status: 'SKIPPED', tone: 'neutral' as const, text: 'Сознательно пропущен: не карточка товара, либо категория отключена или отсеяна фильтром. В лог ошибок не попадает — это не поломка.' },
  { status: 'FAILED', tone: 'danger' as const, text: 'Ошибка загрузки или разбора. Причина — в логе ошибок внизу страницы «Парсинг».' },
]

const troubleshooting = [
  {
    symptom: 'Очередь не убывает',
    causes: 'Выключен крон (общий или у источника); слишком маленькая пачка; каждый прогон падает.',
    fix: 'Проверьте баннер вверху страницы «Парсинг», колонку «Разбор очереди» и историю запусков.',
  },
  {
    symptom: 'Много SKIPPED',
    causes: 'Это норма: сработал фильтр категорий или категория выключена вручную.',
    fix: 'Откройте очередь с фильтром «Пропущено» и посмотрите причину в строке.',
  },
  {
    symptom: 'Много FAILED',
    causes: 'Поставщик сменил вёрстку, отдаёт ошибки или режет темп запросов.',
    fix: 'Лог ошибок внизу страницы «Парсинг». Если причина в вёрстке — нужна правка парсера.',
  },
  {
    symptom: 'Очередь DONE, а товаров меньше',
    causes: 'Раньше товары с одинаковыми названиями затирали друг друга. Сейчас каждому новому товару выдаётся свой адрес (-2, -3 в конце).',
    fix: 'Старые схлопнутые товары так и остались слипшимися — их видно в «Дублях». Полный перепарсинг создаст недостающие.',
  },
  {
    symptom: 'Товары без цены на витрине',
    causes: 'Не заведено ни одного правила наценки, либо цена ушла на ручную проверку из-за скачка.',
    fix: 'Раздел «Цены»: правила и очередь проверки.',
  },
]

useHead({ title: 'Документация | Админка', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <div class="admin-docs">
    <header class="head">
      <div>
        <h1>Документация</h1>
        <p>Как устроен парсинг и что делать, когда он ведёт себя не так, как ожидалось.</p>
      </div>
    </header>

    <UiCard>
      <template #header>
        <div class="card-head">
          <h2>Как это работает целиком</h2>
          <p>Один и тот же конвейер для всех поставщиков.</p>
        </div>
      </template>

      <ol class="pipeline">
        <li v-for="item in pipeline" :key="item.step">
          <strong>{{ item.step }}</strong>
          <span>{{ item.text }}</span>
        </li>
      </ol>
    </UiCard>

    <UiCard>
      <template #header>
        <div class="card-head">
          <h2>Где что настраивается</h2>
          <p>Все ручки парсинга живут в админке — переменные окружения трогать не нужно.</p>
        </div>
      </template>

      <p class="lead">
        Значение, сохранённое на странице «Парсинг», перекрывает переменную окружения,
        а она — значение по умолчанию в коде. Поэтому после первого сохранения
        настройка меняется только из админки, и передеплой для этого не требуется.
      </p>

      <dl class="settings">
        <div><dt>Общий выключатель</dt><dd>Останавливает весь парсинг разом.</dd></div>
        <div><dt>Крон источника</dt><dd>Источник работает, только если включены оба выключателя — общий и его собственный.</dd></div>
        <div><dt>Пачка за запуск</dt><dd>Сколько URL берётся за один прогон. Прогон раз в 30 минут, то есть за сутки это «пачка × 48».</dd></div>
        <div><dt>Пауза между запросами</dt><dd>Вежливость к поставщику. Уменьшать без нужды не стоит.</dd></div>
        <div><dt>Страниц за обход</dt><dd>Потолок для обхода каталога. Если счётчик упёрся в него ровно — каталог обошёлся не весь.</dd></div>
        <div><dt>Фильтр категорий</dt><dd>INCLUDE (пусто = берём всё) и EXCLUDE по цепочке хлебных крошек. Некорректная регулярка не сохранится.</dd></div>
        <div><dt>Переключатели категорий</dt><dd>Точечное отключение ветки целиком, вместе с подкатегориями.</dd></div>
      </dl>
    </UiCard>

    <UiCard>
      <template #header>
        <div class="card-head">
          <h2>Что происходит автоматически</h2>
          <p>Механизмы надёжности, которые работают без участия человека.</p>
        </div>
      </template>

      <div v-for="item in reliability" :key="item.title" class="gotcha">
        <strong>{{ item.title }}</strong>
        <p>{{ item.text }}</p>
      </div>
    </UiCard>

    <UiCard>
      <template #header>
        <div class="card-head">
          <h2>Статусы в очереди</h2>
        </div>
      </template>

      <dl class="statuses">
        <div v-for="item in statuses" :key="item.status">
          <dt><UiBadge :tone="item.tone" size="sm">{{ item.status }}</UiBadge></dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
    </UiCard>

    <UiCard v-for="source in sources" :key="source.code" :padded="false">
      <template #header>
        <div class="card-head">
          <h2>{{ source.name }}</h2>
          <p>{{ source.site }} · код источника <code>{{ source.code }}</code></p>
        </div>
      </template>

      <div class="source pad">
        <p class="lead">{{ source.role }}</p>

        <section>
          <h3>Откуда берутся ссылки</h3>
          <p>{{ source.discovery }}</p>
          <p class="muted">Адрес карточки: <code>{{ source.productUrl }}</code></p>
        </section>

        <section>
          <h3>Что снимается со страницы</h3>
          <dl class="fields">
            <div v-for="field in source.fields" :key="field.label">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Что не берём</h3>
          <p>{{ source.filter }}</p>
        </section>

        <section v-if="source.gotchas.length">
          <h3>Особенности, о которые легко споткнуться</h3>
          <div v-for="gotcha in source.gotchas" :key="gotcha.title" class="gotcha">
            <strong>{{ gotcha.title }}</strong>
            <p>{{ gotcha.text }}</p>
          </div>
        </section>
      </div>
    </UiCard>

    <UiCard :padded="false">
      <template #header>
        <div class="card-head">
          <h2>Если что-то пошло не так</h2>
        </div>
      </template>

      <UiTable
        :columns="[
          { key: 'symptom', label: 'Симптом', width: '220px' },
          { key: 'causes', label: 'Обычные причины' },
          { key: 'fix', label: 'Куда смотреть', width: '300px' }
        ]"
        :rows="troubleshooting"
        empty-text=""
      />
    </UiCard>
  </div>
</template>

<style scoped>
.admin-docs {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.head h1 {
  margin-bottom: var(--space-1);
  font-size: var(--text-2xl);
  color: var(--text-strong);
}

.head p,
.card-head p {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.card-head h2 {
  font-size: var(--text-lg);
  color: var(--text-strong);
}

.pad {
  padding: var(--space-4);
}

.lead {
  margin-bottom: var(--space-3);
  line-height: 1.6;
}

.muted {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

code {
  padding: 1px 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--surface-muted);
  font-family: var(--font-mono, monospace);
  font-size: 0.9em;
}

.pipeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
}

.pipeline li {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
  line-height: 1.5;
}

.pipeline li:last-child {
  border-bottom: 0;
}

.pipeline strong {
  min-width: 130px;
  color: var(--text-strong);
}

.settings,
.statuses,
.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.settings > div,
.statuses > div,
.fields > div {
  display: grid;
  grid-template-columns: 230px 1fr;
  gap: var(--space-3);
  align-items: baseline;
  line-height: 1.5;
}

.settings dt,
.fields dt {
  color: var(--text-strong);
  font-weight: 600;
}

.source section {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
  margin-top: var(--space-4);
}

.source h3 {
  margin-bottom: var(--space-2);
  font-size: var(--text-base);
  color: var(--text-strong);
}

.source p {
  line-height: 1.6;
}

.gotcha {
  padding: var(--space-3);
  border-left: 3px solid var(--warning);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  margin-bottom: var(--space-2);
}

.gotcha strong {
  display: block;
  margin-bottom: 2px;
  color: var(--text-strong);
}

@media (max-width: 720px) {
  .settings > div,
  .statuses > div,
  .fields > div {
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }

  .pipeline li {
    flex-direction: column;
    gap: var(--space-1);
  }
}
</style>
