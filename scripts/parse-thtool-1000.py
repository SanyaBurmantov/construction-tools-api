"""
Простой скрипт для парсинга 1000 товаров с th-tool.by
"""

import requests
import time
import logging
from datetime import datetime
from typing import List

BASE_API = "http://localhost:3000"
SOURCE_WEBSITE_ID = "15c30daa-45d9-41f6-bc25-d9ff47b0c080"
LIMIT = 1000

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    handlers=[
        logging.FileHandler(f'parse_thtool_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def parse_sitemap(limit: int = LIMIT) -> List[str]:
    """Получает URL товаров из sitemap"""
    logger.info(f"Получение URL из sitemap (лимит: {limit})...")
    
    resp = requests.post(f"{BASE_API}/parser/sitemap/parse", json={
        "sitemapUrl": "https://th-tool.by/sitemap.xml",
        "maxDepth": 1
    })
    
    if not resp.ok:
        logger.error(f"Ошибка: {resp.text}")
        return []
    
    data = resp.json()
    urls = data.get('productUrls', [])
    
    # Исключения для служебных страниц
    exclude_patterns = [
        '/category/', '/hub/', '/photos/',
        '/o-nas/', '/dealers/', '/garantii/', '/dostavka/', '/kontakty/',
        '/service-center/', '/obligatsii/', '/politika/', '/dostavka-i-oplata/',
        '/grafik-postavok/', '/zhurnaly/', '/instruktsii/', '/hit-sale/',
        '/utsenka/', '/aktsii/', '/novosti/', '/kontakty/', '/sitemap/',
        'cooperation', '/about/', '/blog/', '/news/'
    ]
    
    # Фильтруем - оставляем только товары (с подчеркиванием или цифрами в конце)
    product_urls = [
        u for u in urls
        if u != 'https://th-tool.by/'
        and not any(pattern in u for pattern in exclude_patterns)
        and '_' in u.split('/')[-1]  # Товары содержат подчеркивание в URL
    ][:limit]
    
    logger.info(f"✓ Найдено {len(product_urls)} товаров")
    return product_urls


def parse_product(url: str, session: requests.Session) -> bool:
    """Парсит один товар"""
    try:
        resp = session.post(
            f"{BASE_API}/parser/parse-url",
            json={"url": url, "sourceWebsiteId": SOURCE_WEBSITE_ID},
            timeout=120
        )
        
        if resp.ok and resp.json().get('success'):
            product = resp.json()['product']
            logger.info(f"✓ {product.get('name', 'Unknown')[:60]}")
            return True
        else:
            logger.error(f"✗ {url[:60]}... - {resp.text[:100]}")
            return False
    except Exception as e:
        logger.error(f"✗ {url[:60]}... - {e}")
        return False


def main():
    logger.info("=" * 60)
    logger.info("ПАРСИНГ TH-TOOL.BY - 1000 ТОВАРОВ")
    logger.info("=" * 60)
    
    # Получаем URL
    urls = parse_sitemap(LIMIT)
    
    if not urls:
        logger.error("Не удалось получить URL из sitemap")
        return
    
    # Парсим
    session = requests.Session()
    success = 0
    errors = 0
    
    start_time = datetime.now()
    
    for i, url in enumerate(urls, 1):
        progress = (i / len(urls)) * 100
        logger.info(f"[{i}/{len(urls)}] {progress:.1f}% - {url[:70]}...")
        
        if parse_product(url, session):
            success += 1
        else:
            errors += 1
        
        # Задержка
        time.sleep(0.3)
        
        # Прогресс каждые 50
        if i % 50 == 0:
            elapsed = (datetime.now() - start_time).total_seconds() / 60
            logger.info(f"\n--- Прогресс: {i}/{len(urls)} | Успешно: {success} | Ошибки: {errors} | Время: {elapsed:.1f} мин ---\n")
    
    # Итоги
    elapsed = (datetime.now() - start_time).total_seconds() / 60
    
    logger.info("\n" + "=" * 60)
    logger.info("ПАРСИНГ ЗАВЕРШЕН!")
    logger.info(f"Всего: {len(urls)}")
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
