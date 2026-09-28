# Dukon.by Parsing Roadmap

## Цель

Подключить `https://dukon.by/` как поставщика товаров для интернет-магазина.

Нужно парсить:

- каталог и дерево категорий;
- товары из sitemap;
- название товара;
- цену;
- бренд/производителя;
- артикул;
- характеристики;
- описание;
- изображения;
- ссылку на источник;
- сохранять товары в текущую модель каталога как `DRAFT`, чтобы админ мог проверить и опубликовать.

## Статус

Текущий статус: первичная разведка сайта выполнена, базовый backend-парсер добавлен, но еще не протестирован на массовом прогоне и не вынесен в полноценный общий pipeline поставщиков.

## Что Уже Удалось

- Сайт доступен напрямую, если обойти системный proxy: `curl --noproxy "*"`.
- Через обычный proxy окружения сайт отдавал `502 CONNECT tunnel failed`.
- Сайт работает на Bitrix.
- `robots.txt` доступен: `https://dukon.by/robots.txt`.
- Основной sitemap: `https://dukon.by/sitemap.xml`.
- Sitemap указывает на каталог: `https://dukon.by/sitemap-iblock-7.xml`.
- `sitemap-iblock-7.xml` содержит много URL товаров вида `/catalog/.../product_slug/`.
- Robots для Yandex задает `Crawl-delay: 3`; для аккуратного парсинга стоит использовать задержку/низкую concurrency.
- Карточка товара содержит `h1` с названием.
- Хлебные крошки доступны через `.rsbreadcrumb [itemprop="name"]`.
- Цена доступна через `.price.gen`, пример: `384.82 руб.`.
- Характеристики доступны в `#properties .groupedprops.table .table__item`.
- Название характеристики: `.name`.
- Значение характеристики: `.val`.
- Артикул есть в характеристиках как `Артикул`.
- Производитель/бренд есть в характеристиках как `Производитель`.
- Описание можно брать из блоков вроде `#detailtext`, `.detailtext`, `.content.description`.
- На странице есть JSON-LD `Product`, оттуда можно брать главное изображение.
- Изображения лежат в `/upload/...`, часто есть webp-версии и resize_cache thumbnails.

## Что Уже Добавлено В Код

- Добавлена Prisma-модель `SitemapsDukon`.
- Добавлена миграция `20260430002000_add_dukon_sitemaps`.
- Добавлен сервис `backend/src/parser/sites/dukon.parser.ts`.
- `DukonParserService` умеет:
  - загружать `sitemap-iblock-7.xml`;
  - сохранять URL в очередь `SitemapsDukon`;
  - считать статистику очереди;
  - обрабатывать batch URL;
  - парсить одиночный URL товара;
  - создавать категории по breadcrumbs;
  - создавать бренд по `Производитель`;
  - сохранять характеристики;
  - сохранять картинки как внешние URL Dukon;
  - создавать новые товары как `DRAFT`.
- `DukonParserService` подключен в `AdminModule` и `ParserModule`.
- Admin API дополнен:
  - `GET /admin/queue/dukon`;
  - `POST /admin/queue/dukon/refresh-sitemaps`;
  - `POST /admin/queue/dukon/process`.
- Одиночный импорт через `POST /admin/source-products/import` теперь распознает `dukon.by` и вызывает `DukonParserService.parseProductUrl`.

## Найденные Проблемы И Риски

### Proxy

Проблема:

- В текущем окружении переменные `http_proxy`/`https_proxy` ведут к proxy, через который `dukon.by` отвечает `502 CONNECT tunnel failed`.

Что важно:

- Node `fetch` в backend может тоже использовать proxy в production/dev окружении, если будет настроен глобальный agent/proxy.
- Локально прямой доступ работает через `--noproxy "*"`, но это не решение для backend-кода.

Что нужно дополнить:

- Проверить, использует ли runtime backend proxy при `fetch`.
- Если использует, добавить возможность обходить proxy для доменов поставщиков или настроить `NO_PROXY=dukon.by,www.dukon.by`.
- Для production явно задокументировать env `NO_PROXY`.

### Robots And Rate Limits

Проблема:

- `robots.txt` содержит `Crawl-delay: 3` для Yandex.
- Массовый парсинг без задержек может быть агрессивным.

Что нужно дополнить:

- Добавить per-source настройки: concurrency, delayMs, user-agent.
- Для Dukon использовать concurrency `1-3` и задержку между запросами.
- Сейчас сервис использует concurrency `3`, но без явной задержки.

### Смешение Товаров И Категорий В Sitemap

Потенциальная проблема:

- Sitemap может содержать не только товары, но и разделы каталога.

Что нужно проверить:

- Прогнать несколько URL из sitemap и определить признаки карточки товара.
- Сейчас парсер ожидает `h1` и характеристики; если URL раздела попадет в очередь, парсер может ошибиться.

Что нужно дополнить:

