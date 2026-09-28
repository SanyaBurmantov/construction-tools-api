"""
Массовый парсер - 1000 товаров с каждого сайта
Запускает парсинг с th-tool.by и tools.by
"""

import subprocess
import sys
from datetime import datetime

def run_parser(parser_file: str, description: str):
    """Запускает парсер"""
    print("\n" + "=" * 80)
    print(f"🚀 ЗАПУСК: {description}")
    print(f"📁 Скрипт: {parser_file}")
    print("=" * 80)
    
    start_time = datetime.now()
    
    try:
        result = subprocess.run(
            ["python3", parser_file],
            capture_output=False,
            text=True,
            timeout=7200  # 2 часа таймаут
        )
        
        end_time = datetime.now()
        duration = end_time - start_time
        
        print("\n" + "=" * 80)
        if result.returncode == 0:
            print(f"✅ УСПЕШНО: {description}")
        else:
            print(f"❌ ОШИБКА: {description} (код {result.returncode})")
        print(f"⏱️ Время выполнения: {duration}")
        print("=" * 80)
        
        return result.returncode == 0
        
    except subprocess.TimeoutExpired:
        print(f"\n❌ ТАЙМАУТ: {description} (превышено 2 часа)")
        return False
    except Exception as e:
        print(f"\n❌ ИСКЛЮЧЕНИЕ: {description} - {e}")
        return False


def main():
    """Основная функция"""
    print("\n" + "█" * 80)
    print("█  МАССОВЫЙ ПАРСЕР - 1000 ТОВАРОВ С КАЖДОГО САЙТА")
    print("█" * 80)
    print(f"📅 Дата запуска: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Проверяем доступность API
    print("\n🔍 Проверка доступности API...")
    try:
        import requests
        resp = requests.get("http://localhost:3000/health", timeout=5)
        if resp.ok:
            print("✅ API доступно (http://localhost:3000)")
        else:
            print("⚠️ API вернуло некорректный ответ")
    except Exception:
        print("⚠️ API недоступно. Убедитесь, что сервер запущен!")
        response = input("Продолжить? (y/n): ")
        if response.lower() != 'y':
            print("❌ Отменено пользователем")
            sys.exit(0)
    
    results = []
    
    # 1. Парсим th-tool.by
    results.append(run_parser(
        "parsers/thtool_parser.py",
        "th-tool.by (1000 товаров)"
    ))
    
    # 2. Парсим tools.by
    results.append(run_parser(
        "parsers/toolsby_parser.py",
        "tools.by (1000 товаров)"
    ))
    
    # Итоги
    print("\n" + "█" * 80)
    print("█  ИТОГИ ПАРСИНГА")
    print("█" * 80)
    
    total = len(results)
    success = sum(results)
    
    print(f"\n📊 Статистика:")
    print(f"   Всего сайтов: {total}")
    print(f"   ✅ Успешно: {success}")
    print(f"   ❌ Ошибки: {total - success}")
    
    if success == total:
        print("\n🎉 ВСЕ ПАРСЕРЫ ОТРАБОТАЛИ УСПЕШНО!")
    elif success > 0:
        print(f"\n⚠️ ЧАСТИЧНЫЙ УСПЕХ: {success}/{total}")
    else:
        print("\n❌ ВСЕ ПАРСЕРЫ ЗАВЕРШИЛИСЬ С ОШИБКАМИ")
    
    # Показываем финальную статистику из БД
    print("\n📈 СТАТИСТИКА ИЗ БАЗЫ ДАННЫХ:")
    try:
        import requests
        resp = requests.get("http://localhost:3000/products?limit=1", timeout=10)
        if resp.ok:
            print(f"   Товаров в БД: {resp.json()['meta']['total']}")
        
        resp = requests.get("http://localhost:3000/categories", timeout=10)
        if resp.ok:
            print(f"   Категорий: {len(resp.json())}")
        
        resp = requests.get("http://localhost:3000/facet-filters", timeout=10)
        if resp.ok:
            print(f"   Фильтров: {len(resp.json())}")
    except Exception as e:
        print(f"   ⚠️ Не удалось получить статистику: {e}")
    
    print("\n" + "█" * 80)
    print(f"📅 Дата завершения: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("█" * 80 + "\n")


if __name__ == "__main__":
    main()
