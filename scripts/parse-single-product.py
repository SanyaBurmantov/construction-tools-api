import requests
from urllib.parse import urlparse, urljoin
import json

BASE_API = "http://localhost:3000"
SOURCE_WEBSITE_ID = "bb34de1a-6d99-4bbb-932e-eb7f9c338368"  # th-tool.by

def get_or_create_category(path, source_website_id):
    """Создает или получает категорию по пути"""
    parts = [p for p in path.strip('/').split('/') if p]
    
    parent_id = None
    category_id = None
    
    for i, slug in enumerate(parts):
        # Проверяем существующую категорию
        resp = requests.get(f"{BASE_API}/categories", params={"sourceWebsiteId": source_website_id})
        categories = resp.json()
        
        # Ищем категорию с таким slug
        existing = next((c for c in categories if c['slug'] == slug.lower() and c.get('parentId') == parent_id), None)
        
        if existing:
            category_id = existing['id']
            parent_id = category_id
            print(f"  ✓ Категория найдена: {existing['name']}")
        else:
            # Создаем новую
            name = slug.replace('-', ' ').title()
            cat_data = {
                "name": name,
                "slug": slug.lower(),
                "depth": i,
                "sourceWebsiteId": source_website_id
            }
            if parent_id:
                cat_data["parentId"] = parent_id
            
            resp = requests.post(f"{BASE_API}/categories", json=cat_data)
            if resp.ok:
                cat = resp.json()
                category_id = cat['id']
                parent_id = category_id
                print(f"  ✓ Категория создана: {name}")
            else:
                print(f"  ✗ Ошибка: {resp.text[:100]}")
                break
    
    return category_id

def parse_single_product(url):
    """Парсит один товар со всей информацией"""
    print(f"\n=== Парсинг: {url} ===")
    
    # 1. Парсим товар через API
    resp = requests.post(
        f"{BASE_API}/parser/parse-url",
        json={"url": url, "sourceWebsiteId": SOURCE_WEBSITE_ID},
        timeout=120
    )
    
    if not resp.ok:
        print(f"✗ Ошибка парсинга: {resp.text}")
        return None
    
    result = resp.json()
    if not result.get('success'):
        print(f"✗ Ошибка: {result.get('error')}")
        return None
    
    product = result['product']
    print(f"✓ Название: {product['name']}")
    
    # 2. Извлекаем категорию из URL
    path = urlparse(url).path
    # Убираем последний сегмент (это товар)
    category_path = '/'.join(path.strip('/').split('/')[:-1])
    
    if category_path:
        print(f"✓ Путь категории: {category_path}")
        category_id = get_or_create_category(category_path, SOURCE_WEBSITE_ID)
        
        if category_id:
            # Обновляем товар с категорией
            product_id = product.get('sourceId') or url
            # Ищем товар в БД
            products_resp = requests.get(f"{BASE_API}/products")
            products = products_resp.json()['data']
            db_product = next((p for p in products if p['sourceUrl'] == url), None)
            
            if db_product:
                requests.patch(f"{BASE_API}/products/{db_product['id']}", json={"categoryId": category_id})
                print(f"✓ Категория привязана: {category_id}")
    
    # 3. Выводим всю информацию
    print(f"\n📦 Информация о товаре:")
    print(f"  Название: {product.get('name', 'N/A')}")
    print(f"  Бренд: {product.get('brand', 'N/A')}")
    print(f"  Артикул: {product.get('article', 'N/A')}")
    print(f"  Штрихкод: {product.get('barcode', 'N/A')}")
    print(f"  Цена: {product.get('price', 'N/A')} BYN")
    print(f"  Старая цена: {product.get('oldPrice', 'N/A')} BYN")
    print(f"  Наличие: {product.get('inStock', 'N/A')}")
    print(f"  Вес: {product.get('weight', 'N/A')} кг")
    
    if product.get('description'):
        print(f"  Описание: {product['description'][:200]}...")
    
    if product.get('specifications'):
        print(f"  Характеристики ({len(product['specifications'])} шт):")
        for k, v in product['specifications'].items():
            print(f"    • {k}: {v}")
    
    if product.get('features'):
        print(f"  Особенности: {product['features']}")
    
    return product

# Тестовый URL
url = "https://th-tool.by/press-gidravlicheskiy-100t_1/"
parse_single_product(url)

print("\n=== Готово! ===")
