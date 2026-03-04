import requests

BASE_API = "http://localhost:3000"

print("=== Привязываем товары к категориям ===")

# Получаем все категории
cats_resp = requests.get(f"{BASE_API}/categories")
categories = cats_resp.json()

# Создаем мапу slug -> id
slug_to_id = {c['slug'].lower(): c['id'] for c in categories}

# Получаем товары без категории
page = 1
updated = 0
total_processed = 0

while True:
    resp = requests.get(f"{BASE_API}/products", params={"limit": 100, "page": page})
    data = resp.json()
    products = data['data']
    
    if not products:
        break
    
    for p in products:
        if p.get('categoryId'):
            continue  # Уже с категорией
        
        total_processed += 1
        url = p.get('sourceUrl', '')
        name = p.get('name', '').lower()
        
        # Пытаемся найти категорию по slug в URL или названии
        matched_cat = None
        for slug, cat_id in slug_to_id.items():
            if slug in url.lower() or slug in name:
                matched_cat = cat_id
                break
        
        if matched_cat:
            # Обновляем товар
            update_resp = requests.patch(
                f"{BASE_API}/products/{p['id']}",
                json={"categoryId": matched_cat}
            )
            if update_resp.ok:
                updated += 1
                if updated <= 10:
                    print(f"✓ {p['name'][:40]}... -> категория {matched_cat}")
    
    page += 1
    if page > 20:  # Ограничим для скорости
        break

print(f"\nОбновлено: {updated} товаров из {total_processed}")