- Перед сохранением проверять наличие карточки товара: `#properties`, `.price.gen`, JSON-LD Product или product wrapper.
- Для URL разделов либо пропускать, либо использовать для построения категорий.

### Категории

Проблема:

- Категории создаются по названиям breadcrumbs и slug из названия.
- Если у разных поставщиков есть категории с одинаковым названием, они сольются.

Что нужно решить:

- Нужна ли единая категория между поставщиками или source-specific mapping.
- Для MVP слияние может быть приемлемым, но позже нужен слой сопоставления категорий.

Что нужно дополнить:

- Добавить ручной mapping категорий поставщика в внутренние категории.
- Или добавить source category staging.

### Slug И Дубликаты

Проблема:

- Товар upsert происходит по slug, который генерируется из названия.
- У разных товаров может быть одинаковое/похожее название.

Риск:

- Один товар может перезаписать другой.

Что нужно дополнить:

- Использовать `SourceProduct` как первичную идентичность.
- Добавить уникальность `[sourceId, url]` или `[sourceId, externalId]`.
- В catalog product matching учитывать source URL, артикул, бренд, модель, normalized name.

### Описание

Проблема:

- В описании иногда есть технический мусор: `Подробная информация array(0) { }`.
- Сейчас добавлена чистка этого конкретного префикса, но могут быть другие артефакты.

Что нужно дополнить:

- Собрать 10-20 HTML fixtures и проверить описание на разных категориях.
- Добавить robust cleanup.

### Изображения

Проблема:

- Сейчас изображения сохраняются как внешние URL Dukon.
- В HTML много thumbnails, resize_cache, служебных и похожих товаров.

Что уже сделано:

- Парсер игнорирует `/resize_cache/`.
- Берет JSON-LD image и изображения из detail/product/card областей.
- Ограничивает список до 12 изображений.

Что нужно дополнить:

- Уточнить селекторы только галереи товара, чтобы не цеплять сертификаты/похожие товары.
- Позже скачать изображения в S3/R2 и сохранять собственные CDN URL.
- Добавить hash/dedupe изображений.

### Цена И Наличие

Проблема:

- Цена берется из `.price.gen`; на некоторых товарах цены может не быть.
- Наличие сейчас выставляется как `in_stock` по умолчанию.

Что нужно дополнить:

- Найти селекторы наличия/статуса.
- Если цена отсутствует, сохранять `priceValue = undefined/null`.
- Определять `stockStatus` по тексту кнопок/наличия: в наличии, под заказ, нет в наличии.

### SourceProduct

Проблема:

- При одиночном импорте source link создается в admin service, но массовый Dukon parser пока напрямую создает Product и не пишет полноценный `SourceProduct`.

Что нужно дополнить:

- Вынести общий import service для всех поставщиков.
- После парсинга Dukon сохранять raw supplier data в `SourceProduct`.
- Добавить unique constraint для source URL.

## Следующие Шаги

### Шаг 1: Применить Миграцию

Команда:

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
```

Нужно применить миграцию `20260430002000_add_dukon_sitemaps`.

### Шаг 2: Добавить Source В БД

Нужно убедиться, что в таблице `Source` есть Dukon:

```txt
name: Dukon
code: dukon
url: https://dukon.by
```

Можно добавить через seed/script/admin endpoint позже. Публичный `POST /sources` уже закрыт.

### Шаг 3: Проверить Одиночный Импорт

Проверить URL:

```txt
https://dukon.by/catalog/pod-emnoe-oborudovanie/domkraty/podkatnye-domkraty/domkrat_podkatnoy_3_tonn_120_450_mm_s_rezinovoy_nasadkoy_seryy_nordberg_n32030_g/
```

Ожидаемый результат:

- товар создается как `DRAFT`;
- категория строится из breadcrumbs;
- бренд `NORDBERG` создается/используется;
- артикул `N32030 G`;
- цена `384.82`;
- характеристики сохраняются;
- картинки сохраняются внешними URL Dukon.

### Шаг 4: Проверить Batch Queue

Через admin API:

```txt
POST /admin/queue/dukon/refresh-sitemaps
GET /admin/queue/dukon
POST /admin/queue/dukon/process
```

Ожидаемый результат:

- sitemap URL попадают в `SitemapsDukon`;
- обработанные URL получают `isVisited=true`;
- ошибки попадают в parser errors.

### Шаг 5: Добавить UI В Админку

В `frontend/app/pages/admin/parsing.vue` нужно добавить отдельный блок Dukon:

- статистика очереди Dukon;
- кнопка загрузить sitemap Dukon;
- кнопка обработать N товаров Dukon;
- возможно selector источника уже покрывает одиночный URL импорт.

### Шаг 6: Добавить Fixtures И Тесты

Сохранить 3-5 HTML fixtures разных товаров Dukon:

- товар с ценой;
- товар без цены;
- товар с несколькими изображениями;
- товар с другим набором характеристик;
- товар из другой ветки каталога.

Покрыть тестами:

- парсинг имени;
- breadcrumbs;
- price;
- specs;
- brand;
- images;
- description cleanup.

### Шаг 7: Улучшить Изображения

После стабилизации парсера:

- подключить object storage;
- скачивать картинки;
- грузить в R2/S3;
- сохранять собственные CDN URL;
- хранить `sourceUrl` отдельно.

## Критерии Готовности MVP-Парсинга Dukon

- Sitemap Dukon загружается в очередь.
- 100 случайных URL обрабатываются без критических ошибок.
- Не меньше 90% товаров получают название, категорию, бренд/производителя, артикул, цену или корректное отсутствие цены.
- Характеристики сохраняются в `ProductSpecification`.
- Новые товары создаются как `DRAFT`.
- Публичный каталог не показывает Dukon-товары до публикации админом.
- Ошибки парсинга видны в админке.
- Парсер соблюдает адекватную нагрузку на сайт поставщика.

## Журнал

### 2026-04-30

Успехи:

- Сайт изучен.
- Обнаружен proxy issue и рабочий обход прямым доступом.
- Найдены sitemap и robots.
- Найдены основные селекторы карточки товара.
- Добавлен начальный `DukonParserService`.
- Добавлена очередь `SitemapsDukon`.
- Добавлены admin endpoints для очереди Dukon.
- Backend build проходит.

Неудачи/проблемы:

- Встроенный `webfetch` и `curl` через proxy получали `502`.
- Нужна проверка, не будет ли backend fetch использовать proxy в runtime.
- Массовый прогон еще не выполнялся.
- UI для Dukon-очереди еще не добавлен.

Нужно дополнить:

- Применить миграцию.
- Добавить source `dukon` в БД.
- Проверить одиночный импорт через admin.
- Добавить UI для Dukon queue.
- Добавить fixtures/tests.
- Улучшить image selector и storage pipeline.

Позже в этот же день:

Успехи:

- Миграция `20260430002000_add_dukon_sitemaps` применена локально.
- Prisma Client сгенерирован после добавления `SitemapsDukon`.
- Source `Dukon` добавлен в БД:
  - `name: Dukon`
  - `code: dukon`
  - `url: https://dukon.by`
