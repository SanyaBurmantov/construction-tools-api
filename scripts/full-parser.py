"""
Комплексный парсер товаров с авто-созданием:
- Категорий (из breadcrumb)
- Фасетных фильтров (на основе характеристик)
- Товаров (со всей информацией)
"""

import requests
from urllib.parse import urlparse, urljoin
import re
import time
from typing import Dict, List, Optional, Tuple

BASE_API = "http://localhost:3000"
SOURCE_WEBSITE_ID = "bb34de1a-6d99-4bbb-932e-eb7f9c338368"  # th-tool.by

class ThToolParser:
    def __init__(self, source_website_id: str = SOURCE_WEBSITE_ID):
        self.source_website_id = source_website_id
        self.category_cache = {}  # slug -> id
        self.filter_cache = {}  # category_id -> filters
        
    def get_breadcrumbs_from_url(self, url: str) -> List[Dict]:
        """Извлекает категории из URL"""
        path = urlparse(url).path.strip('/')
        parts = [p for p in path.split('/') if p]
        
        # Убираем последний элемент (это товар)
        if len(parts) > 1:
            parts = parts[:-1]
        
        breadcrumbs = []
        for i, part in enumerate(parts):
            breadcrumbs.append({
                "name": part.replace('-', ' ').title(),
                "url": '/' + '/'.join(parts[:i+1])
            })
        
        return breadcrumbs
    
    def get_breadcrumbs_from_page(self, url: str) -> List[Dict]:
        """Извлекает хлебные крошки со страницы товара (резервный метод)"""
        # Сначала пробуем из URL
        breadcrumbs = self.get_breadcrumbs_from_url(url)
        if breadcrumbs:
            return breadcrumbs
        
        # Если не получилось - пробуем со страницы
        try:
            import subprocess
            result = subprocess.run([
                'docker', 'exec', 'construction-tools-api', 'node', '-e',
                f'''
                const {{ chromium }} = require('playwright');
                (async () => {{
                    const browser = await chromium.launch({{ headless: true }});
                    const page = await browser.newPage();
                    await page.goto('{url}', {{ waitUntil: 'networkidle', timeout: 30000 }});
                    
                    // Ищем хлебные крошки
                    const breadcrumbs = [];
                    const crumbElements = await page.$$('.breadcrumbs a, .breadcrumb a, .nav a, [class*="breadcrumb"] a');
                    
                    for (const el of crumbElements) {{
                        const text = await el.textContent();
                        const href = await el.getAttribute('href');
                        if (text && text.trim() && href) {{
                            breadcrumbs.push({{
                                name: text.trim(),
                                url: href.trim()
                            }});
                        }}
                    }}
                    
                    await browser.close();
                    console.log(JSON.stringify(breadcrumbs));
                }})().catch(e => console.error(JSON.stringify({{error: e.message}})));
                '''
            ], capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0:
                import json
                output = result.stdout.strip()
                # Находим JSON в выводе
                match = re.search(r'\[.*\]', output, re.DOTALL)
                if match:
                    return json.loads(match.group())
            
            return []
        except Exception as e:
            print(f"  ✗ Ошибка получения breadcrumbs: {e}")
            return []
    
    def get_or_create_category(self, path: str, parent_id: Optional[str] = None, depth: int = 0) -> Optional[str]:
        """Создает или получает категорию по пути"""
        parts = [p for p in path.strip('/').split('/') if p]
        
        if not parts:
            return parent_id
        
        current_parent = parent_id
        
        for i, part in enumerate(parts):
            slug = part.lower().replace('_', '-')
            full_path = '/'.join(parts[:i+1])
            
            # Проверяем кэш
            if full_path in self.category_cache:
                current_parent = self.category_cache[full_path]
                continue
            
            # Ищем в API
            resp = requests.get(f"{BASE_API}/categories", params={"sourceWebsiteId": self.source_website_id})
            categories = resp.json() if resp.ok else []
            
            existing = next((c for c in categories if c['slug'] == slug and c.get('parentId') == current_parent), None)
            
            if existing:
                self.category_cache[full_path] = existing['id']
                current_parent = existing['id']
                print(f"  ✓ Категория найдена: {existing['name']}")
            else:
                # Создаем новую
                name = part.replace('-', ' ').title()
                cat_data = {
                    "name": name,
                    "slug": slug,
                    "depth": depth + i,
                    "sourceWebsiteId": self.source_website_id
                }
                if current_parent:
                    cat_data["parentId"] = current_parent
                
                resp = requests.post(f"{BASE_API}/categories", json=cat_data)
                if resp.ok:
                    cat = resp.json()
                    self.category_cache[full_path] = cat['id']
                    current_parent = cat['id']
                    print(f"  ✓ Категория создана: {name}")
                else:
                    print(f"  ✗ Ошибка создания категории: {resp.text[:100]}")
                    break
        
        return current_parent
    
    def create_facet_filters(self, category_id: str, specifications: Dict):
        """Создает фасетные фильтры на основе характеристик"""
        if not specifications:
            return
        
        # Определяем типы фильтров
        filters_to_create = []
        
        for key, value in specifications.items():
            key_lower = key.lower().strip()
            
            # Определяем тип фильтра
            filter_type = "SELECT"  # по умолчанию
            
            # Проверяем на числовые значения
            try:
                num_value = float(str(value).replace(',', '.').replace(' кг', '').replace(' Вт', '').strip())
                if 'цена' in key_lower or 'вес' in key_lower or 'мощн' in key_lower or 'объем' in key_lower:
                    filter_type = "RANGE"
            except:
                pass
            
            # Проверяем на булевы значения
            if any(word in key_lower for word in ['наличие', 'доступн', 'новый']):
                filter_type = "BOOLEAN"
            
            filters_to_create.append({
                "name": key.strip(),
                "field": f"specifications.{key.strip()}",
                "type": filter_type,
                "categoryId": category_id,
                "config": {"unit": self.extract_unit(key)} if self.extract_unit(key) else None
            })
        
        # Создаем фильтры
        for filter_data in filters_to_create:
            # Проверяем существование
            existing = self.get_existing_filter(category_id, filter_data["name"])
            if existing:
                continue
            
            resp = requests.post(f"{BASE_API}/facet-filters", json=filter_data)
            if resp.ok:
                print(f"  ✓ Фильтр создан: {filter_data['name']} ({filter_data['type']})")
            else:
                print(f"  ✗ Ошибка создания фильтра: {resp.text[:100]}")
    
    def get_existing_filter(self, category_id: str, name: str) -> Optional[Dict]:
        """Проверяет существование фильтра"""
        resp = requests.get(f"{BASE_API}/facet-filters", params={"categoryId": category_id})
        filters = resp.json() if resp.ok else []
        return next((f for f in filters if f['name'] == name), None)
    
    def extract_unit(self, key: str) -> Optional[str]:
        """Извлекает единицу измерения из названия"""
        units = {
            'вес': 'кг',
            'мощн': 'Вт',
            'объем': 'л',
            'длин': 'м',
            'ширин': 'м',
            'высот': 'м',
            'давлен': 'бар',
            'температур': '°C',
        }
        key_lower = key.lower()
        for pattern, unit in units.items():
            if pattern in key_lower:
                return unit
        return None
    
    def parse_product(self, url: str) -> Optional[Dict]:
        """Парсит товар со всей информацией"""
        print(f"\n=== Парсинг: {url} ===")
        
        # 1. Парсим товар через API
        resp = requests.post(
            f"{BASE_API}/parser/parse-url",
            json={"url": url, "sourceWebsiteId": self.source_website_id},
            timeout=120
        )
        
        if not resp.ok or not resp.json().get('success'):
            print(f"✗ Ошибка парсинга: {resp.text}")
            return None
        
        product = resp.json()['product']
        print(f"✓ Название: {product['name']}")
        
        # 2. Извлекаем и создаем категории из breadcrumb
        breadcrumbs = self.get_breadcrumbs_from_page(url)
        if breadcrumbs:
            print(f"✓ Найдено хлебных крошек: {len(breadcrumbs)}")
            # Исключаем последнюю (это сам товар) и первую (Главная)
            category_path = '/'.join([self.slugify(b['name']) for b in breadcrumbs[1:-1]])
            
            if category_path:
                category_id = self.get_or_create_category(category_path)
                
                if category_id:
                    # Находим товар в БД и обновляем категорию
                    products_resp = requests.get(f"{BASE_API}/products", params={"limit": 1000})
                    products = products_resp.json().get('data', []) if products_resp.ok else []
                    db_product = next((p for p in products if p['sourceUrl'] == url), None)
                    
                    if db_product:
                        requests.patch(f"{BASE_API}/products/{db_product['id']}", json={"categoryId": category_id})
                        print(f"✓ Категория привязана: {category_id}")
                        
                        # 3. Создаем фасетные фильтры для категории
                        if product.get('specifications'):
                            self.create_facet_filters(category_id, product['specifications'])
        
        # 4. Выводим информацию
        self.print_product_info(product)
        
        return product
    
    def slugify(self, text: str) -> str:
        """Преобразует текст в slug"""
        text = text.lower().strip()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', '-', text)
        return text
    
    def print_product_info(self, product: Dict):
        """Выводит информацию о товаре"""
        print(f"\n📦 Информация о товаре:")
        print(f"  Название: {product.get('name', 'N/A')}")
        print(f"  Бренд: {product.get('brand', 'N/A')}")
        print(f"  Артикул: {product.get('article', 'N/A')}")
        print(f"  Штрихкод: {product.get('barcode', 'N/A')}")
        print(f"  Цена: {product.get('price', 'N/A')} BYN")
        print(f"  Наличие: {product.get('inStock', 'N/A')}")
        print(f"  Вес: {product.get('weight', 'N/A')} кг")
        
        if product.get('description'):
            desc = product['description'][:200]
            print(f"  Описание: {desc}...")
        
        if product.get('specifications'):
            print(f"  Характеристики ({len(product['specifications'])} шт):")
            for k, v in product['specifications'].items():
                print(f"    • {k}: {v}")
    
    def parse_sitemap(self, sitemap_url: str, limit: int = 100) -> List[str]:
        """Получает URL товаров из sitemap"""
        print(f"\n=== Получение URL из sitemap ===")
        
        resp = requests.post(f"{BASE_API}/parser/sitemap/parse", json={
            "sitemapUrl": sitemap_url,
            "maxDepth": 1
        })
        
        if not resp.ok:
            print(f"✗ Ошибка: {resp.text}")
            return []
        
        data = resp.json()
        urls = data.get('productUrls', [])
        
        # Фильтруем только товары (не категории, не hub, не photos)
        product_urls = [
            u for u in urls
            if '/category/' not in u
            and '/hub/' not in u
            and '/photos/' not in u
            and u != 'https://th-tool.by/'
        ][:limit]
        
        print(f"✓ Найдено товаров: {len(product_urls)}")
        return product_urls


def main():
    parser = ThToolParser()
    
    # Тестовые URL
    test_urls = [
        "https://th-tool.by/press-gidravlicheskiy-100t_1/",
        "https://th-tool.by/generator-avtonomnyy-benzinovyy-1670-5000vt-nom-3-roz-220v-50gts-roz-400v-dvig-13l-s-bak-dlya-benzina-25l-benzin-ai-92-vremya-rab-8ch-shum-97db/",
    ]
    
    print("=" * 60)
    print("КОМПЛЕКСНЫЙ ПАРСЕР TH-TOOL.BY")
    print("=" * 60)
    
    for url in test_urls:
        parser.parse_product(url)
    
    print("\n" + "=" * 60)
    print("ГОТОВО!")
    print("=" * 60)
    
    # Показываем статистику
    print("\n📊 СТАТИСТИКА:")
    print(f"  Создано категорий: {len(parser.category_cache)}")
    
    # Проверяем товары в БД
    resp = requests.get(f"{BASE_API}/products?limit=1")
    if resp.ok:
        data = resp.json()
        print(f"  Товаров в БД: {data['meta']['total']}")
    
    # Проверяем категории
    resp = requests.get(f"{BASE_API}/categories")
    if resp.ok:
        print(f"  Категорий в БД: {len(resp.json())}")
    
    # Проверяем фильтры
    resp = requests.get(f"{BASE_API}/facet-filters")
    if resp.ok:
        print(f"  Фасетных фильтров: {len(resp.json())}")


if __name__ == "__main__":
    main()
