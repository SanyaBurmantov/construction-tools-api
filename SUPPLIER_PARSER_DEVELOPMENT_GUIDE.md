# Supplier Parser Development Guide

## Цель

Этот проект должен постоянно забирать товары от поставщиков, приводить их к единому каталожному виду и сохранять максимум исходных данных для последующей проверки, сопоставления и улучшения карточек.

Новый поставщик должен сохранять данные в два слоя:

- `Product`: нормализованная карточка витрины в общем формате проекта.
- `SourceProduct`: snapshot товара поставщика с исходными значениями, ссылкой, характеристиками, изображениями и метаданными.

## Как Сейчас Работает Постоянный Парсинг

Парсинг включается переменной окружения:

```env
PARSER_CRON_ENABLED=true
```

При включенном cron backend сам запускает jobs:

- `dukon-refresh`: каждый день обновляет очередь ссылок Dukon.
- `dukon-process`: каждые 30 минут обрабатывает pending URL Dukon.
- `dukon-revalidate`: раз в месяц сбрасывает очередь Dukon на повторную проверку.
- `th-tools-refresh`: обновляет sitemap th-tools.
- `th-tools-process`: обрабатывает pending URL th-tools.

Состояние cron jobs сохраняется в `ParserRuntimeStatus`, поэтому админка и `/health/parser` видят статус после рестарта backend.

## Общая Модель Данных

### `Source`

Один поставщик/источник.

Обязательные поля:

- `name`: человекочитаемое имя, например `Dukon`.
- `code`: стабильный код, например `dukon`. Используется в фильтрах, cron и source matching.
- `url`: базовый сайт поставщика.

### `SourceCategory`

Категории поставщика. Нужны, чтобы не терять дерево поставщика и позже вручную сопоставлять его с внутренними категориями.

Правило:

- Всегда сохраняй supplier category path, если сайт дает breadcrumbs или дерево категорий.
- Если у `SourceCategory.mappedCategoryId` есть ручное сопоставление, товар должен использовать эту внутреннюю категорию.
- Если mapping нет, можно создать внутреннюю `Category` по breadcrumbs как MVP fallback.

### `Product`

Нормализованная карточка витрины.

Заполняй максимум существующих полей:

- `name`
- `slug`
- `sku`
- `barcode`
- `model`
- `brandId`
- `categoryId`
- `priceValue`
- `priceCurrency`
- `oldPrice`
- `stockStatus`
- `descriptionShort`
- `descriptionFull`
- `seoTitle`
- `seoDescription`
- `images`
- `productSpecs`

Новые импортированные товары сейчас создаются как `PUBLISHED`, чтобы попадать на витрину. При повторном парсинге нельзя перезаписывать ручные статусы `HIDDEN` и `ARCHIVED`.

### `SourceProduct`

Источник истины по конкретному URL поставщика.

Обязательное правило идентичности:

```ts
where: { sourceId_url: { sourceId, url } }
```

Snapshot должен хранить:

- `sourceId`
- `externalId`: URL или внешний ID поставщика.
- `url`
- `name`
- `sku`
- `price`
- `currency`
- `stock`
- `images`
- `description`
- `specifications`
- `productId`
- `sourceCategoryId`
- `lastSync`

В `specifications` можно хранить расширенный JSON. Рекомендуемый формат:

```ts
{
  attributes: {
    "Артикул": "ABC-123",
    "Производитель": "Brand"
  },
  source: {
    code: "supplier-code",
    url: "https://supplier.example/product",
    canonicalUrl: "https://supplier.example/product",
    breadcrumbs: ["Каталог", "Раздел"],
    metaTitle: "...",
    metaDescription: "...",
    jsonLd: { ... },
    parsedAt: "2026-05-06T00:00:00.000Z"
  }
}
```

## Что Должен Уметь Parser Service

Для нового поставщика создай файл:

```txt
backend/src/parser/sites/<source-code>.parser.ts
```

Минимальный публичный API сервиса:

```ts
@Injectable()
export class SupplierParserService {
  async refreshSitemaps() {}
  async getQueueStats() {}
  async processSitemapsBatch(limit = 30, concurrency = 1) {}
  async processSitemapUrl(url: string) {}
  async previewProductUrl(url: string) {}
  async parseProductUrl(url: string) {}
}
```

`previewProductUrl` must parse and return supplier data without writing to the database. Use it for production dry-runs before enabling batch processing for a source/category.

Если источник большой, добавь HTML discovery каталога, а не полагайся только на sitemap.

## Обязательные Шаги Для Нового Поставщика