- Одиночный парсинг тестового URL прошел успешно.
- Проверенный товар создался как `DRAFT`.
- По тестовому товару получены:
  - цена `384.82`;
  - бренд `NORDBERG`;
  - категория `Подкатные гидравлические домкраты`;
  - источник `Dukon` в `SourceProduct`;
  - 12 изображений;
  - 10 характеристик.
- В админке товаров добавлен вывод источника парсинга.
- В preview товара добавлены ссылки на source URL.
- В админку парсинга добавлен блок Dukon queue.
- Dukon sitemap загружен в очередь: `286` URL.
- Первый массовый прогон показал, что batch больше не должен падать целиком от одного плохого URL.
- Добавлена обработка race condition при параллельном создании одинаковых характеристик.
- Ошибочные Dukon URL теперь помечаются обработанными, чтобы очередь не зацикливалась на 404/500.

Неудачи/проблемы:

- В sitemap Dukon есть битые URL: несколько товаров возвращают `404`.
- Один URL раздела/категории вернул `500`.
- Первый batch до фикса падал целиком на одном неуспешном URL.
- При concurrency `3` возник race condition на `Specification(categoryId, key)`.
- После исправлений batch обработал очередь дальше: стало `45 visited`, `241 queued`, `286 total`.

Нужно дополнить:

- Добавить отдельный статус для failed queue items вместо простого `isVisited=true`.
- Добавить счетчик ошибок/последнюю ошибку в `SitemapsDukon`.
- Научиться отличать product URL от category URL до парсинга.
- Добавить задержку между запросами Dukon, чтобы соблюдать более мягкий crawl profile.
- Добавить UI списка Dukon URL, а не только статистику очереди.
- Добавить fixtures/tests по уже проверенному товару.

Еще позже в этот же день:

Успехи:

- Добавлена миграция `20260430004000_add_dukon_queue_status`.
- `SitemapsDukon` теперь хранит:
  - `status`: `PENDING`, `DONE`, `FAILED`, `SKIPPED`;
  - `attempts`;
  - `lastError`;
  - `lastTriedAt`;
  - `visitedAt`.
- Добавлен admin API списка Dukon URL:
  - `GET /admin/queue/dukon/sitemaps`.
- Добавлен retry endpoint:
  - `POST /admin/queue/dukon/sitemaps/:id/retry`.
- Dukon parser теперь берет в обработку только `PENDING`.
- Успешный URL получает `DONE`.
- Ошибочный URL получает `FAILED`.
- Не-товарная страница получает `SKIPPED`.
- Добавлена проверка признаков product page.
- Добавлен мягкий delay между запросами Dukon: `3000 ms`.
- Concurrency Dukon снижен до `2` через admin process.
- В админку добавлен список Dukon URL с фильтрами `PENDING/DONE/FAILED/SKIPPED`, ошибками, attempts и кнопкой retry.
- Миграция применена локально.
- Smoke-test на 3 URL прошел: очередь изменилась с `241 pending / 45 done` на `238 pending / 48 done`.

