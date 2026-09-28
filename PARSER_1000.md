# Запуск парсера на 1000 товаров

## ✅ Выполненные действия

1. **Обновлены конфигурационные файлы:**
   - `configs/thtool_config.py` - лимит изменен на 1000 товаров
   - `configs/toolsby_config.py` - лимит изменен на 1000 товаров
   - SOURCE_WEBSITE_ID обновлен для обоих сайтов

2. **Созданы SourceWebsite в БД:**
   - TH-Tool.by: `15c30daa-45d9-41f6-bc25-d9ff47b0c080`
   - Tools.by: `bd67f3ee-4377-4065-8cb5-916580cfc584`

3. **Настроена конфигурация парсера** для TH-Tool.by с правильными селекторами

4. **Созданы скрипты для массового парсинга:**
   - `scripts/parse-thtool-1000.py` - парсинг 1000 товаров с th-tool.by
   - `scripts/parse-toolsby-1000.py` - парсинг 1000 товаров с tools.by
   - `scripts/parse-1000-each.py` - парсинг обоих сайтов последовательно

## 🚀 Запуск парсера

### Вариант 1: Парсинг th-tool.by (1000 товаров)
```bash
python scripts/parse-thtool-1000.py
```

### Вариант 2: Парсинг tools.by (1000 товаров)
```bash
python scripts/parse-toolsby-1000.py
```

### Вариант 3: Парсинг обоих сайтов (по 1000 товаров с каждого)
```bash
python scripts/parse-1000-each.py
```

## 📊 Мониторинг прогресса

### Просмотр логов (PowerShell):
```powershell
# Последние строки лога th-tool.by
Get-ChildItem parse_thtool_*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 30

# Последние строки лога tools.by
Get-ChildItem parse_toolsby_*.log | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 30
```

### Проверка количества товаров в БД:
```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/products?limit=1' -Method Get | Select-Object -ExpandProperty meta
```

## ⏱️ Время парсинга

- **th-tool.by:** ~3.5 часа (1000 товаров, ~12 сек/товар)
- **tools.by:** ~8 часов (1000 товаров, ~25-30 сек/товар из-за обхода брендов)

## 🛑 Остановка парсера

```bash
# Найти PID процесса
tasklist | findstr python

# Остановить процесс
taskkill /F /PID <PID>
```

## 📝 Логи

Логи сохраняются в файлы:
- `parse_thtool_YYYYMMDD_HHMMSS.log`
- `parse_toolsby_YYYYMMDD_HHMMSS.log`

## 🔧 Конфигурация

Для изменения лимита товаров отредактируйте:
- `configs/thtool_config.py` → `BATCH_CONFIG["limit"]`
- `configs/toolsby_config.py` → `BATCH_CONFIG["products_limit"]`

## 📦 Структура парсеров

```
parsers/
├── thtool_parser.py      # Основной парсер th-tool.by
├── toolsby_parser.py     # Основной парсер tools.by

scripts/
├── parse-thtool-1000.py  # Скрипт для 1000 товаров th-tool.by
├── parse-toolsby-1000.py # Скрипт для 1000 товаров tools.by
├── parse-1000-each.py    # Скрипт для обоих сайтов
├── pro-parser.py         # PRO-версия с расширенными функциями
└── full-parser.py        # Полная версия с категориями
```

## ✅ Что парсится

- Название товара
- Бренд
- Артикул
- Штрихкод
- Цена
- Наличие
- Описание
- Характеристики
- Изображения

## 🎯 Автоматическая категоризация

Парсеры автоматически:
1. Определяют категорию товара по названию
2. Создают категории если их нет
3. Привязывают товары к категориям
4. Создают фасетные фильтры для характеристик

---
**Дата создания:** 2026-03-04
**Версия:** 1.0
