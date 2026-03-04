"""
Парсер с авто-категоризацией на основе характеристик товара
"""

import requests
import re
from typing import Dict, List, Optional

BASE_API = "http://localhost:3000"
SOURCE_WEBSITE_ID = "bb34de1a-6d99-4bbb-932e-eb7f9c338368"

class SmartParser:
    def __init__(self):
        self.category_map = {}  # name -> id
        
    def get_or_create_category(self, name: str, parent_id: Optional[str] = None) -> Optional[str]:
        """Создает или получает категорию"""
        slug = name.lower().replace(' ', '-').replace('_', '-')
        
        # Проверяем кэш
        if slug in self.category_map:
            return self.category_map[slug]
        
        # Ищем в API
        resp = requests.get(f"{BASE_API}/categories", params={"sourceWebsiteId": SOURCE_WEBSITE_ID})
        categories = resp.json() if resp.ok else []
        
        existing = next((c for c in categories if c['slug'] == slug), None)
        
        if existing:
            self.category_map[slug] = existing['id']
            print(f"  ✓ Категория найдена: {existing['name']}")
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
            self.category_map[slug] = cat['id']
            print(f"  ✓ Категория создана: {name}")
            return cat['id']
        
        return None
    
    def detect_category(self, product_name: str, specifications: Dict) -> Optional[str]:
        """Определяет категорию на основе названия и характеристик"""
        name_lower = product_name.lower()
        
        # Словарь ключевых слов для категорий
        category_keywords = {
            "Прессы": ["пресс", "гидравлический пресс", "пресс гидравлический"],
            "Генераторы": ["генератор", "электрогенератор", "бензогенератор"],
            "Компрессоры": ["компрессор", "пневмо", "воздушный"],
            "Инструмент": ["ключ", "головка", "отвертка", "плоскогубцы", "инструмент"],
            "Оборудование": ["оборудование", "станок", "машина"],
        }
        
        # Проверяем название
        for category, keywords in category_keywords.items():
            for keyword in keywords:
                if keyword in name_lower:
                    return self.get_or_create_category(category)
        
        # Проверяем характеристики
        for key, value in specifications.items():
            value_str = str(value).lower()
            for category, keywords in category_keywords.items():
                for keyword in keywords:
                    if keyword in value_str:
                        return self.get_or_create_category(category)
        
        # По умолчанию
        return self.get_or_create_category("Разное")
    
    def create_facet_filters(self, category_id: str, specifications: Dict):
        """Создает фасетные фильтры"""
        if not specifications:
            return
        
        # Словарь для группировки фильтров
        filter_types = {
            "Бренд": "SELECT",
            "Вес": "RANGE",
            "Мощн": "RANGE",
            "Объем": "RANGE",
            "Давлен": "RANGE",
            "Код": "SELECT",
            "Цена": "RANGE",
            "Штрихкод": "SELECT",
        }
        
        created_filters = set()
        
        for key, value in specifications.items():
            key_lower = key.lower().strip()
            
            # Определяем тип
            filter_type = "SELECT"
            for pattern, ftype in filter_types.items():
                if pattern.lower() in key_lower:
                    filter_type = ftype
                    break
            
            # Пропускаем дубликаты
            filter_name = key.strip()
            if filter_name in created_filters:
                continue
            
            # Создаем фильтр
            filter_data = {
                "name": filter_name,
                "field": f"specifications.{filter_name}",
                "type": filter_type,
                "categoryId": category_id,
            }
            
            # Проверяем существование
            resp = requests.get(f"{BASE_API}/facet-filters", params={"categoryId": category_id})
            existing = any(f['name'] == filter_name for f in (resp.json() if resp.ok else []))
            
            if not existing:
                resp = requests.post(f"{BASE_API}/facet-filters", json=filter_data)
                if resp.ok:
                    print(f"  ✓ Фильтр создан: {filter_name} ({filter_type})")
                    created_filters.add(filter_name)
    
    def parse_and_categorize(self, url: str) -> Optional[Dict]:
        """Парсит товар и автоматически определяет категорию"""
        print(f"\n=== Парсинг: {url} ===")
        
        # Парсим товар
        resp = requests.post(
            f"{BASE_API}/parser/parse-url",
            json={"url": url, "sourceWebsiteId": SOURCE_WEBSITE_ID},
            timeout=120
        )
        
        if not resp.ok or not resp.json().get('success'):
            print(f"✗ Ошибка: {resp.text}")
            return None
        
        product = resp.json()['product']
        print(f"✓ Название: {product['name']}")
        
        # Определяем категорию
        category_id = self.detect_category(
            product['name'],
            product.get('specifications', {})
        )
        
        if category_id:
            # Находим товар в БД и привязываем категорию
            products_resp = requests.get(f"{BASE_API}/products", params={"limit": 1000})
            products = products_resp.json().get('data', []) if products_resp.ok else []
            db_product = next((p for p in products if p['sourceUrl'] == url), None)
            
            if db_product:
                requests.patch(f"{BASE_API}/products/{db_product['id']}", json={"categoryId": category_id})
                print(f"✓ Категория привязана: {category_id}")
                
                # Создаем фильтры
                if product.get('specifications'):
                    self.create_facet_filters(category_id, product['specifications'])
        
        # Выводим информацию
        print(f"\n📦 Товар:")
        print(f"  Бренд: {product.get('brand', 'N/A')}")
        print(f"  Цена: {product.get('price', 'N/A')} BYN")
        print(f"  Характеристики: {len(product.get('specifications', {}))} шт")
        
        return product


def main():
    parser = SmartParser()
    
    # Тестовые URL
    test_urls = [
        "https://th-tool.by/press-gidravlicheskiy-100t_1/",
        "https://th-tool.by/generator-avtonomnyy-benzinovyy-1670-5000vt-nom-3-roz-220v-50gts-roz-400v-dvig-13l-s-bak-dlya-benzina-25l-benzin-ai-92-vremya-rab-8ch-shum-97db/",
    ]
    
    print("=" * 60)
    print("УМНЫЙ ПАРСЕР С АВТО-КАТЕГОРИЗАЦИЕЙ")
    print("=" * 60)
    
    for url in test_urls:
        parser.parse_and_categorize(url)
    
    print("\n" + "=" * 60)
    print("ГОТОВО!")
    print("=" * 60)
    
    # Статистика
    print("\n📊 СТАТИСТИКА:")
    print(f"  Создано категорий: {len(parser.category_map)}")
    
    resp = requests.get(f"{BASE_API}/products?limit=1")
    if resp.ok:
        print(f"  Товаров в БД: {resp.json()['meta']['total']}")
    
    resp = requests.get(f"{BASE_API}/categories")
    if resp.ok:
        print(f"  Категорий в БД: {len(resp.json())}")
    
    resp = requests.get(f"{BASE_API}/facet-filters")
    if resp.ok:
        print(f"  Фасетных фильтров: {len(resp.json())}")


if __name__ == "__main__":
    main()
