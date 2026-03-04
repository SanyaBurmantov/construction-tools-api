from playwright.sync_api import sync_playwright

url = "https://th-tool.by/press-gidravlicheskiy-100t_1/"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(url, wait_until='networkidle')
    
    # Ищем описание
    selectors_to_try = [
        '.description',
        '.product-description',
        '.full-description',
        '.product-info',
        '.product-full-description',
        '.product-text',
        '.content',
        '[class*="description"]',
        '.tab-content',
        '.product-details',
    ]
    
    print("=== Ищем описание ===")
    for selector in selectors_to_try:
        try:
            el = page.query_selector(selector)
            if el:
                text = el.text_content().strip()
                if text and len(text) > 100:
                    print(f"✓ {selector}")
                    print(f"  Текст: {text[:200]}...")
                    print()
        except:
            pass
    
    # Показываем весь HTML body для анализа
    print("\n=== Классы в body ===")
    classes = page.query_selector_all('[class]')
    unique_classes = set()
    for el in classes[:50]:
        class_attr = el.get_attribute('class')
        if class_attr:
            for c in class_attr.split():
                if 'desc' in c.lower() or 'info' in c.lower() or 'content' in c.lower() or 'text' in c.lower():
                    unique_classes.add(c)
    
    for c in sorted(unique_classes):
        print(f"  .{c}")
    
    browser.close()
