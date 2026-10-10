# Quick Start — как поднять весь проект

Каталог стройинструмента: **БД (Postgres) + бэкенд (NestJS) + фронт (Nuxt) + парсеры поставщиков**.

Три способа запустить:

| Вариант | Когда | Что делает |
|---|---|---|
| **1. Docker (локально)** | разработка, «просто посмотреть» | поднимает БД+бэк+фронт одной командой |
| **2. Нативно (без Docker)** | если нужен hot-reload и контроль | запускаешь сервисы руками |
| **3. Продакшен** | боевой сервер | собирает прод-образы, HTTPS, авто-миграции |

> Требования: **Docker + Compose plugin**. Для нативного запуска — **Node ≥ 22.12** и **PostgreSQL 15**.

---

## Вариант 1. Локально в Docker (рекомендуется)

Поднимает три сервиса: `db` (2222), `back` (8000), `front` (3000).

### Первый запуск

1. **Токен админки.** Создай файл `backend/.env` (нужен для админки и запуска парсинга):
   ```env
   ADMIN_TOKEN=dev-secret
   PARSER_CRON_ENABLED=false
   ```

2. **Поднять стек** (соберёт образы при первом запуске):
   ```bash
   docker compose up -d --build
   ```

3. **Накатить схему БД** (в dev миграции вручную — авто только в проде):
   ```bash
   docker compose exec back npx prisma migrate deploy
   ```
   > Если бэк ругается на Prisma Client:
   > `docker compose exec back npx prisma generate && docker compose restart back`

### Где что
- **Фронт:** http://localhost:3000 · админка: http://localhost:3000/admin
- **API:** http://localhost:8000 (Swagger: поставь `SWAGGER_ENABLED=true` → http://localhost:8000/api)
- **БД:** `localhost:2222`, `postgres` / `postgres`, база `construction_tools`
- **Логи:** `docker compose logs -f back`

### Запустить парсинг — вручную (сразу, без ожидания)
```bash
TOKEN=dev-secret
# 1) наполнить очередь ссылок (пример: dukon)
curl -X POST http://localhost:8000/admin/queue/dukon/refresh-sitemaps -H "x-admin-token: $TOKEN"
# 2) обработать небольшой батч
curl -X POST http://localhost:8000/admin/queue/dukon/process \
  -H "x-admin-token: $TOKEN" -H "content-type: application/json" -d '{"limit":5}'
# 3) посмотреть статус очереди и здоровье
curl -H "x-admin-token: $TOKEN" http://localhost:8000/admin/queue/dukon
curl http://localhost:8000/health/parser
```
Появившиеся товары видно на фронте и в админке `/admin/parsing`.

### Запустить парсинг — автоматически (по расписанию)
В `backend/.env` поставь `PARSER_CRON_ENABLED=true` (для 7745 ещё `SUPPLIER_7745_CRON_ENABLED=true`) и `docker compose restart back`.
Расписание `dukon`/`th-tools`: обработка очереди каждые 30 мин, обновление sitemap раз в день.

### Остановить / пересобрать
```bash
docker compose down            # остановить (данные БД сохранятся в volume)
docker compose up -d --build   # пересобрать после изменений
```

---

## Вариант 2. Нативно, без Docker

1. **БД** (только Postgres в Docker — удобно):
   ```bash
   cd backend && npm run start:db-docker
   ```
   (или свой локальный PostgreSQL 15)

