"""
TH-Tool.by Parser
Специализированный парсер для сайта th-tool.by

Функции:
- Авто-категоризация с иерархией
- Нормализация характеристик
- Проверка дубликатов
- SEO-оптимизация
- Пакетная обработка
"""

import requests
import re
import time
import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Set
from urllib.parse import urlparse

# Импортируем конфигурацию
from configs.thtool_config import (
    SITE_NAME, SITE_BASE_URL, SITE_SITEMAP, SOURCE_WEBSITE_ID,
    PARSER_CONFIG, PARSER_SELECTORS, CATEGORY_HIERARCHY, UNITS,
    EXCLUDE_PATTERNS, BATCH_CONFIG, LOG_CONFIG
)

# Настройка логирования
logging.basicConfig(
    level=getattr(logging, LOG_CONFIG["level"]),
    format=LOG_CONFIG["format"],
    handlers=[
        logging.FileHandler(f"logs/{LOG_CONFIG['file_prefix']}{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

BASE_API = "http://localhost:3000"


class THToolParser:
    """Специализированный парсер для th-tool.by"""
    
    def __init__(self):
        self.category_cache = {}  # slug -> id
        self.existing_products = {}  # barcode/article/url -> id
        self.stats = {
            'parsed': 0,
            'updated': 0,
            'created': 0,
            'errors': 0,
            'duplicates': 0,
            'categories_created': 0,
            'filters_created': 0,
        }
    
    def load_existing_products(self):
        """Загружает существующие товары для проверки дубликатов"""
        logger.info("Загрузка существующих товаров...")
        page = 1
        while True:
            resp = requests.get(f"{BASE_API}/products", params={"limit": 100, "page": page})
            if not resp.ok:
                break
            data = resp.json()
            products = data.get('data', [])
            if not products:
                break
            
            for p in products:
                if p.get('barcode'):
                    self.existing_products[f"barcode:{p['barcode']}"] = p['id']
                if p.get('article'):
                    self.existing_products[f"article:{p['article']}"] = p['id']
                if p.get('sourceUrl'):
                    self.existing_products[f"url:{p['sourceUrl']}"] = p['id']
            
            page += 1
        
        logger.info(f"Загружено {len(self.existing_products)} записей")
    
    def check_duplicate(self, barcode: Optional[str], article: Optional[str], url: str) -> Optional[str]:
        """Проверяет дубликат по штрихкоду/артикулу/URL"""
        if barcode and f"barcode:{barcode}" in self.existing_products:
            return self.existing_products[f"barcode:{barcode}"]
        if article and f"article:{article}" in self.existing_products:
            return self.existing_products[f"article:{article}"]
        if url and f"url:{url}" in self.existing_products:
            return self.existing_products[f"url:{url}"]
        return None
    
    def detect_category(self, name: str, specs: Dict) -> Tuple[Optional[str], List[str]]:
        """
        Определяет категорию с иерархией (до 3 уровней)
        Возвращает (category_id, category_path)
        """
        name_lower = name.lower()
        
        # Ищем совпадения
        matches = []
        for parent_cat, children in CATEGORY_HIERARCHY.items():
            for child_cat, keywords in children.items():
                for keyword in keywords:
                    if keyword in name_lower:
                        matches.append((parent_cat, child_cat))
                    # Проверяем характеристики
                    for key, value in specs.items():
                        if keyword in str(value).lower():
                            matches.append((parent_cat, child_cat))
        
        if not matches:
            # Категория по умолчанию
            default_id = self.get_or_create_category("Разное")
            return default_id, ["Разное"]
        
        # Берем первое совпадение
        parent_name, child_name = matches[0]
        
        # Создаем/получаем родительскую категорию
        parent_id = self.get_or_create_category(parent_name)
        
        # Создаем/получаем дочернюю категорию
        child_id = self.get_or_create_category(child_name, parent_id)
        
        return child_id, [parent_name, child_name]
    
    def get_or_create_category(self, name: str, parent_id: Optional[str] = None) -> Optional[str]:
        """Создает или получает категорию"""
        slug = self.slugify(name)
        cache_key = f"{slug}_{parent_id or 'root'}"
        
        if cache_key in self.category_cache:
            return self.category_cache[cache_key]
        
        # Ищем в API
        resp = requests.get(f"{BASE_API}/categories", params={"sourceWebsiteId": SOURCE_WEBSITE_ID})
        categories = resp.json() if resp.ok else []
        
        existing = next((c for c in categories if c['slug'] == slug and c.get('parentId') == parent_id), None)
        
        if existing:
            self.category_cache[cache_key] = existing['id']
            logger.info(f"  ✓ Категория найдена: {existing['name']}")
            return existing['id']
        
        # Создаем новую
        cat_data = {
            "name": name,
            "slug": slug,
            "depth": 1 if parent_id else 0,
            "sourceWebsiteId": SOURCE_WEBSITE_ID
        }
        if parent_id:
            cat_data["parentId"] = parent_id
        
        resp = requests.post(f"{BASE_API}/categories", json=cat_data)
        if resp.ok:
            cat = resp.json()
            self.category_cache[cache_key] = cat['id']
            self.stats['categories_created'] += 1
            logger.info(f"  ✓ Категория создана: {name}")
            return cat['id']
        
        logger.error(f"  ✗ Ошибка создания категории: {resp.text[:100]}")
        return None
    
    def normalize_specification(self, key: str, value: str) -> Tuple[str, str]:
        """Нормализует название и значение характеристики"""
        key_normalized = key.strip().replace(':', '').title()
        value_str = str(value).strip()
        
        # Нормализация единиц измерения
        for measure_type, units in UNITS.items():
            if measure_type in key_normalized.lower():
                for unit_from, unit_to in units.items():
                    if unit_from.lower() in value_str.lower():
                        value_str = re.sub(
                            rf'[\d.,]+\s*{re.escape(unit_from)}',
                            lambda m: m.group().replace(unit_from, unit_to),
                            value_str,
                            flags=re.IGNORECASE
                        )
                        break
        
        return key_normalized, value_str
    
    def create_facet_filters(self, category_id: str, specifications: Dict):
        """Создает фасетные фильтры"""
        if not specifications:
            return
        
        # Типы фильтров по ключевым словам
        filter_patterns = {
            'RANGE': ['вес', 'мощн', 'объем', 'давлен', 'температур', 'длин', 'ширин', 'высот', 'цена', 'скорост', 'производит'],
            'SELECT': ['бренд', 'производит', 'материал', 'цвет', 'тип', 'форма', 'покрыт'],
            'BOOLEAN': ['наличие', 'доступн', 'новый', 'оригинал'],
        }
        
        for key, value in specifications.items():
            key_normalized, value_normalized = self.normalize_specification(key, value)
            
            # Определяем тип фильтра
            filter_type = "SELECT"
            key_lower = key_normalized.lower()
            
            for ftype, patterns in filter_patterns.items():
                if any(pattern in key_lower for pattern in patterns):
                    filter_type = ftype
                    break
            
            # Проверяем существование
            resp = requests.get(f"{BASE_API}/facet-filters", params={"categoryId": category_id})
            existing = any(f['name'] == key_normalized for f in (resp.json() if resp.ok else []))
            
            if not existing:
                filter_data = {
                    "name": key_normalized,
                    "field": f"specifications.{key_normalized}",
                    "type": filter_type,
                    "categoryId": category_id,
                }
                
                resp = requests.post(f"{BASE_API}/facet-filters", json=filter_data)
                if resp.ok:
                    self.stats['filters_created'] += 1
                    logger.info(f"  ✓ Фильтр создан: {key_normalized} ({filter_type})")
    
    def slugify(self, text: str) -> str:
        """Создает SEO-friendly slug"""
        text = text.lower().strip()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', '-', text)
        text = text[:100]
        return text
    
    def parse_product(self, url: str) -> Optional[Dict]:
        """Парсит товар со всей информацией"""
        try:
            # Парсим через API
            resp = requests.post(
                f"{BASE_API}/parser/parse-url",
                json={"url": url, "sourceWebsiteId": SOURCE_WEBSITE_ID},
                timeout=120
            )
            
            if not resp.ok:
                self.stats['errors'] += 1
                logger.error(f"✗ Ошибка HTTP: {resp.status_code}")
                return None
            
            result = resp.json()
            if not result.get('success'):
                self.stats['errors'] += 1
                logger.error(f"✗ Ошибка парсинга: {result.get('error')}")
                return None
            
            product = result['product']
            self.stats['parsed'] += 1
            
            # Проверяем дубликаты
            existing_id = self.check_duplicate(
                product.get('barcode'),
                product.get('article'),
                url
            )
            
            if existing_id:
                self.stats['duplicates'] += 1
                logger.info(f"  ⚠ Дубликат найден: {existing_id}")
                self.update_product(existing_id, product)
                return product
            
            # Определяем категорию
            category_id, category_path = self.detect_category(
                product['name'],
                product.get('specifications', {})
            )
            
            if category_id:
                logger.info(f"  Категория: {' > '.join(category_path)}")
            
            # Находим товар в БД
            products_resp = requests.get(f"{BASE_API}/products", params={"limit": 1000})
            products = products_resp.json().get('data', []) if products_resp.ok else []
            db_product = next((p for p in products if p['sourceUrl'] == url), None)
            
            if db_product:
                # Обновляем товар
                update_data = {
                    "categoryId": category_id,
                    **self.prepare_update_data(product)
                }
                requests.patch(f"{BASE_API}/products/{db_product['id']}", json=update_data)
                self.stats['updated'] += 1
                
                # Создаем фильтры
                if product.get('specifications'):
                    self.create_facet_filters(category_id, product['specifications'])
            else:
                # Создаем новый товар
                create_data = {
                    "name": product['name'],
                    "slug": self.slugify(product['name']),
                    "categoryId": category_id,
                    "sourceWebsiteId": SOURCE_WEBSITE_ID,
                    "sourceUrl": url,
                    **self.prepare_update_data(product)
                }
                resp = requests.post(f"{BASE_API}/products", json=create_data)
                if resp.ok:
                    self.stats['created'] += 1
                    logger.info(f"  ✓ Товар создан")
            
            return product
            
        except Exception as e:
            self.stats['errors'] += 1
            logger.error(f"✗ Исключение: {e}")
            return None
    
    def prepare_update_data(self, product: Dict) -> Dict:
        """Подготавливает данные для обновления"""
        update_data = {}
        
        # Основные поля
        for field in ['brand', 'model', 'article', 'barcode', 'price',
                      'description', 'weight', 'inStock', 'stockQuantity',
                      'images', 'mainImage', 'manufacturer', 'warranty',
                      'countryOfOrigin']:
            if field in product and product[field] is not None:
                update_data[field] = product[field]
        
        # Нормализация характеристик
        if product.get('specifications'):
            normalized_specs = {}
            for key, value in product['specifications'].items():
                k, v = self.normalize_specification(key, value)
                normalized_specs[k] = v
            update_data['specifications'] = normalized_specs
        
        # SEO meta-теги (упрощенные)
        name = product.get('name', '')
        brand = product.get('brand', '')
        price = product.get('price', '')
        
        update_data['metaTitle'] = f"{brand} {name} - купить | {price} BYN" if brand else f"{name} - купить"
        update_data['metaDescription'] = (product.get('description', '')[:160] if product.get('description') else name)[:160]
        update_data['metaKeywords'] = f"{brand}, {name}, купить, Минск" if brand else f"{name}, купить"
        
        return update_data
    
    def update_product(self, product_id: str, product: Dict):
        """Обновляет существующий товар"""
        update_data = self.prepare_update_data(product)
        requests.patch(f"{BASE_API}/products/{product_id}", json=update_data)
        logger.info(f"  ✓ Товар обновлен")
    
    def parse_sitemap(self, sitemap_url: str = SITE_SITEMAP, limit: int = 100) -> List[str]:
        """Получает URL из sitemap"""
        logger.info(f"Получение URL из sitemap: {sitemap_url}")
        
        resp = requests.post(f"{BASE_API}/parser/sitemap/parse", json={
            "sitemapUrl": sitemap_url,
            "maxDepth": 1
        })
        
        if not resp.ok:
            logger.error(f"✗ Ошибка: {resp.text}")
            return []
        
        data = resp.json()
        urls = data.get('productUrls', [])
        
        # Фильтруем
        product_urls = [
            u for u in urls
            if not any(pattern in u for pattern in EXCLUDE_PATTERNS)
        ][:limit]
        
        logger.info(f"✓ Найдено {len(product_urls)} товаров")
        return product_urls
    
    def parse_batch(self, urls: List[str], concurrency: int = None, delay: float = None):
        """Пакетный парсинг с прогрессом"""
        concurrency = concurrency or BATCH_CONFIG['concurrency']
        delay = delay or BATCH_CONFIG['delay']
        
        total = len(urls)
        logger.info(f"Запуск пакетного парсинга: {total} товаров")
        
        for i, url in enumerate(urls, 1):
            progress = (i / total) * 100
            logger.info(f"\n[{i}/{total}] {progress:.1f}% - {url[:60]}...")
            
            self.parse_product(url)
            
            # Прогресс
            if i % 10 == 0:
                self.print_stats()
            
            # Задержка
            time.sleep(delay)
        
        logger.info("\n" + "=" * 60)
        logger.info("ПАРСИНГ ЗАВЕРШЕН!")
        self.print_stats()
    
    def print_stats(self):
        """Вывод статистики"""
        logger.info(f"""
📊 СТАТИСТИКА:
  ✓ Распаршено: {self.stats['parsed']}
  ✓ Создано: {self.stats['created']}
  ✓ Обновлено: {self.stats['updated']}
  ⚠ Дубликаты: {self.stats['duplicates']}
  ✗ Ошибки: {self.stats['errors']}
  📁 Категорий создано: {self.stats['categories_created']}
  🔍 Фильтров создано: {self.stats['filters_created']}
""")


def main():
    """Точка входа"""
    parser = THToolParser()
    
    # Загружаем существующие товары
    parser.load_existing_products()
    
    # Получаем URL из sitemap
    urls = parser.parse_sitemap(limit=BATCH_CONFIG['limit'])
    
    if not urls:
        print("✗ Не удалось получить URL из sitemap")
        return
    
    print("=" * 60)
    print(f"TH-TOOL.BY PARSER - МАССОВЫЙ ПАРСИНГ {len(urls)} ТОВАРОВ")
    print("=" * 60)
    
    # Парсим
    parser.parse_batch(urls)
    
    # Финальная статистика
    print("\n" + "=" * 60)
    print("ИТОГОВАЯ СТАТИСТИКА:")
    
    resp = requests.get(f'{BASE_API}/products?limit=1')
    if resp.ok:
        print(f"  Товаров в БД: {resp.json()['meta']['total']}")
    
    resp = requests.get(f'{BASE_API}/categories')
    if resp.ok:
        print(f"  Категорий: {len(resp.json())}")
    
    resp = requests.get(f'{BASE_API}/facet-filters')
    if resp.ok:
        print(f"  Фильтров: {len(resp.json())}")
    
    print("=" * 60)


if __name__ == "__main__":
    main()