Неудачи/проблемы:

- Старые URL, которые до миграции были помечены `isVisited=true`, миграция перевела в `DONE`, даже если часть из них ранее была 404/500. Для точной истории нужны отдельные failed поля до первого прогона.

Нужно дополнить:

- Сделать отдельную кнопку массового retry для `FAILED` и `SKIPPED`.
- Добавить UI списка только failed/skipped по умолчанию для контроля качества.
- Добавить persisted parser log в БД, текущий `ParserLogService` in-memory.
- Добавить tests/fixtures.

Следующее продолжение:

Успехи:

- Прочитаны `PROJECT_KNOWLEDGE.md` и `PROJECT_AUDIT_AND_IMPROVEMENT_PLAN.md`.
- Выявлено и исправлено расхождение knowledge base: Dukon уже подключен к single import и admin queue, хотя knowledge base описывал только th-tool.by.
- Добавлен bulk retry проблемных Dukon URL:
  - `POST /admin/queue/dukon/sitemaps/retry-problems`;
  - статусы `FAILED` и `SKIPPED` возвращаются в `PENDING`.
- В список Dukon URL добавлен фильтр `PROBLEM`, показывающий `FAILED` и `SKIPPED`.
- В админку парсинга добавлена кнопка `Повторить проблемные`.
- По умолчанию список Dukon URL в админке теперь открыт на проблемных URL для контроля качества.

Нужно дополнить:

- Добавить tests/fixtures.
- Продолжить вынос общего supplier import pipeline, чтобы парсеры не дублировали сохранение каталога.

Еще одно продолжение:

Успехи:

- Добавлена Prisma-модель `ParserError`.
- Добавлена миграция `20260430005000_add_parser_errors`.
- Миграция применена локально через `npx prisma migrate deploy`.
- `ParserLogService` теперь сохраняет ошибки парсинга в БД вместо in-memory массива.
- `GET /admin/queue/errors` продолжает отдавать последние 200 ошибок в прежнем формате.
- `DELETE /admin/queue/errors` теперь очищает persisted parser errors.
- `ThToolsParserService` и `DukonParserService` теперь ожидают запись ошибки в `ParserLogService`.
- Backend build проходит после `npx prisma generate`.

Нужно дополнить:

- Добавить tests/fixtures.
- Добавить parser run/session model, если понадобится группировать ошибки по конкретному массовому запуску.
- Продолжить общий supplier import pipeline и защиту от перезаписи ручных правок.

Следующее продолжение по production safety:

Успехи:

- Убран ignore для `backend/prisma/migrations`, чтобы миграции попадали в Git вместе со схемой.
- Git теперь видит все существующие Prisma migrations, включая `20260430005000_add_parser_errors`.
- Найдены публичные mutating/side-effect routes вне `/admin`.
- `POST /specifications` закрыт через `AdminGuard`.
- Legacy parser trigger routes закрыты через `AdminGuard`:
  - `GET /products-from-sitemap-initial`;
  - `GET /sitemap-initial`.

Нужно дополнить:

- Позже удалить legacy parser trigger routes полностью, если они больше не используются.
- Продолжить P0/P1 audit items: category delete pre-checks, SourceProduct unique constraint, parser fixtures/tests.

Продолжение по runtime safety:

Успехи:

- Проверено, что `backend/.nvmrc` и `frontend/.nvmrc` уже указывают `22.12.0`.
- Добавлен root `.nvmrc` с `22.12.0`, чтобы версия Node фиксировалась и из корня проекта.
- Knowledge/audit обновлены: category delete pre-checks уже реализованы, Node version pins уже есть.

Нужно дополнить:

- Убедиться, что CI/deploy реально использует Node `22.12.0+`.
- Продолжить SourceProduct unique constraint и parser fixtures/tests.

Продолжение по артикулу и SourceProduct identity:

Успехи:

- Зафиксировано требование: артикулы товаров важны и должны храниться отдельным полем.
- В `SourceProduct` добавлено отдельное поле `sku` для артикула поставщика.
- Добавлена миграция `20260430006000_add_source_product_source_url_unique`:
  - добавляет `SourceProduct.sku`;
  - удаляет дубли `SourceProduct` по `(sourceId, url)`, оставляя самый свежий;
  - добавляет unique index `[sourceId, url]`.
- Миграция применена локально через `npx prisma migrate deploy`.
- Dukon parser сохраняет артикул в `Product.sku` и `SourceProduct.sku`.
- Dukon parser теперь делает `upsert` `SourceProduct` по `[sourceId, url]`.
- `admin import` больше не затирает богатый Dukon `SourceProduct` пустыми `images/specifications`.
- Для th-tools single import `SourceProduct.sku` заполняется из `Product.sku`.
- Backend build проходит после `npx prisma generate`.

Нужно дополнить:

