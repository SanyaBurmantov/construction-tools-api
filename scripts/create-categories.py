import requests
from urllib.parse import urlparse

BASE_API = "http://localhost:3000"

# 1. Получаем все URL из sitemap
print("=== Получаем URL из sitemap ===")
resp = requests.post(f"{BASE_API}/parser/sitemap/parse", json={
    "sitemapUrl": "https://th-tool.by/sitemap.xml",
    "productPattern": "/category/"
})
data = resp.json()
category_urls = [u for u in data['productUrls'] if '/category/' in u and '/photos/' not in u]
print(f"Найдено категорий: {len(category_urls)}")

# 2. Создаем дерево категорий
print("\n=== Создаем категории ===")
category_map = {}  # slug -> id

# Сортируем по глубине (сначала короткие пути)
sorted_urls = sorted(category_urls, key=lambda u: u.count('/'))

for url in sorted_urls[:100]:  # Ограничим для теста
    path = urlparse(url).path.replace('/category/', '')
    parts = [p for p in path.split('/') if p]
    
    if not parts:
        continue
    
    parent_id = None
    current_path = []
    
    for i, slug in enumerate(parts):
        current_path.append(slug)
        full_slug = '/'.join(current_path)
        
        if full_slug in category_map:
            parent_id = category_map[full_slug]
            continue
        
        # Создаем категорию
        name = slug.replace('-', ' ').title()
        cat_data = {
            "name": name,
            "slug": slug,
            "depth": i
        }
        if parent_id:
            cat_data["parentId"] = parent_id
        
        resp = requests.post(f"{BASE_API}/categories", json=cat_data)
        if resp.ok:
            cat = resp.json()
            category_map[full_slug] = cat['id']
            parent_id = cat['id']
            print(f"✓ {name} (depth={i})")
        else:
            print(f"✗ Ошибка: {slug} - {resp.text[:100]}")
            break

print(f"\nСоздано категорий: {len(category_map)}")
