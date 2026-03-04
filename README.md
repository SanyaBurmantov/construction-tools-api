# Construction Tools API

<p align="center">
  <a href="http://localhost:3000/api" target="_blank">
    <img src="https://img.shields.io/badge/Swagger-UI-green" alt="Swagger" />
  </a>
  <img src="https://img.shields.io/badge/NestJS-11-blue" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-5-purple" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Prisma-5-orange" alt="Prisma" />
</p>

API для парсинга и управления товарами строительных инструментов.

## 🚀 Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run start:dev

# Запуск в продакшене
npm run start:prod

# Сборка
npm run build
```

## 📚 Документация API

**Swagger UI:** http://localhost:3000/api

## 🔧 Переменные окружения

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/construction_tools?schema=public"
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRATION="7d"
```

## 📦 Основные возможности

- **Парсинг товаров** - извлечение данных с сайтов (tools.by, th-tool.by и др.)
- **Фасетные фильтры** - настраиваемые фильтры для категорий
- **Иерархия категорий** - древовидная структура
- **REST API** - полный CRUD для всех сущностей
- **Swagger** - интерактивная документация

## 🗂️ Структура проекта

```
src/
├── products/          # Товары (CRUD + фильтрация)
├── categories/        # Категории (иерархические)
├── facet-filters/     # Фасетные фильтры
├── source-websites/   # Источники для парсинга
├── parser/            # Парсер (cheerio)
├── auth/              # Авторизация (JWT)
└── prisma/            # Prisma сервис
```

## 📖 API Endpoints

### Products (Товары)
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/products` | Создать товар |
| GET | `/products` | Список товаров (с фильтрами) |
| GET | `/products/:id` | Товар по ID |
| GET | `/products/slug/:slug` | Товар по slug |
| GET | `/products/facets/:categoryId` | Фасеты для категории |
| PATCH | `/products/:id` | Обновить товар |
| DELETE | `/products/:id` | Удалить (soft delete) |

**Фильтры для GET /products:**
- `page`, `limit` - пагинация
- `search` - поиск
- `brand` - бренд (можно несколько)
- `categoryId` - категория
- `minPrice`, `maxPrice` - цена
- `inStock` - в наличии

### Categories (Категории)
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/categories` | Создать категорию |
| GET | `/categories` | Список категорий |
| GET | `/categories/tree` | Дерево категорий |
| GET | `/categories/:id` | Категория по ID |
| PATCH | `/categories/:id` | Обновить |
| DELETE | `/categories/:id` | Удалить |

### Facet Filters (Фасетные фильтры)
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/facet-filters` | Создать фильтр |
| GET | `/facet-filters` | Список фильтров |
| GET | `/facet-filters/category/:categoryId` | Для категории |
| POST | `/facet-filters/:id/toggle` | Вкл/Выкл |
| DELETE | `/facet-filters/:id` | Удалить |

**Типы фильтров:** `RANGE`, `SELECT`, `MULTISELECT`, `BOOLEAN`

### Source Websites (Источники)
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/source-websites` | Добавить источник |
| GET | `/source-websites` | Список источников |
| GET | `/source-websites/:id` | По ID |
| PATCH | `/source-websites/:id` | Обновить |
| POST | `/source-websites/:id/toggle` | Вкл/Выкл |
| GET | `/source-websites/:id/parser-config` | Конфиг парсера |

### Parser (Парсинг)
| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/parser/parse-url` | Спарсить URL |
| POST | `/parser/parse-batch` | Спарсить несколько URL |
| GET | `/parser/preview` | Предпросмотр |
| POST | `/parser/parse-category` | Парсинг категории |

**Пример парсинга:**
```bash
curl -X POST http://localhost:3000/parser/parse-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tools.by/product/1605300"}'
```

## 🐳 Docker

```bash
# Запуск
docker compose up --build -d

# Логи
docker compose logs -f

# Остановить
docker compose down
```

## 📄 База данных

```bash
# Миграции
npx prisma migrate dev --name migration_name

# Prisma Studio
npx prisma studio

# Deploy миграций
npx prisma migrate deploy
```

## 🔐 Авторизация

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/auth/signup` | Регистрация |
| POST | `/auth/signin` | Логин |
| GET | `/auth/profile` | Профиль (JWT) |

## 📝 Лицензия

UNLICENSED