- Добавить parser fixtures/tests, которые проверяют сохранение артикула в `Product.sku` и `SourceProduct.sku`.
- Для th-tools parser при массовом импорте тоже сохранять полноценный `SourceProduct`, а не только через admin single import.
- Продолжить общий supplier import pipeline и matching по source URL, артикулу, бренду и normalized name.

Продолжение по согласованию parser snapshot:

Успехи:

- `ThToolsParserService.parseProductUrl` теперь сохраняет полноценный `SourceProduct` snapshot:
  - `sku` отдельным полем;
  - цена и валюта;
  - описание;
  - изображения;
  - характеристики;
  - связь с `Product`.
- Th-tools source создается/обновляется автоматически как `code: th-tools`.
- `SourceProduct` для th-tools сохраняется через `upsert` по `[sourceId, url]`.
- `admin import` теперь только вызывает конкретный parser и больше не пишет пустой fallback `SourceProduct`, чтобы не затирать parser-created snapshot.
- Исправлено сохранение характеристик th-tools: они теперь привязываются к реально распарсенной конечной категории, а не к fallback `Tools`.
- Backend build проходит.

Нужно дополнить:

- Добавить fixtures/tests для Dukon и th-tools, включая проверку отдельного `SourceProduct.sku`.
- Дальше выносить общий supplier import pipeline, чтобы логика `Product`/`SourceProduct` не дублировалась в парсерах.

Продолжение только по Dukon:

Успехи:

- Dukon parser приведен ближе к поведению th-tools: товары теперь получают реальную внутреннюю категорию из breadcrumbs, а не fallback `Неразобранные товары поставщиков`.
- Breadcrumbs Dukon теперь создают обе структуры:
  - `SourceCategory` для supplier mapping;
  - внутреннюю `Category` для `Product.categoryId`.
- Если для `SourceCategory` задан ручной mapping, используется он; иначе используется внутренняя категория из breadcrumbs.
- Поиск артикула и производителя стал устойчивее: значения ищутся по названию характеристики с `includes`, а не строгим равенством.
- При повторном парсинге Dukon обновляется `descriptionFull` и `seoDescription`.
- JSON-LD изображения теперь поддерживают и строку, и массив изображений.
- Не-товарные URL из sitemap теперь помечаются как `SKIPPED`, но не пишутся в persisted parser errors как реальные ошибки.
- Live smoke test на товаре `NORDBERG N32030 G` прошел успешно:
  - `Product.status`: `DRAFT`;
  - `Product.sku`: `N32030 G`;
  - `SourceProduct.sku`: `N32030 G`;
  - цена: `384.82`;
  - категория: `Подкатные гидравлические домкраты`;
  - характеристик: `10`;
  - изображений: `12`.
- Малый batch Dukon на 3 URL прошел: 2 товара обработаны, 1 URL раздела корректно помечен `SKIPPED`.
- Backend build проходит, backend lint без ошибок.

Нужно дополнить:

- Добавить fixtures/tests именно для Dukon parser: категория, артикул, бренд, цена, описание, изображения, `SourceProduct.sku`.
- Прогнать более крупный batch Dukon после fixtures/tests и проверить процент успешного парсинга.
- Позже добавить определение наличия Dukon, если на страницах удастся надежно выделить селекторы.

Продолжение по автоматизации Dukon:

Успехи:

- Добавлен `DukonCron`.
- При `PARSER_CRON_ENABLED=true` backend теперь автоматически работает с Dukon без ручных кликов в админке.
- Каждые 30 минут обрабатывается до `25` pending Dukon URL с concurrency `1`.
- Ежедневно в `06:00` обновляется Dukon sitemap, чтобы новые URL попадали в очередь как `PENDING`.
- Каждого `1` числа в `12:00` запускается месячная ревалидация:
  - sitemap обновляется;
  - все Dukon queue items сбрасываются в `PENDING`;
  - attempts/ошибки/visited timestamps очищаются для нового месячного цикла.
- Добавлена защита от overlap внутри Dukon cron jobs, чтобы один и тот же cron не запускался параллельно сам с собой.
- Backend build проходит, backend lint без ошибок.

Как включить:

- В backend env поставить `PARSER_CRON_ENABLED=true`.
- Держать backend процесс запущенным.
- Dukon будет сам подтягивать sitemap, разбирать pending URL и раз в месяц ревалидировать известные товары.

Продолжение по приоритетной ветке Dukon:

Успехи:

- Подтверждено, что официальный Dukon sitemap содержит только `286` URL и не отражает весь каталог.
- На странице `/catalog/` видны тысячи товаров по разделам, значит для полного импорта нужен HTML discovery каталога.
- Приоритетная ветка: `Наборы инструментов и специнструмент` (`/catalog/nabory-instrumentov/`).
- На live странице этой ветки найдено:
  - `24` товара на первой странице;
  - `964` страницы пагинации;
  - расчетно `23136` товарных позиций, что соответствует отображаемым `23134 товара`.
