"""
Простой скрипт для парсинга 1000 товаров с tools.by
"""

import requests
import re
import time
import logging
import subprocess
import json
from datetime import datetime
from typing import List, Dict

BASE_API = "http://localhost:3000"
SOURCE_WEBSITE_ID = "bd67f3ee-4377-4065-8cb5-916580cfc584"
LIMIT = 1000

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    handlers=[
        logging.FileHandler(f'parse_toolsby_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def get_brands(limit: int = 50) -> List[Dict]:
    """Получает список брендов"""
    logger.info("Получение списка брендов...")
    
    js_code = '''
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://tools.by/brands/', { waitUntil: 'networkidle', timeout: 30000 });

    const brands = [];
    const links = await page.$$eval('a[href*="/brands/"]', els =>
        els.map(el => ({
            text: el.textContent ? el.textContent.trim() : '',
            href: el.getAttribute('href')
        })).filter(l => l.text && l.href && l.text.length > 0)
    );

    for (const brand of links) {
        const parts = brand.text.split('\\n').filter(t => t.trim());
        if (parts.length > 0) {
            brands.push({
                name: parts[0]?.trim() || 'Unknown',
                category: parts[1]?.trim() || '',
                url: brand.href.trim()
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
                brands = json.loads(match.group())[:limit]
                logger.info(f"✓ Найдено {len(brands)} брендов")
                return brands
        
        return []
    except Exception as e:
        logger.error(f"Ошибка: {e}")
        return []


def get_brand_categories(brand_url: str, limit: int = 20) -> List[Dict]:
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
                categories = json.loads(match.group())[:limit]
                logger.info(f"  ✓ Найдено {len(categories)} категорий")
                return categories
        
        return []
    except Exception as e:
        logger.error(f"  Ошибка: {e}")
        return []


def get_category_products(category_url: str) -> List[str]:
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
        logger.error(f"    Ошибка: {e}")
        return []


def parse_product(url: str, session: requests.Session) -> bool:
    """Парсит товар"""
    try:
        resp = session.post(
            f"{BASE_API}/parser/parse-url",
            json={"url": url, "sourceWebsiteId": SOURCE_WEBSITE_ID},
            timeout=120
        )
        
        if resp.ok and resp.json().get('success'):
            product = resp.json()['product']
            logger.info(f"    ✓ {product.get('name', 'Unknown')[:50]}")
            return True
        else:
            logger.error(f"    ✗ {url[:50]}... - {resp.text[:100]}")
            return False
    except Exception as e:
        logger.error(f"    ✗ {url[:50]}... - {e}")
        return False


def main():
    logger.info("=" * 60)
    logger.info("ПАРСИНГ TOOLS.BY - 1000 ТОВАРОВ")
    logger.info("=" * 60)
    
    # Получаем бренды
    brands = get_brands(limit=50)
    
    if not brands:
        logger.error("Не удалось получить бренды")
        return
    
    # Парсим
    session = requests.Session()
    total_products = 0
    success = 0
    errors = 0
    
    start_time = datetime.now()
    
    for i, brand in enumerate(brands, 1):
        logger.info(f"\n[{i}/{len(brands)}] Бренд: {brand['name']}")
        
        # Получаем категории
        categories = get_brand_categories(brand['url'], limit=20)
        
        for cat in categories:
            logger.info(f"  Категория: {cat.get('text', 'Unknown')}")
            
            # Получаем товары
            product_urls = get_category_products(cat['href'])
            
            for url in product_urls:
                if total_products >= LIMIT:
                    logger.info(f"\n✓ Достигнут лимит: {LIMIT} товаров")
                    break
                
                total_products += 1
                logger.info(f"    [{total_products}/{LIMIT}] {url[:60]}...")
                
                if parse_product(url, session):
                    success += 1
                else:
                    errors += 1
                
                time.sleep(0.5)
            
            if total_products >= LIMIT:
                break
        
        if total_products >= LIMIT:
            break
    
    # Итоги
    elapsed = (datetime.now() - start_time).total_seconds() / 60
    
    logger.info("\n" + "=" * 60)
    logger.info("ПАРСИНГ ЗАВЕРШЕН!")
    logger.info(f"Брендов: {len(brands)}")
    logger.info(f"Всего товаров: {total_products}")
    logger.info(f"✓ Успешно: {success}")
    logger.info(f"✗ Ошибки: {errors}")
    logger.info(f"⏱ Время: {elapsed:.1f} мин")
    logger.info("=" * 60)
    
    # Статистика из БД
    try:
        resp = requests.get(f'{BASE_API}/products?limit=1', timeout=10)
        if resp.ok:
            logger.info(f"Товаров в БД: {resp.json()['meta']['total']}")
    except:
        pass


if __name__ == "__main__":
    main()
