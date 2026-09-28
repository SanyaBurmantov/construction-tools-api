# Frontend (Nuxt.js 3)

Веб-интерфейс для платформы Construction Tools.

## 🚀 Быстрый старт

### Установка зависимостей

```bash
npm install
```

### Запуск в режиме разработки

```bash
npm run dev
```

Приложение будет доступно по адресу: http://localhost:3000

### Сборка для продакшена

```bash
npm run build
```

### Запуск продакшен сборки

```bash
npm run preview
```

## 📂 Структура

```
frontend/
├── app/
│   ├── assets/          # CSS, изображения
│   │   └── css/
│   │       ├── fonts.css
│   │       ├── main.css
│   │       └── theme.css
│   ├── components/      # Vue компоненты
│   │   ├── layout/      # Компоненты макета
│   │   │   ├── header.vue
│   │   │   └── footer.vue
│   │   ├── product/     # Товарные компоненты
│   │   │   └── card.vue
│   │   └── ui/          # UI компоненты
│   │       └── UIButton.vue
│   ├── data/            # Данные и моки
│   │   └── mocks/
│   │       └── products.ts
│   ├── layouts/         # Шаблоны страниц
│   │   └── default.vue
│   ├── pages/           # Страницы приложения
│   │   ├── index.vue    # Главная
│   │   └── catalog.vue  # Каталог
│   └── types/           # TypeScript типы
│       └── product.ts
├── public/              # Статические файлы
├── Dockerfile           # Docker конфигурация
├── nginx.conf           # Nginx конфигурация
├── nuxt.config.ts       # Nuxt конфигурация
├── package.json
└── tsconfig.json
```

## 🛠 Технологии

- **Nuxt.js 3** - SSR фреймворк
- **Vue 3** - Основной фреймворк
- **TypeScript** - Типизация
- **@nuxt/ui** - UI компоненты
- **Pinia** - Управление состоянием
- **Tailwind CSS** - Утилитарные CSS классы
- **Sass** - CSS препроцессор

## 🎨 Стилизация

### CSS переменные

Основные переменные определены в `app/assets/css/theme.css`:

```css
:root {
  --color-primary: #2c2c2c;
  --color-primary-hover: #181818;
  --color-accent: #ce0f3d;
  --color-bg-light: #f5f5f5;
  --color-text: #333333;
  --color-text-light: #ffffff;
}
```

### Использование в компонентах

```vue
<style scoped>
.my-component {
  background: var(--color-bg-light);
  color: var(--color-text);
}

.my-component:hover {
  background: var(--color-primary);
}
</style>
```

## 📡 API Integration

Для интеграции с API используется переменная окружения:

```bash
# .env
NUXT_PUBLIC_API_URL=http://localhost:3001
```

### Пример запроса к API

```typescript
const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl

const { data: products } = await useFetch(`${apiUrl}/products`)
```

## 🐳 Docker

### Запуск через docker-compose

```bash
# Из корня проекта
docker compose up --build -d
```

Frontend будет доступен по адресу: http://localhost:3000

### Локальная сборка

```bash
docker build -t construction-tools-frontend .
docker run -p 3000:80 construction-tools-frontend
```

## 📝 Скрипты

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск сервера разработки |
| `npm run build` | Сборка для продакшена |
| `npm run generate` | Статическая генерация |
| `npm run preview` | Предпросмотр продакшен сборки |
| `npm run lint` | Проверка ESLint |
| `npm run lint:fix` | Исправление ESLint ошибок |
| `npm run format` | Форматирование Prettier |
| `npm run format:check` | Проверка форматирования |

## 🔌 Расширение

### Добавление новой страницы

Создайте файл в `app/pages/`:

```vue
<!-- app/pages/about.vue -->
<template>
  <div class="about-page">
    <h1>О нас</h1>
    <p>Информация о компании</p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.about-page {
  padding: 40px 20px;
}
</style>
```

### Добавление компонента

```vue
<!-- app/components/ui/MyComponent.vue -->
<template>
  <div class="my-component">
    <slot />
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.my-component {
  padding: 16px;
}
</style>
```

## 📄 Лицензия

UNLICENSED
