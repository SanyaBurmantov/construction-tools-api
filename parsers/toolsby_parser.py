"""
Tools.by Parser - Исправленная версия
"""

import requests
import re
import time
import logging
import subprocess
import json
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import urljoin

from configs.toolsby_config import (
    SITE_NAME, SITE_BASE_URL, SITE_BRANDS_URL, SOURCE_WEBSITE_ID,
    BATCH_CONFIG, LOG_CONFIG, EXCLUDE_PATTERNS, CATEGORY_HIERARCHY
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


class ToolsByParser:
    def __init__(self):
        self.category_cache = {}
        self.existing_products = {}
        self.stats = {
            'brands': 0,
            'categories': 0,
            'products_parsed': 0,
            'products_created': 0,
            'products_updated': 0,
            'errors': 0,
        }
    
    def get_brands(self) -> List[Dict]:
        """Получает список брендов"""
        logger.info("Получение списка брендов...")
        
        js_code = '''
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://tools.by/brands/', { waitUntil: 'networkidle', timeout: 30000 });
    
    const brands = [];
    const links = await page.$$('a[href*="/brands/"]');
    
    for (const link of links) {
        const text = await link.textContent();
        const href = await link.getAttribute('href');
        if (text && text.trim() && href) {
            const parts = text.trim().split('\\n').filter(t => t.trim());
            brands.push({
                name: parts[0]?.trim() || 'Unknown',
                category: parts[1]?.trim() || '',
                url: href.trim()
            });
        }
    }
    
    await browser.close();
    console.log(JSON.stringify(brands));
})().catch(e => console.error(JSON.stringify({error: e.message})));
'''
        
        try:
            result = subprocess.run([
                'docker', 'exec', 'construction-tools-api', 'node', '-e', js_code
            ], capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0:
                output = result.stdout.strip()
                match = re.search(r'\[.*\]', output, re.DOTALL)
                if match:
                    brands = json.loads(match.group())
                    logger.info(f"✓ Найдено {len(brands)} брендов")
                    return brands[:BATCH_CONFIG['brands_limit']]
            
            return []
        except Exception as e:
            logger.error(f"✗ Ошибка: {e}")
            return []
    
    def get_brand_categories(self, brand_url: str) -> List[Dict]:
        """Получает категории бренда"""
        js_code = f'''
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.launch({{ headless: true }});
    const page = await browser.newPage();
    await page.goto('{brand_url}', {{ waitUntil: 'networkidle', timeout: 30000 }});
    await page.waitForTimeout(3000);
    
    const links = await page.$$eval('a[href*="/catalog/"]', els => 
        els.map(el => ({{
            text: el.textContent ? el.textContent.trim() : '',
            href: el.getAttribute('href')
        }})).filter(l => l.text && l.href && l.text.length > 0)
    );
    
    console.log(JSON.stringify(links));
    await browser.close();
}})().catch(e => console.error(JSON.stringify({{error: e.message}})));
'''
        
        try:
            result = subprocess.run([
                'docker', 'exec', 'construction-tools-api', 'node', '-e', js_code
            ], capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0:
                output = result.stdout.strip()
                match = re.search(r'\[.*\]', output, re.DOTALL)
                if match:
                    categories = json.loads(match.group())
                    filtered = [
                        c for c in categories 
                        if not any(ex in c.get('href', '') for ex in EXCLUDE_PATTERNS)
                    ][:BATCH_CONFIG['categories_per_brand']]
                    logger.info(f"  ✓ Найдено {len(filtered)} категорий")
                    return filtered
            return []
        except Exception as e:
            logger.error(f"  ✗ Ошибка: {e}")
            return []
    
    def get_category_products(self, category_url: str) -> List[str]:
        """Получает товары из категории"""
        js_code = f'''
const {{ chromium }} = require('playwright');
(async () => {{
    const browser = await chromium.launch({{ headless: true }});
    const page = await browser.newPage();
    await page.goto('{category_url}', {{ waitUntil: 'networkidle', timeout: 30000 }});
    await page.waitForTimeout(3000);
    
    const products = await page.$$eval('a[href*="/product/"]', els =>
        els.map(el => el.getAttribute('href')).filter(h => h)
    );
    
    console.log(JSON.stringify([...new Set(products)]));
    await browser.close();
}})().catch(e => console.error(JSON.stringify({{error: e.message}})));
'''
        
        try:
            result = subprocess.run([
                'docker', 'exec', 'construction-tools-api', 'node', '-e', js_code
            ], capture_output=True, text=True, timeout=60)
            
            if result.returncode == 0:
                output = result.stdout.strip()
                match = re.search(r'\[.*\]', output, re.DOTALL)
                if match:
                    products = json.loads(match.group())
                    logger.info(f"    ✓ Найдено {len(products)} товаров")
                    return products
            return []
        except Exception as e:
            logger.error(f"    ✗ Ошибка: {e}")
            return []
    
    def load_existing_products(self):
        """Загружает существующие товары"""
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
                if p.get('sourceUrl'):
                    self.existing_products[f"url:{p['sourceUrl']}"] = p['id']
            page += 1
        logger.info(f"Загружено {len(self.existing_products)} записей")
    
    def slugify(self, text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', '-', text)
        return text[:100]
    
    def get_or_create_category(self, parent_name: str, child_name: str) -> Optional[str]:
        """Создает категорию"""
        parent_slug = self.slugify(parent_name)
        child_slug = self.slugify(child_name)
        cache_key = f"{parent_slug}_{child_slug}"
        
        if cache_key in self.category_cache:
            return self.category_cache[cache_key]
        
        resp = requests.get(f"{BASE_API}/categories", params={"sourceWebsiteId": SOURCE_WEBSITE_ID})
        categories = resp.json() if resp.ok else []
        
        parent = next((c for c in categories if c['slug'] == parent_slug), None)
        parent_id = parent['id'] if parent else None
        
        if parent_id:
            child = next((c for c in categories if c['slug'] == child_slug and c.get('parentId') == parent_id), None)
            if child:
                self.category_cache[cache_key] = child['id']
                return child['id']
        else:
            cat_data = {"name": parent_name, "slug": parent_slug, "depth": 0, "sourceWebsiteId": SOURCE_WEBSITE_ID}
            resp = requests.post(f"{BASE_API}/categories", json=cat_data)
            if resp.ok:
                parent_id = resp.json()['id']
        
        cat_data = {
            "name": child_name,
            "slug": child_slug,
            "depth": 1,
            "sourceWebsiteId": SOURCE_WEBSITE_ID,
            "parentId": parent_id
        }
        resp = requests.post(f"{BASE_API}/categories", json=cat_data)
        if resp.ok:
            cat = resp.json()
            self.category_cache[cache_key] = cat['id']
            logger.info(f"  ✓ Категория: {parent_name} > {child_name}")
            return cat['id']
        return None
    
    def detect_category(self, name: str) -> Optional[str]:
        """Определяет категорию"""
        name_lower = name.lower()
        for parent_cat, children in CATEGORY_HIERARCHY.items():
            for child_cat, keywords in children.items():
                for keyword in keywords:
                    if keyword in name_lower:
                        return self.get_or_create_category(parent_cat, child_name=child_cat)
        return self.get_or_create_category("Разное", "Прочее")
    
    def parse_product(self, url: str) -> Optional[Dict]:
        """Парсит товар"""
        try:
            resp = requests.post(
                f"{BASE_API}/parser/parse-url",
                json={"url": url, "sourceWebsiteId": SOURCE_WEBSITE_ID},
                timeout=120
            )
            
            if not resp.ok or not resp.json().get('success'):
                self.stats['errors'] += 1
                return None
            
            product = resp.json()['product']
            self.stats['products_parsed'] += 1
            
            if f"url:{url}" in self.existing_products:
                self.stats['products_updated'] += 1
                return product
            
            category_id = self.detect_category(product['name'])
            
            products_resp = requests.get(f"{BASE_API}/products", params={"limit": 1000})
            products = products_resp.json().get('data', []) if products_resp.ok else []
            db_product = next((p for p in products if p['sourceUrl'] == url), None)
            
            if db_product:
                requests.patch(f"{BASE_API}/products/{db_product['id']}", json={"categoryId": category_id})
                self.stats['products_updated'] += 1
            else:
                create_data = {
                    "name": product['name'],
                    "slug": self.slugify(product['name']),
                    "categoryId": category_id,
                    "sourceWebsiteId": SOURCE_WEBSITE_ID,
                    "sourceUrl": url,
                    "brand": product.get('brand'),
                    "price": product.get('price'),
                    "description": product.get('description'),
                    "specifications": product.get('specifications'),
                }
                resp = requests.post(f"{BASE_API}/products", json=create_data)
                if resp.ok:
                    self.stats['products_created'] += 1
                    self.existing_products[f"url:{url}"] = resp.json()['id']
            
            return product
        except Exception as e:
            self.stats['errors'] += 1
            logger.error(f"✗ Ошибка: {e}")
            return None
    
    def parse_all(self):
        """Запускает парсинг"""
        self.load_existing_products()
        brands = self.get_brands()
        
        if not brands:
            logger.error("✗ Не удалось получить бренды")
            return
        
        print("=" * 60)
        print(f"TOOLS.BY PARSER - {len(brands)} брендов")
        print("=" * 60)
        
        for i, brand in enumerate(brands, 1):
            logger.info(f"\n[{i}/{len(brands)}] Бренд: {brand['name']}")
            self.stats['brands'] += 1
            
            categories = self.get_brand_categories(brand['url'])
            
            for cat in categories:
                logger.info(f"  Категория: {cat.get('text', 'Unknown')}")
                self.stats['categories'] += 1
                
                product_urls = self.get_category_products(cat['href'])
                
                for url in product_urls:
                    if self.stats['products_parsed'] >= BATCH_CONFIG['products_limit']:
                        break
                    self.parse_product(url)
                    time.sleep(BATCH_CONFIG['delay'])
                
                if self.stats['products_parsed'] >= BATCH_CONFIG['products_limit']:
                    break
            
            if self.stats['products_parsed'] >= BATCH_CONFIG['products_limit']:
                break
        
        logger.info(f"""
============================================================
ИТОГИ:
  Брендов: {self.stats['brands']}
  Категорий: {self.stats['categories']}
  Товаров распаршено: {self.stats['products_parsed']}
  Товаров создано: {self.stats['products_created']}
  Товаров обновлено: {self.stats['products_updated']}
  Ошибок: {self.stats['errors']}
============================================================
""")


def main():
    parser = ToolsByParser()
    parser.parse_all()
    
    print("\n" + "=" * 60)
    print("ИТОГОВАЯ СТАТИСТИКА:")
    resp = requests.get(f'{BASE_API}/products?limit=1')
    if resp.ok:
        print(f"  Товаров в БД: {resp.json()['meta']['total']}")
    resp = requests.get(f'{BASE_API}/categories')
    if resp.ok:
        print(f"  Категорий: {len(resp.json())}")
    print("=" * 60)


if __name__ == "__main__":
    main()
