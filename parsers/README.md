# Parser Modules

## 📁 Структура

```
parsers/
├── thtool_parser.py      ← Парсер для th-tool.by
├── toolsby_parser.py     ← Парсер для tools.by
├── README.md
└── ...

configs/
├── thtool_config.py      ← Конфигурация th-tool.by
└── toolsby_config.py     ← Конфигурация tools.by
```

---

## 🚀 Быстрый старт

### TH-Tool.by

```bash
python3 parsers/thtool_parser.py
```

### Tools.by (бренды → категории → товары)

```bash
python3 parsers/toolsby_parser.py
```

## ⚙️ Конфигурация

### configs/thtool_config.py

| Параметр | Описание |
|----------|----------|
| `SITE_NAME` | Название сайта |
| `SITE_BASE_URL` | Базовый URL |
| `SITE_SITEMAP` | URL sitemap.xml |
| `SOURCE_WEBSITE_ID` | ID источника в БД |
| `PARSER_CONFIG` | Настройки парсера (Playwright, timeout) |
| `PARSER_SELECTORS` | CSS селекторы для извлечения данных |
| `CATEGORY_HIERARCHY` | Иерархия категорий с ключевыми словами |
| `UNITS` | Единицы измерения для нормализации |
| `EXCLUDE_PATTERNS` | URL для исключения из парсинга |
| `BATCH_CONFIG` | Настройки пакетной обработки |

## 📊 Что парсится

### Основная информация
- ✅ Название товара
- ✅ Бренд
- ✅ Артикул
- ✅ Штрихкод
- ✅ Цена (текущая)
- ✅ Наличие
- ✅ Вес

### Описание и характеристики
- ✅ Полное описание
- ✅ Все характеристики (таблица)
- ✅ Нормализация единиц измерения

### Медиа
- ✅ Ссылки на изображения
- ✅ Главное изображение

### Категоризация
- ✅ Авто-определение категории (по названию)
- ✅ Иерархия до 2 уровней
- ✅ Создание категорий если нет

### Фильтры
- ✅ RANGE (числовые: вес, цена, мощность)
- ✅ SELECT (выбор: бренд, материал)
- ✅ BOOLEAN (да/нет: наличие)

### SEO
- ✅ Slug (URL-friendly)
- ✅ Meta title
- ✅ Meta description
- ✅ Meta keywords

## 📈 Статистика

После парсинга выводится статистика:

```
📊 СТАТИСТИКА:
  ✓ Распаршено: 100
  ✓ Создано: 0
  ✓ Обновлено: 100
  ⚠ Дубликаты: 0
  ✗ Ошибки: 0
  📁 Категорий создано: 12
  🔍 Фильтров создано: 38
```

## 📝 Логи

Логи сохраняются в `logs/thtool_parser_YYYYMMDD_HHMMSS.log`

## 🔧 Расширение категорий

Для добавления новых категорий отредактируйте `CATEGORY_HIERARCHY`:

```python
CATEGORY_HIERARCHY = {
    "Оборудование": {
        "Прессы": ["пресс", "гидравлический"],
        "Новая категория": ["ключевое слово 1", "ключевое слово 2"],
    },
}
```

## 🛠 API Endpoints

Парсер использует следующие endpoints:

- `POST /parser/parse-url` - Парсинг одного товара
- `GET /parser/sitemap/parse` - Получение URL из sitemap
- `GET /products` - Список товаров
- `POST /products` - Создание товара
- `PATCH /products/:id` - Обновление товара
- `GET /categories` - Список категорий
- `POST /categories` - Создание категории
- `GET /facet-filters` - Список фильтров
- `POST /facet-filters` - Создание фильтра

## 📄 Лицензия

UNLICENSED