2. **`backend/.env`:**
   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:2222/construction_tools?schema=public
   ADMIN_TOKEN=dev-secret
   PARSER_CRON_ENABLED=false
   ```

3. **Бэкенд:**
   ```bash
   cd backend
   npm ci
   npx prisma migrate deploy   # схема БД
   npx prisma generate         # Prisma Client
   npm run start:dev           # http://localhost:8000, watch-режим
   ```

4. **Фронт** (в другом терминале):
   ```bash
   cd frontend
   npm ci
   npm run dev                 # http://localhost:3000
   ```

Парсинг запускается теми же `curl`, что в варианте 1.

---

## Вариант 3. Продакшен (один скрипт)

Собирает прод-образы фронта и бэка, поднимает БД и Caddy (авто-HTTPS), **сам накатывает миграции** на старте бэкенда.

```bash
cp .env.prod.example .env.prod      # заполнить: DOMAIN, PUBLIC_ORIGIN, DB_PASSWORD, ADMIN_TOKEN
sh deploy-prod.sh
```
Секреты: `openssl rand -hex 32` для `DB_PASSWORD` и `ADMIN_TOKEN`.

Вход в админку — учётной записью. На первом старте бэкенд создаёт админа
`ADMIN_LOGIN` (по умолчанию **`admin`**) с паролем `ADMIN_PASSWORD`, а если он
не задан — с зашитым начальным **`test-111`**. Смените его в `/admin/users`
сразу после входа; там же создаются остальные админы. `x-admin-token` остался
только для curl-команд ниже.

В проде Caddy проксирует API под префиксом **`/api`**:
```bash
# наполнить и запустить парсинг на бою
curl -X POST https://$DOMAIN/api/admin/queue/dukon/refresh-sitemaps -H "x-admin-token: $ADMIN_TOKEN"
curl -X POST https://$DOMAIN/api/admin/queue/dukon/process -H "x-admin-token: $ADMIN_TOKEN" \
  -H "content-type: application/json" -d '{"limit":5}'
```
Авто-парсинг: `PARSER_CRON_ENABLED=true` в `.env.prod` → `sh deploy-prod.sh`.

Подробности, требования к серверу и грабли — в **`DEPLOY_PRODUCTION.md`** и `.claude/skills/deploy-prod/SKILL.md`.

---

## Источники и безопасный порядок парсинга

Поставщики: **`dukon`, `th-tools`, `7745`, `tools-by`**. Эндпоинты — per-source: `/admin/queue/<code>/...`.

Перед массовым запуском нового источника/категории — **dry-run без записи в БД**:
```bash
curl -X POST http://localhost:8000/admin/source-products/preview \
  -H "x-admin-token: $TOKEN" -H "content-type: application/json" \
  -d '{"sourceId":"<id>","url":"<url-товара>"}'
```
Рекомендуемый порядок: **preview → refresh-sitemaps → process limit=5 → проверить качество → включить cron**.

---

## Проверка здоровья

| Эндпоинт | Что показывает |
|---|---|
| `GET /health` | процесс жив (liveness) |
| `GET /health/ready` | БД доступна (readiness, 503 если нет) |
| `GET /health/parser` | состояние кронов парсера (OK / STALE / ERROR / RUNNING) |

Локально — напрямую на `:8000`, в проде — через `/api` (`https://$DOMAIN/api/health/parser`).

---

## Частые проблемы

- **Сборка/старт бэка падает с кучей ошибок про неизвестные поля Prisma** → не сгенерирован клиент: `npx prisma generate` (в Docker: `docker compose exec back npx prisma generate`).
- **Фронт падает с `crypto.hash is not a function`** → Node < 22. Нужен Node ≥ 22.12 (в Docker уже `node:22`).
- **`401` на `/admin/...`** → истекла сессия аккаунта, либо не задан/не совпадает
  `ADMIN_TOKEN` (заголовок `x-admin-token`). **`403`** → вошли покупателем, а не админом.
- **Не пускает в админку** → проверь логи бэкенда: при старте он пишет, создал ли учётку и
  с каким паролем (`admin` / `test-111` по умолчанию). Если логин `admin` уже занят обычным
  пользователем, админ не создаётся — задай свободный `ADMIN_LOGIN` и перезапусти.
- **Прод: бэк в рестарт-цикле, `P1000 Authentication failed`** → `DB_PASSWORD` не совпадает с тем, с которым Postgres инициализировал volume. Поправь пароль под существующий volume (или `down -v` на тестовом стеке — сотрёт данные).
- **Парсинг включил, а товаров нет** → проверь `GET /health/parser` и `GET /admin/queue/<code>` (статусы `FAILED`/`SKIPPED`) и `GET /admin/queue/errors`.