- `DukonParserService.refreshSitemaps()` теперь дополняет sitemap HTML discovery по приоритетной ветке.
- Discovery ограничен веткой `/catalog/nabory-instrumentov/`, чтобы не уходить в другие разделы из футера/меню.
- Порядок обхода настроен так, чтобы сначала ставить в очередь страницы пагинации этой ветки, а уже потом дочерние категории.
- Найденные карточки складываются в существующую очередь `SitemapsDukon` как `PENDING` и дальше обрабатываются обычным Dukon parser cron.
- Backend build проходит, backend lint без ошибок.

Важно:

- Полный discovery этой ветки займет время: около `964` страниц листинга с delay `1000 ms`, плюс обработка самих товаров с delay `3000 ms`.
- После включения `PARSER_CRON_ENABLED=true` backend будет сначала наполнять очередь этой веткой, затем постепенно парсить товары в `DRAFT`.

Продолжение по дереву категорий:

Успехи:

- Подтверждено, что на странице `Наборы инструментов и специнструмент` есть большое дерево подкатегорий.
- Discovery Dukon теперь сохраняет категории во время обхода, а не только при парсинге товара.
- Для текущей страницы категории используется путь:
  - breadcrumbs без `Главная`/`Каталог`;
  - плюс текущий `h1`.
- Все найденные дочерние ссылки `a.parent`/`a.psection` сохраняются как подкатегории текущего пути.
- Категории сохраняются в обе структуры:
  - `SourceCategory` с `url`, `externalId`, `level`, `path`, `parentId`;
  - внутренняя `Category` с `level`, `path`, `parentId`.
- Live discovery уже начал наполнять БД:
  - очередь priority branch выросла до `2309` URL;
  - `SourceCategory` Dukon содержит `90` категорий;
  - root priority category сохранена как `Наборы инструментов и специнструмент`;
  - подкатегории первого уровня сохраняются с URL.

Нужно дополнить:

- Дать full discovery завершиться до конца для всех `964` страниц и всех подкатегорий.
- После полного discovery проверить финальное количество category records и queued priority URLs.

Продолжение по fixtures/tests Dukon:

Успехи:

- Добавлен HTML fixture Dukon товара: `backend/src/parser/sites/fixtures/dukon-product.html`.
- Добавлен unit test `backend/src/parser/sites/dukon.parser.spec.ts`, который проверяет ключевые selectors/helpers Dukon parser:
  - определение товарной страницы;
  - артикул/SKU через fuzzy match по названию характеристики;
  - производителя/бренд;
  - цену BYN с запятой;
  - очистку описания от мусорного префикса Dukon;
  - JSON-LD изображения массивом и gallery images;
  - breadcrumbs/current category path;
  - child category links;
  - product links из listing cards;
  - pagination URLs.
- `DUKON_DISCOVERY_MAX_PAGES` теперь можно переопределить через env, дефолт поднят до `5000`, чтобы priority branch discovery не обрывался сразу после основных `964` страниц пагинации.
- Локально прошли:
  - `npm test -- --runInBand dukon.parser.spec.ts`;
  - `npm run build`.

Нужно дополнить:

- Добавить интеграционный тест `parseProductUrl` с mocked `fetch` и mocked Prisma upsert chain, чтобы проверять сохранение `Product.sku` и `SourceProduct.sku` end-to-end без live Dukon.
- После полного discovery проверить финальное количество category records и queued priority URLs.
- Прогнать более крупный batch Dukon и оценить долю `DONE/FAILED/SKIPPED`.

Продолжение по production cron и витрине:

Успехи:

- Live доступ к Dukon проверен: прямой `fetch/curl --noproxy` получает `200` для sitemap и priority category. Через внешний proxy-контур возможен `502`, поэтому на production важно не проксировать `dukon.by` через проблемный proxy.
- Реальный batch Dukon на `30` URL через `DukonParserService.processSitemapsBatch(30, 1)` прошел без ошибок:
  - `DONE`: вырос до `110`;
  - `FAILED`: `0`;
  - `SKIPPED`: `1`;
  - `PENDING`: `2428`.
- Новые Dukon товары теперь создаются как `PUBLISHED`, чтобы сразу попадать в публичный `/products` и frontend. При повторном парсинге только `DRAFT` переводится в `PUBLISHED`; ручные `HIDDEN/ARCHIVED` не перезаписываются.
- У Dukon image parser сужены selectors: больше не сохраняются служебные картинки шаблона, логотипы, сертификаты и resize thumbnails. Проверено на live товарах: сохраняются реальные `/upload/.../iblock/...` изображения товара.
- `DukonCron` каждые 30 минут обрабатывает `DUKON_CRON_BATCH_LIMIT`, дефолт `30`, concurrency `1`.
- `ThToolsCron` получил env batch limit `TH_TOOLS_CRON_BATCH_LIMIT=30` и защиту от overlap.
- `SitemapCron` для th-tools получил защиту от overlap.
- `docker-compose.prod.yml` прокидывает production cron env:
  - `PARSER_CRON_ENABLED`;
  - `DUKON_CRON_BATCH_LIMIT`;
  - `TH_TOOLS_CRON_BATCH_LIMIT`;
  - `DUKON_DISCOVERY_MAX_PAGES`.
