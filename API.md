# Construction Tools API

API для парсинга и управления товарами строительных инструментов.

## Запуск

```bash
# Development
npm run start:dev

# Production
npm run start:prod

# Build
npm run build
```

## API Endpoints

### Products (Товары)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/products` | Создать товар |
| GET | `/products` | Получить список товаров (с фильтрацией) |
| GET | `/products/:id` | Получить товар по ID |
| GET | `/products/slug/:slug` | Получить товар по slug |
| GET | `/products/facets/:categoryId` | Получить опции фасетных фильтров для категории |
| PATCH | `/products/:id` | Обновить товар |
| DELETE | `/products/:id` | Удалить товар (soft delete) |
| DELETE | `/products/:id/hard` | Удалить товар полностью |

**Параметры фильтрации для GET /products:**
- `page` - страница (default: 1)
- `limit` - товаров на страницу (default: 20)
- `search` - поиск по названию, бренду, модели
- `brand` - бренд (можно несколько: `brand=WORTEX&brand=Bosch`)
- `categoryId` - ID категории
- `minPrice` - минимальная цена
- `maxPrice` - максимальная цена
- `inStock` - в наличии (`true`/`false`)

### Categories (Категории)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/categories` | Создать категорию |
| GET | `/categories` | Получить список категорий |
| GET | `/categories/tree` | Получить дерево категорий |
| GET | `/categories/:id` | Получить категорию по ID |
| GET | `/categories/slug/:slug` | Получить категорию по slug |
| PATCH | `/categories/:id` | Обновить категорию |
| DELETE | `/categories/:id` | Удалить категорию |

### Facet Filters (Фасетные фильтры)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/facet-filters` | Создать фильтр |
| GET | `/facet-filters` | Получить список фильтров |
| GET | `/facet-filters/category/:categoryId` | Получить фильтры для категории |
| GET | `/facet-filters/:id` | Получить фильтр по ID |
| PATCH | `/facet-filters/:id` | Обновить фильтр |
| POST | `/facet-filters/:id/toggle` | Включить/выключить фильтр |
| DELETE | `/facet-filters/:id` | Удалить фильтр |

**Типы фильтров:**
- `RANGE` - числовой диапазон (цена, вес, мощность)
- `SELECT` - одиночный выбор (бренд)
- `MULTISELECT` - множественный выбор
- `BOOLEAN` - да/нет

### Source Websites (Источники для парсинга)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/source-websites` | Добавить источник |
| GET | `/source-websites` | Получить список источников |
| GET | `/source-websites/:id` | Получить источник по ID |
| GET | `/source-websites/url/:url` | Получить источник по URL |
| PATCH | `/source-websites/:id` | Обновить источник |
| POST | `/source-websites/:id/toggle` | Включить/выключить источник |
| GET | `/source-websites/:id/parser-config` | Получить конфиг парсера |
| DELETE | `/source-websites/:id` | Удалить источник |

**Пример создания источника:**
```json
{
  "name": "Tools.by",
  "baseUrl": "https://tools.by",
  "isActive": true,
  "parserConfig": {
    "selectors": {
      "name": "h1",
      "price": "[data-test=\"product-price\"]",
      "brand": "[data-test=\"product-brand\"]",
      "article": "[data-test=\"product-article\"]",
      "inStock": "[data-test=\"stock-status\"]",
      "specifications": {
        "container": "[data-test=\"specifications\"] tr",
        "key": "td:first-child",
        "value": "td:last-child"
      },
      "images": ".product-gallery img",
      "description": ".product-description"
    }
  }
}
```

### Parser (Парсинг)

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/parser/parse-url` | Спарсить URL и сохранить товар |
| POST | `/parser/parse-batch` | Спарсить несколько URL |
| GET | `/parser/preview` | Предпросмотр парсинга |
| POST | `/parser/parse-category` | Спарсить страницу категории |

**Пример парсинга:**
```json
POST /parser/parse-url
{
  "url": "https://tools.by/product/1605300",
  "sourceWebsiteId": "uuid-источника"
}
```

## База данных

Миграции:
```bash
npx prisma migrate dev --name migration_name
npx prisma migrate deploy
```

Студия Prisma:
```bash
npx prisma studio
```

## Структура базы данных

- **User** - пользователи (авторизация)
- **SourceWebsite** - сайты-источники для парсинга
- **Category** - категории товаров (иерархические)
- **FacetFilter** - фасетные фильтры для категорий
- **Product** - товары

## Примеры использования

### 1. Добавить источник для парсинга
```bash
curl -X POST http://localhost:3000/source-websites \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tools.by",
    "baseUrl": "https://tools.by",
    "parserConfig": {}
  }'
```

### 2. Спарсить товар
```bash
curl -X POST http://localhost:3000/parser/parse-url \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://tools.by/product/1605300",
    "sourceWebsiteId": "uuid-из-предыдущего-шага"
  }'
```

### 3. Создать категорию
```bash
curl -X POST http://localhost:3000/categories \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Гидравлические прессы",
    "slug": "gidravlicheskie-pressy"
  }'
```

### 4. Создать фасетный фильтр для категории
```bash
curl -X POST http://localhost:3000/facet-filters \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Цена",
    "field": "price",
    "type": "RANGE",
    "categoryId": "uuid-категории",
    "config": {
      "min": 0,
      "max": 100000,
      "currency": "BYN"
    }
  }'
```

### 5. Получить товары с фильтрами
```bash
curl "http://localhost:3000/products?brand=WORTEX&minPrice=50&maxPrice=500&inStock=true"
```