1. Выбери стабильный `sourceCode`, например `my-supplier`.
2. Добавь parser service в `backend/src/parser/sites/my-supplier.parser.ts`.
3. Сделай `upsertSource()` с фиксированным `code`.
4. Добавь очередь URL. Для production лучше отдельная Prisma-модель очереди со статусами `PENDING`, `DONE`, `FAILED`, `SKIPPED`, `attempts`, `lastError`, `lastTriedAt`, `visitedAt`.
5. Реализуй `refreshSitemaps()` или HTML discovery каталога.
6. Реализуй `parseProductUrl(url)`.
7. В `parseProductUrl` сначала собери supplier data, затем сохрани нормализованный `Product`, затем `SourceProduct` snapshot.
8. Добавь parser в `ParserModule` и `AdminModule`, если нужен ручной запуск из админки.
9. Добавь cron service по примеру `dukon.cron.ts`.
10. Добавь admin endpoints для queue stats/process/retry, если нужна ручная диагностика.
11. Добавь fixture HTML и unit tests для selector helpers.
12. Запусти `npm run lint`, `npm run build`, `npm test -- --runInBand` в `backend`.

## Нормализация Полей

### Название

Приоритет:

1. `h1`
2. JSON-LD `Product.name`
3. `meta[property="og:title"]`

Название обязательно. Если его нет, URL должен стать `FAILED`.

### Slug

Используй `generateSlug(name)`. Если есть риск дублей, добавляй к slug supplier SKU или внешний ID.

### Артикул / SKU

Приоритет:

1. Характеристики: `Артикул`, `Код`, `SKU`, `Код производителя`.
2. JSON-LD: `sku`, `mpn`.
3. Видимый блок карточки товара.

Сохраняй в оба места:

- `Product.sku`
- `SourceProduct.sku`

### Бренд

Приоритет:

1. Характеристики: `Производитель`, `Бренд`, `Торговая марка`.
2. JSON-LD `brand.name` или `brand`.
3. Видимый блок бренда.

Бренд сохраняй через `Brand.upsert({ where: { slug } })`.

### Категория

Приоритет:

1. `SourceCategory.mappedCategoryId`, если есть ручной mapping.
2. Внутренняя категория, созданная из breadcrumbs.
3. Fallback `Неразобранные товары поставщиков`.

### Цена

Сохраняй:

- `Product.priceValue`
- `Product.priceCurrency`
- `Product.oldPrice`, если есть старая цена.
- `SourceProduct.price`
- `SourceProduct.currency`

Валюта должна быть ISO-кодом, например `BYN`, а не символом `руб.`.

### Наличие

Приводи к `stockStatus`:

- `in_stock`
- `out_of_stock`
- `preorder`
- `unknown`

Для `SourceProduct.stock` используй boolean:

- `true` для `in_stock` и `preorder`.
- `false` для `out_of_stock`.

### Описание

Сохраняй:

- `Product.descriptionFull`: основное описание.
- `Product.descriptionShort`: короткое описание или meta description.
- `Product.seoDescription`: meta description или fallback на описание.
- `SourceProduct.description`: исходное описание поставщика.

Чисти технический мусор HTML/CMS.

### Изображения

Сохраняй только изображения товара, не логотипы, сертификаты, thumbnails и картинки шаблона.

Правила:

- Используй JSON-LD `image`, `og:image`, галерею товара.
- Игнорируй `/resize_cache/`, `/local/templates/`, `/include/`, сертификаты.
- Дедуплицируй URL.
- Порядок должен соответствовать галерее, главное изображение `order: 0`.

Пока `ProductImage.url` может хранить remote URL поставщика. В production желательно позже скачивать изображения в R2/S3 и хранить CDN URL.

### Характеристики

Каждую характеристику сохраняй в:

- `Specification` с unique `[categoryId, key]`.
- `ProductSpecification` с unique `[productId, specificationId]`.
- `SourceProduct.specifications.attributes` как raw snapshot.

Не клади артикул только в характеристики: он должен быть отдельным `sku`.

## Ошибки И Статусы Очереди

Рекомендуемая логика обработки URL:

- Успешный товар: `DONE`.
- Не товарная страница: `SKIPPED`, без записи в `ParserError`.
- Ошибка fetch/parse/save: `FAILED`, запись в `ParserError`.
- Перед обработкой увеличивай `attempts` и ставь `lastTriedAt`.

## Cron Safety

Для каждого cron job:

- Проверяй `PARSER_CRON_ENABLED === 'true'`.
- Добавь in-memory overlap guard, чтобы job не запускался параллельно сам с собой.
- Пиши runtime status через `ParserRuntimeStatusService.start/success/failure`.
- Используй мягкие лимиты: batch `30`, concurrency `1`, delay между запросами.

## Минимальный Checklist Готовности Источника

- `Source` создается автоматически.
- URL попадают в очередь.
- Queue stats видны в админке или через API.
- `parseProductUrl()` сохраняет `Product` и `SourceProduct`.
- SKU, бренд, категория, цена, наличие, описание, изображения и характеристики сохраняются.
- Повторный парсинг обновляет supplier data, но не публикует вручную скрытые/архивные товары.
- Не-товарные URL получают `SKIPPED`.
- Ошибки видны в `/admin/queue/errors`.
- Cron пишет статус в `/health/parser`.
- Есть fixture test для selectors.
- `npm run lint`, `npm run build`, `npm test -- --runInBand` проходят.