- Главная frontend теперь показывает блок последних опубликованных товаров из `/products?limit=8&sortBy=createdAt&sortOrder=desc`, поэтому новые cron-import товары видны на первой странице, а старые maintenance updates не выталкивают их из топа.
- Backend `/products` теперь поддерживает sortBy `createdAt` и `updatedAt`.
- Dukon cron чистит уже сохраненные служебные `ProductImage` URL (`/local/templates/`, `/include/`, `/resize_cache/`, сертификаты), чтобы старые парсинги не тянули мусорные изображения на витрину.

Production включение:

- В production `.env` поставить `PARSER_CRON_ENABLED=true`.
- Оставить `DUKON_CRON_BATCH_LIMIT=30` и `TH_TOOLS_CRON_BATCH_LIMIT=30`, если нужен мягкий постоянный импорт примерно по 30 товаров за запуск.
- Убедиться, что production host не задает проблемные `http_proxy/https_proxy` для `dukon.by`, либо добавить `NO_PROXY=dukon.by,www.dukon.by`.

Нужно дополнить:

- Добавить health endpoint/метрику последнего успешного cron run по каждому поставщику.
- Добавить admin summary по опубликованным товарам поставщика: сколько `PUBLISHED/DRAFT/HIDDEN/ARCHIVED`.

Продолжение по observability cron/import:

Успехи:

- Добавлена Prisma-модель `ParserRuntimeStatus` и миграция `20260505000100_add_parser_runtime_status`.
- Runtime status cron jobs теперь persisted в БД и переживает рестарт backend.
- Cron jobs пишут статус запуска:
  - `dukon-process`;
  - `dukon-refresh`;
  - `dukon-revalidate`;
  - `th-tools-process`;
  - `th-tools-refresh`.
- Добавлен admin endpoint `GET /admin/queue/runtime-status`.
- Добавлен admin endpoint `GET /admin/queue/supplier-summary`.
- Admin parsing UI показывает:
  - последние cron runtime statuses;
  - сводку качества каталога по источникам: total/published/draft/hidden/archived, без фото, без цены, без SKU.
- Локально применена миграция runtime status и сгенерирован Prisma Client.
- Backend build проходит, backend lint без ошибок, только существующие warnings.
- Frontend lint проходит.

Нужно дополнить:

- Добавить alert/notification, если cron job долго не имел `lastSuccessAt` или имеет `lastError`.
- Добавить источник/фильтр на публичный каталог, если нужно быстро смотреть товары конкретного поставщика на витрине.

Продолжение по health и source filter:

Успехи:

- Добавлен admin endpoint `GET /admin/queue/health`.
- Parser health классифицирует cron jobs как:
  - `OK`;
  - `RUNNING`;
  - `ERROR`;
  - `STALE`.
- Публичный `/products` получил фильтр `sourceCode`.
- Публичный каталог frontend получил facet `Поставщики`, можно открыть `/catalog?sourceCode=dukon` и проверить Dukon-товары на витрине.
- `GET /sources` теперь сортирует источники по имени.
- Backend build проходит, backend lint без ошибок, только существующие warnings.
- Frontend lint проходит.
- Dukon parser test проходит.

Нужно дополнить:

- Добавить внешний uptime/monitoring check на `GET /admin/queue/health` или отдельный public/internal health endpoint без admin token, если будет использоваться внешний мониторинг.
- После деплоя оставить cron включенным на несколько часов и проверить `/admin/queue/supplier-summary` для Dukon: `draft=0`, приемлемые `withoutImages/withoutPrice/withoutSku`.

Продолжение по public health endpoint:

Успехи:

- Добавлен public/internal-safe endpoint `GET /health/parser` без admin token.
- Endpoint возвращает только sanitised runtime health:
  - общий `ok`;
  - `maxAgeHours`;
  - список jobs с `key`, `label`, `health`, `isRunning`, датами успеха/ошибки и счетчиками запусков.
- Endpoint не возвращает `lastResult` и текст `lastError`, чтобы не светить внутренние детали наружу.
- Backend build проходит.
- Backend lint без ошибок, только существующие warnings.
- Dukon parser test проходит.

Нужно дополнить после деплоя:

- Подключить внешний мониторинг к `/health/parser`.
- Если мониторинг должен быть приватным, закрыть endpoint на уровне reverse proxy/IP allowlist.

Продолжение по supplier parser guide и расширенному Dukon snapshot:

Успехи:

