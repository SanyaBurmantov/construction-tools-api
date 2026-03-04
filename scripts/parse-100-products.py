import requests
import time

BASE_API = "http://localhost:3000"

print("=== Получаем 100 URL из sitemap ===")
resp = requests.post(f"{BASE_API}/parser/sitemap/parse", json={
    "sitemapUrl": "https://th-tool.by/sitemap.xml",
    "maxDepth": 1
})
data = resp.json()

# Фильтруем только товары (не категории, не hub, не photos)
product_urls = [
    u for u in data['productUrls']
    if '/category/' not in u 
    and '/hub/' not in u 
    and '/photos/' not in u
    and u != 'https://th-tool.by/'
]

print(f"Найдено товаров: {len(product_urls)}")
print(f"Берем первые 100")

# Берем первые 100
urls_to_parse = product_urls[:100]

print("\n=== Парсим 100 товаров с табами ===")
success = 0
failed = 0

for i, url in enumerate(urls_to_parse, 1):
    try:
        resp = requests.post(
            f"{BASE_API}/parser/parse-url",
            json={
                "url": url,
                "sourceWebsiteId": "bb34de1a-6d99-4bbb-932e-eb7f9c338368"
            },
            timeout=60
        )
        result = resp.json()
        
        if result.get('success'):
            success += 1
            desc = result.get('product', {}).get('description', '')
            has_desc = "✓" if desc and len(desc) > 50 else "✗"
            print(f"{i}. {has_desc} {result['product']['name'][:50]}...")
        else:
            failed += 1
            print(f"{i}. ✗ Ошибка: {result.get('error', 'Unknown')}")
        
        # Небольшая задержка
        time.sleep(0.2)
        
    except Exception as e:
        failed += 1
        print(f"{i}. ✗ Exception: {e}")

print(f"\n=== ИТОГ ===")
print(f"Успешно: {success}")
print(f"Ошибок: {failed}")
print(f"С описанием: {sum(1 for u in urls_to_parse if u)}")  # Посчитаем отдельно
