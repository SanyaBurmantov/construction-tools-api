"""
Конфигурация для сайта tools.by
Парсинг через бренды → категории → товары
"""

# Основная информация
SITE_NAME = "Tools.by"
SITE_BASE_URL = "https://tools.by"
SITE_BRANDS_URL = "https://tools.by/brands/"
SITE_SITEMAP = None  # Используем парсинг брендов

# ID источника в БД (создается один раз)
SOURCE_WEBSITE_ID = "e5bd13ac-3f1a-486a-8fef-c9cc039cce04"  # tools.by

# Настройки парсера
PARSER_CONFIG = {
    "usePlaywright": True,
    "waitForSelector": "h1",
    "waitForTimeout": 10000,
    "clickTabs": True,
}

# CSS селекторы для извлечения данных
PARSER_SELECTORS = {
    "name": "h1",
    "price": "[data-test=\"product-price-current\"], .ProductPrice__current, .product-price",
    "oldPrice": "[data-test=\"product-price-old\"], .ProductPrice__old",
    "brand": "[data-test=\"product-brand\"] a, .ProductCardInfo__brand a",
    "article": "[data-test=\"product-article\"], .ProductCardInfo__article",
    "inStock": "[data-test=\"product-stock\"], .ProductStock",
    "specifications": {
        "container": "[data-test=\"product-specs\"] table, .ProductSpecs table, .characteristics table",
        "item": "tr",
        "key": "td:first-child, th:first-child",
        "value": "td:last-child, th:last-child"
    },
    "images": ".ProductGallery img, .product-gallery img",
    "mainImage": ".ProductGallery img:first-child",
    "description": ".product-description, .ProductDescription",
}

# Иерархия категорий (будет заполняться автоматически из каталога)
CATEGORY_HIERARCHY = {
    "Электроинструмент": {
        "Дрели-шуруповерты": ["дрель", "шуруповерт"],
        "Болгарки": ["болгарка", "углошлиф", "шлифмашина"],
        "Лобзики": ["лобзик"],
        "Пилы": ["пила", "циркулярн", "дисков"],
        "Перфораторы": ["перфоратор"],
        "Рубанки": ["рубанок"],
        "Фрезеры": ["фрезер"],
    },
    "Садовая техника": {
        "Газонокосилки": ["газонокосил", "триммер"],
        "Культиваторы": ["культиватор", "мотоблок"],
        "Цепные пилы": ["цепн", "бензопил", "электропил"],
        "Секаторы": ["секатор", "ножниц"],
    },
    "Ручной инструмент": {
        "Ключи": ["ключ"],
        "Отвертки": ["отверт"],
        "Плоскогубцы": ["плоскогубц", "пассатиж"],
        "Молотки": ["молоток", "киянк"],
        "Наборы": ["набор", "комплект"],
    },
    "Автотовары": {
        "Домкраты": ["домкрат"],
        "Наборы инструмента": ["набор инструмент"],
    },
    "Сварочное оборудование": {
        "Сварочные аппараты": ["сварочн", "инвертор"],
        "Горелки": ["горелк"],
    },
    "Пневмоинструмент": {
        "Гайковерты": ["гайковерт"],
        "Дрели": ["пневмодрел"],
        "Шлифмашины": ["пневмошлиф"],
    },
    "Оборудование": {
        "Компрессоры": ["компрессор"],
        "Генераторы": ["генератор"],
        "Прессы": ["пресс"],
    },
    "Расходники": {
        "Круги": ["круг", "отрезной", "зачистной"],
        "Сверла": ["сверло", "бур"],
        "Биты": ["бита"],
        "Головки": ["головк"],
    },
}

# Единицы измерения для нормализации
UNITS = {
    'вес': {'кг': 'кг', 'г': 'г', 'gram': 'г', 'kg': 'кг'},
    'длина': {'м': 'м', 'см': 'см', 'мм': 'мм', 'm': 'м', 'cm': 'см', 'mm': 'мм'},
    'объем': {'л': 'л', 'мл': 'мл', 'l': 'л', 'ml': 'мл'},
    'мощность': {'вт': 'Вт', 'квт': 'кВт', 'w': 'Вт', 'kw': 'кВт', 'hp': 'л.с.'},
    'время': {'ч': 'ч', 'мин': 'мин', 'сек': 'сек', 'h': 'ч', 'm': 'мин'},
}

# URL для исключения
EXCLUDE_PATTERNS = [
    '/catalog/novelties',
    '/catalog/latest_arrivals',
    '/catalog/promotions',
    '/catalog/markdown',
]

# Настройки пакетной обработки
BATCH_CONFIG = {
    "brands_limit": 10,      # Лимит брендов для теста
    "categories_per_brand": 5,  # Лимит категорий на бренд
    "products_limit": 100,   # Общий лимит товаров
    "concurrency": 1,
    "delay": 0.5,
}

# Настройки логирования
LOG_CONFIG = {
    "level": "INFO",
    "format": "%(asctime)s - %(levelname)s - %(message)s",
    "file_prefix": "toolsby_parser_",
}