- Добавлен `SUPPLIER_PARSER_DEVELOPMENT_GUIDE.md`: пошаговый guide для подключения нового поставщика, включая `Source`, `SourceCategory`, `Product`, `SourceProduct`, очередь, cron, нормализацию и checklist готовности.
- Dukon parser теперь дополнительно парсит JSON-LD `Product`, meta description/title, canonical URL и breadcrumbs snapshot.
- Dukon parser сохраняет больше нормализованных полей в `Product`:
  - `model`;
  - `barcode`;
  - `oldPrice`;
  - `stockStatus`;
  - `descriptionShort`;
  - `seoTitle`;
  - `seoDescription`.
- `SourceProduct.specifications` для Dukon теперь хранит расширенный JSON:
  - `attributes` с характеристиками;
  - `source` metadata: source code, canonical/source URL, breadcrumbs, brand/model/barcode, old price, stock status, SEO fields, JSON-LD snapshot, `parsedAt`.
- Dukon tests расширены проверкой JSON-LD и stock parsing.
- Локально прошли:
  - `npm run lint`;
  - `npm run build`;
  - `npm test -- --runInBand`.

Нужно дополнить:

- Позже добавить миграцию для first-class supplier raw payload/metadata, если расширенного JSON в `SourceProduct.specifications` станет недостаточно.
- Добавить общий supplier import pipeline, чтобы Dukon/th-tools меньше дублировали сохранение `Product` и `SourceProduct`.

Продолжение по 7745.by:

Успехи:

- Legacy `parse7745()` улучшен: JSON-LD/meta fallback, цена с копейками, абсолютные изображения, фильтр служебных картинок, характеристики из live selectors, SKU/serialNumber из microdata.
- Добавлен fixture-backed test для `parse7745()`.
- Добавлен полноценный catalog-saving parser `Supplier7745ParserService`.
- Добавлена очередь `Sitemaps7745` и миграция `20260506000100_add_7745_sitemaps`.
- 7745 подключен к admin single import, admin queue endpoints, admin parsing UI и cron.
- `7745.by/sitemap.xml` оказался sitemap index; parser теперь читает `products_*.xml`, канонизирует `/product/...` URL и убирает hash anchors.
- Добавлена защита от антибот-страницы `Verification`, чтобы она не сохранялась как товар.
- Локально миграция применена, refresh загрузил `66696` URL.
- Контролируемые live batches обработали `40` товаров:
  - `DONE`: `40`;
  - `FAILED`: `0`;
  - `withoutImages`: `0`;
  - `withoutPrice`: `0`;
  - `withoutSku`: `0`.
- Backend lint/build/tests проходят, frontend lint проходит.

Что осталось по 7745:

- Прогнать выборку в несколько сотен URL и проверить долю ошибок.
- Проверить точность категорий и добавить ручные `SourceCategory` mappings для спорных веток.
- Решить, импортировать ли все `66696` товаров или ограничить приоритетными категориями.
- Позже перенести изображения поставщика в собственное object storage/CDN.

Продолжение по приоритету источников:

Успехи:

- Зафиксирован фокус на `tools.by`, `th-tools` и `dukon`.
- `7745.by` оставлен второстепенным источником: cron теперь требует отдельный флаг `SUPPLIER_7745_CRON_ENABLED=true`, по умолчанию выключен.
- Улучшен legacy helper `parseTools()` для `tools.by`: цена, SKU/specs, описание, изображения, meta fallback.
- Добавлен `ToolsByParserService` для безопасного single URL import `tools.by/product/...` без массового discovery, потому что `tools.by/robots.txt` содержит `Disallow: /`, а публичного sitemap нет.
- `tools.by` single import теперь сохраняет `Product`, `SourceProduct`, категории, бренд, изображения и характеристики.
- Live smoke `tools.by/product/1750929` прошел:
  - SKU `2333193`;
  - цена `370`;
  - `5` изображений;
  - `18` характеристик;
  - категория `Воздуходувки аккумуляторные`;
  - source `tools-by`.

Что осталось по приоритетным источникам:

- Для `tools.by` использовать ручной import конкретных URL или получить разрешение/фид от поставщика перед массовым cron.
- Для `th-tools` и `dukon` продолжать cron/import как основные автоматические источники.
- Позже вынести общий supplier import pipeline, чтобы `tools.by`, `th-tools`, `dukon` и `7745` меньше дублировали сохранение `Product`/`SourceProduct`.

Продолжение по backend lint cleanup:

Успехи:

- Убраны оставшиеся backend ESLint warnings по unsafe `any` в публичном фильтре товаров и категориях parser services.
- `ProductService.findAllFiltered()` теперь использует Prisma-типы `ProductWhereInput` и `ProductOrderByWithRelationInput` вместо локальных `any`.
- Категорийные upsert-результаты в Dukon/th-tools parser services явно сведены к минимальной форме `{ id, mappedCategoryId }`, чтобы не протаскивать unsafe member access.
- Локально прошли:
  - `npm run lint` без warnings/errors;
  - `npm run build`;
  - `npm test -- --runInBand`.

Нужно дополнить после деплоя:

- Подключить внешний мониторинг к `/health/parser`.
- Если мониторинг должен быть приватным, закрыть endpoint на уровне reverse proxy/IP allowlist.
