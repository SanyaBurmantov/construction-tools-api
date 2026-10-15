# Технический аудит gost.by (производительность, инфраструктура, фронтенд)

**Дата аудита:** 2026-10-15
**Объект:** https://gost.by/ (витрина «Мультитул»)
**Фокус:** производительность, кэширование, инфраструктура, качество фронтенда. Заголовки безопасности и on-page SEO разбираются в отдельных отчётах и здесь упоминаются только мимоходом.

> **Методика и ограничения.** Все замеры сделаны curl из тестовой среды через HTTP(S)-прокси (`CONNECT` через 185.111.24.71). Поэтому абсолютные `time_connect` и `time_appconnect` включают «плечо» до прокси. Значения TTFB стоит сравнивать между страницами, но не считать их опытом реального посетителя из Минска. Серверная часть приблизительно равна `ttfb − tls` и составляет 0,2–0,5 с.
> **Что не удалось:** PageSpeed Insights API ответил `429 RESOURCE_EXHAUSTED`: дневная квота без ключа исчерпана. Lighthouse и headless Chromium не запустились, потому что в среде нет `libglib-2.0.so.0`. По этой причине **нет данных Core Web Vitals (LCP/CLS/INP), консольных ошибок и полевых данных CrUX**. HTTP/3 проверить не удалось: curl собран без HTTP/3, поэтому подтверждён только анонс `alt-svc`. Доступность по IPv6 не проверена, есть только запись AAAA.

---

## 1. Резюме

**Общая оценка: 6 / 10.** Инфраструктура в порядке: HTTP/2, TLS 1.3, zstd/gzip, SWR-кэш HTML, immutable-кэш бандлов, корректные 404 и редирект http→https в один шаг. Главная проблема одна, но крупная.

**Каждая страница сайта весит ~1,15–1,47 МБ HTML (≈310–365 КБ по сети), и 85–90 % этого объёма занимает сериализованное дерево каталога.** Это 2 964 категории (42 корня, глубина 4, у 2 868 есть URL картинки), они лежат в `__NUXT_DATA__`. Дерево есть даже на «Оплата и доставка» (1 154 208 байт HTML). Браузер мобильного посетителя должен скачать, распарсить JSON на 1,2 МБ и гидратировать его до того, как страница станет интерактивной. Вероятный эффект — высокий TBT/INP и поздний LCP на слабых телефонах (не измерено, см. ограничения).

Вторичные проблемы:
- Шрифт Manrope (5 начертаний) грузится цепочкой `@import` из CSS.
- Плитки категорий тянут оригиналы 1200×900 JPEG напрямую с сайтов поставщиков (3 сторонних домена).
- Нет Brotli.
- Дубли URL со слешем и без.
- У `<img>` нет `width`/`height`.
- Поля поиска без `label`.

---

## 2. Таблица метрик (фактические значения)

### 2.1. Ответ сервера и вес HTML

| URL | Код | TTFB, с (замеры) | Время загрузки, с | По сети, байт (zstd) | HTML распакованный, байт | Cache-Control |
|---|---|---|---|---|---|---|
| `/` | 200 | 0,61 · 2,16 (холодный) · 0,73 · 0,69 | 1,05 / 2,76 / 1,85 | 356 590 | 1 376 388 | `s-maxage=60, stale-while-revalidate` |
| `/catalog/` | 200 | 0,78 · 0,63 | 1,75 / 1,43 | 365 183 | 1 470 472 | `s-maxage=30, stale-while-revalidate` |
| `/catalog/hoztovary` | 200 | 0,74 · 0,73 · 1,58 | 1,86 / 1,54 | 356 766 | 1 454 003 | `s-maxage=30, stale-while-revalidate` |
| `/product/bolt-mebelnyi-m8h60-…-smv1-93823-5` | 200 | 1,16 · 0,73 · 0,95 | 1,71 / 1,36 | 317 370 | 1 211 734 | `s-maxage=900, stale-while-revalidate` |
| `/brand/awtools` | 200 | 0,79 · 0,84 | 1,32 | 308 945 | 1 159 259 | `s-maxage=900, stale-while-revalidate` |
| `/brand/` | 200 | 0,76 | 1,37 | 342 641 | 1 403 536 | `s-maxage=900, stale-while-revalidate` |
| `/sales` | 200 | 0,91 | 1,49 | 308 838 | 1 156 345 | **нет** |
| `/delivery` | 200 | 0,93 · 0,80 | 1,58 | 308 256 | 1 154 208 | **нет** |
| `/no-such-page-xyz` | 404 | 0,65 | — | 1 533 | — | — |
| `/product/no-such-product-xyz` | 404 | 0,84 | — | 1 556 | — | — |

Время до прокси: `time_connect` ≈ 0,07 с, TLS ≈ 0,38–0,66 с (включая прокси).

### 2.2. Протоколы, сжатие, соединение

| Параметр | Значение |
|---|---|
| HTTP-версия | HTTP/2 (ALPN `h2`) |
| HTTP/3 | анонсирован: `alt-svc: h3=":443"; ma=2592000` (работу не проверить: curl без h3) |
| TLS | TLSv1.3, `TLS_AES_128_GCM_SHA256`, X25519, ECDSA; Let's Encrypt (YE2), CN=gost.by, действует до 2027-01-10 |
| Сжатие | `zstd`, `gzip`; **Brotli нет**. На `Accept-Encoding: br` ответ без сжатия, 1 154 208 байт. Для `/delivery`: zstd 308 256, gzip 312 846 байт |
| Keep-alive | HTTP/1.1: два запроса прошли по одному соединению (`num_connects=1`) |
| Сервер / прокси | `via: 1.1 Caddy`, `x-powered-by: Nuxt` |
| ETag / Last-Modified HTML | есть у SWR-маршрутов (слабый ETag `W/"…"`); у `/sales` и `/delivery` нет |

### 2.3. Ресурсы главной страницы

| Тип | Кол-во | Размер | Примечание |
|---|---|---|---|
| HTML | 1 | 356 590 Б по сети / 1 376 388 Б распак. | из них `__NUXT_DATA__` = **1 216 586 Б (88 %)** |
| └ `catalog-tree` в payload | 2 964 узла | ~1,26 МБ после развёртки | 42 корня, глубина 4 |
| └ `home-brands` | 412 брендов | ~93 КБ | 412 записей со всеми полями (`description`, `seoTitle`, `seoDescription`, `_count`) |
| └ `home-popular` / `home-newest` | — | ~52 КБ каждый | |
| JS (`modulepreload` + entry) | 27 файлов | 289 КБ распак., ≈106 КБ gzip-9 (оценка) | entry `CDy8nCtz.js` 204 КБ / 80 КБ zstd; `type="module"`, не блокирует рендер |
| CSS внешние | 12 файлов | ≈10 КБ по сети | `entry.css` начинается с `@import` Google Fonts |
| CSS inline | 16 блоков `<style>` | 39 697 Б | |
| Изображения | 16 `<img>` | — | 8 через `/_ipx/` (WebP, srcset); 8 плиток категорий — оригиналы JPEG 1200×900 с `content.tools.by`, `th-tool.by`, `dukon.by` |
| Шрифты | Manrope 400/500/600/700/800 | — | `fonts.googleapis.com` → `fonts.gstatic.com`, `display=swap` |
| Сторонние скрипты | **0** | — | нет аналитики, чатов, виджетов |

### 2.4. Кэширование статики

| Ресурс | Cache-Control | Прочее |
|---|---|---|
| `/_nuxt/*.js`, `/_nuxt/*.css` | `public, max-age=31536000, immutable` | хэш в имени, ETag, zstd |
| `/_nuxt/builds/meta/*.json` | `public, max-age=31536000, immutable` | |
| `/_ipx/w_300&f_webp&q_80/…` | `public, max-age=604800, stale-while-revalidate=86400` | `image/webp`, 1 948 Б (300w) |
| `/logo-mark.svg`, `/favicon.ico`, `/site.webmanifest` | **нет** | только ETag + Last-Modified (эвристический кэш) |
| Фото поставщика (LCP товара) `content.tools.by/…-1200x900.jpg` | вне нашего контроля | 38 472 Б, `image/jpeg` |

### 2.5. Редиректы

| Запрос | Цепочка | Итог |
|---|---|---|
| `http://gost.by/` | 308 → `https://gost.by/` | 1 шаг, ок |
| `http://www.gost.by/` | 308 → `https://www.gost.by/` → 301 → `https://gost.by/` | **2 шага** |
| `https://www.gost.by/` | 301 → `https://gost.by/` | ок |
| `/delivery` и `/delivery/` | оба **200** | дубль |
| `/catalog` и `/catalog/` | оба **200** | дубль (canonical указывает на версию без слеша) |
| `/index.php`, `/no-such-page-xyz` | 404, ~1,5 КБ | ок |

### 2.6. DNS и хостинг

| Параметр | Значение |
|---|---|
| A | `87.232.67.114`, TTL 3600 |
| AAAA | `2a0a:7d80:1:7::130:7b`, TTL 3600 (IPv6 есть) |
| www | CNAME → `gost.by`, TTL 3600 |
| NS | 2 шт.: `ns1.hoster.by`, `ns2.hoster.by` (TTL 21600), один провайдер |
| SOA | `ns1.hoster.by. root.vh130.hoster.by.`, serial 2026100900 |
| MX | `30 mailbe03.hoster.by` |
| CAA | нет |
| Хостинг | AS12406 Business Network Ltd (hoster.by), Минск, rDNS `87-232-67-114.hosterby.com`, VPS (`vh130`) |
| CDN | нет: ответ отдаёт Caddy напрямую |
| Стек | Nuxt (SSR + SWR/ISR) за Caddy; API на `/api/*`; изображения через Nuxt Image/IPX |

---

## 3. Проблемы

| # | Приоритет | Проблема | Доказательство | Рекомендация |
|---|---|---|---|---|
| 1 | **Высокий** | Полное дерево каталога (2 964 узла) сериализуется в **каждую** страницу | `__NUXT_DATA__` = 1 216 586 Б из 1 376 388 Б на `/`; `/delivery` = 1 154 208 Б HTML при почти пустом контенте; payload-ключ `catalog-tree` ≈1,26 МБ | Отдавать в SSR только корни и 2-й уровень (имя, slug, count) для меню. Глубину подгружать при открытии меню (`/categories/tree?depth=2`, `/categories/:slug/children`). Убрать из узлов `image`, `isFeatured`, `sortOrder`, `parentId`, `level`, `id`, если клиент их не использует (`pick`/`transform` в `useAsyncData`). Цель — HTML < 150 КБ распак. |
| 2 | **Высокий** | Тяжёлый JSON-парсинг и гидратация на мобильных | Следствие п.1: ≈1,2 МБ JSON на каждую навигацию по SSR-странице; 289 КБ JS | После п.1 замерить Lighthouse/PSI (с ключом API) на mobile. Цели: TBT < 200 мс, LCP < 2,5 с |
| 3 | Средний | Шрифт через цепочку `@import` в CSS, без preconnect | `entry.ewYhAntG.css` начинается с `@import"https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"`; в `<head>` 0 `preconnect`. Цепочка HTML → entry.css → fonts.googleapis.com → fonts.gstatic.com, три последовательных круга | Самохостить Manrope (woff2, subset latin+cyrillic, 2–3 начертания или variable) через `@nuxt/fonts` либо `<link rel="preload" as="font">`. Как минимум — `<link rel="preconnect">` к обоим доменам и `<link rel="stylesheet">` вместо `@import` |
| 4 | Средний | Плитки категорий на главной — оригиналы 1200×900 JPEG напрямую с серверов поставщиков | 8 `<img src="https://content.tools.by/…-1200x900.jpg" alt loading="lazy">` (также `th-tool.by`, `dukon.by`); без srcset, без WebP | Пропускать через `<NuxtImg>`/IPX, как карточки товаров (`/_ipx/w_300&f_webp…`). Уйдут 3 сторонних DNS+TLS, приходить будет 2–5 КБ вместо десятков, сайт перестанет зависеть от доступности и hotlink-политики поставщиков |
| 5 | Средний | LCP-изображение товара грузится с чужого домена в оригинальном размере | `/product/…`: первый `<img src="https://content.tools.by/…-1200x900.jpg" fetchpriority="high">`, 38 472 Б JPEG; остальные фото через IPX | Главное фото тоже через IPX (WebP/AVIF, srcset под ширину слота), плюс `<link rel="preload" as="image" imagesrcset=…>`. `fetchpriority="high"` оставить |
| 6 | Средний | Нет Brotli | `Accept-Encoding: br` → ответ без сжатия (1 154 208 Б); Caddyfile `encode zstd gzip` | Safari и старые клиенты получают gzip, это приемлемо. Brotli в стандартном Caddy нет, нужен модуль или precompressed-ассеты (`file_server precompressed br`) для `/_nuxt/*`. Низкая срочность, пока HTML весит мегабайт: п.1 даст на порядок больше |
| 7 | Средний | Дубли URL со слешем и без | `/delivery` и `/delivery/` — оба 200; `/catalog` и `/catalog/` — оба 200; на главной ссылки на обе формы (`/delivery` и `/delivery/`, `/contacts` и `/contacts/`) | 301 на одну форму (по canonical — без слеша) в Caddy или Nitro; привести внутренние ссылки к одной форме. Каждая форма — отдельный ключ SWR-кэша, то есть двойной SSR-рендер |
| 8 | Низкий | `/sales` и `/delivery` без Cache-Control, ETag и Last-Modified | заголовки ответа: только `content-type`, `vary`, `via`, `x-powered-by` | Добавить в `routeRules` `swr`/`isr` (у `/delivery` статический контент: `isr: 3600` и больше). Сейчас каждый запрос — полный SSR с мегабайтом payload |
| 9 | Низкий | Холодный TTFB до 2,2–3,1 с | `/` 2,16 с при первом замере, `http://gost.by/` → 3,07 с, `/catalog/hoztovary` 1,58 с на третьем замере (истёк `s-maxage=30`) | Короткие окна SWR (30–60 с) на тяжёлых страницах часто ведут к пересборке. Уменьшение payload (п.1) ускорит и рендер. Можно поднять `swr` каталога до 300 с |
| 10 | Низкий | У `<img>` нет `width`/`height` | 0 из 16 на `/`, 0 из 24 на категории, 0 из 5 на товаре | Проставить размеры (или `aspect-ratio` в CSS у контейнера: проверить по CLS после запуска Lighthouse) |
| 11 | Низкий | Поля поиска без доступного имени | 2 `<input type="search">` на главной только с `placeholder`, без `<label>`/`aria-label` | Добавить `aria-label="Поиск по каталогу"` (или визуально скрытый `<label>`) |
| 12 | Низкий | Нет skip-link | `skip` — 0 вхождений; большой header с мега-меню | Добавить «Перейти к содержимому» → `#main` |
| 13 | Низкий | Статика в корне без Cache-Control | `/logo-mark.svg`, `/favicon.ico`, `/site.webmanifest` — только ETag/Last-Modified | `Cache-Control: public, max-age=86400` (или неделя) в Caddy для корневых статических файлов |
| 14 | Низкий | Лишний шаг редиректа `http://www` | 308 → https://www → 301 → https://gost.by | В Caddy сразу `http://www.gost.by` → `https://gost.by` |
| 15 | Низкий | DNS: оба NS у одного провайдера, CAA нет | NS `ns1/ns2.hoster.by`; запрос CAA — пустой ответ | Вторичный DNS у другого провайдера — по желанию. CAA `0 issue "letsencrypt.org"` — подробнее в отчёте по безопасности |
| 16 | Низкий | Payload брендов на главной: 412 брендов со всеми полями | ключ `home-brands`, ~93 КБ, поля `description`, `seoTitle`, `seoDescription` | Отдавать на главную только то, что рисуется (name, slug, logo), и ограничить количество |

Сделано удачно и не требует действий: в HTML нет блокирующих `<script>` (единственный — `type="module"`), JSON-LD на месте.

---

## 4. Что сделано хорошо

- **HTTP/2 + анонс HTTP/3**, TLS 1.3 с ECDSA, автоматический Let's Encrypt (Caddy), сертификат до 2027-01-10.
- **Сжатие zstd/gzip** HTML и ассетов (HTML сжимается ≈4×).
- **SSR + stale-while-revalidate** на основных маршрутах, у кэшируемых страниц есть ETag/Last-Modified.
- **Бандлы Nuxt** с хэшем в имени и `max-age=31536000, immutable`, модульный JS, `modulepreload`, нет блокирующих скриптов в `<head>`.
- **Изображения карточек через IPX**: WebP, `srcset` 300w/600w, `sizes`, `loading="lazy"` ниже сгиба, `loading="eager" fetchpriority="high"` у первых карточек, `decoding="async"`, недельный кэш.
- **Ноль сторонних скриптов**: нет аналитики, чатов, пикселей. Это сильно влияет на TBT и приватность в лучшую сторону.
- **Корректные ошибки**: 404 с настоящим кодом и лёгкой страницей (~1,5 КБ), «Товар не найден» тоже отдаёт 404.
- **Один редирект** http→https (308), www → apex (301).
- **IPv6** (AAAA), разумные TTL (3600).
- **Базовая валидность и доступность**: `<!DOCTYPE html>`, `lang="ru"`, `charset` первым тегом, `viewport`, медиазапросы в стилях, один `<h1>`, `<main>`/`<nav>`, 96 `aria-*` (иконки-кнопки с `aria-label`, `aria-expanded`, `aria-pressed`), `alt` у фото товаров; на странице категории 73 `<label>` у фильтров.
- **Битых ресурсов не найдено**: все 39 JS/CSS главной ответили 200.

---

## 5. План работ

**Приоритет 1 (самый большой эффект, 1–2 дня)**
1. Урезать `catalog-tree` в SSR-payload: только верхние уровни и минимальный набор полей; глубину подгружать лениво (п.1–2). Ожидаемо HTML каждой страницы уменьшится с ~1,2–1,5 МБ до ~0,15–0,3 МБ, а по сети — с ~310–365 КБ до ~40–80 КБ.
2. После этого прогнать Lighthouse/PSI (с API-ключом) mobile на `/`, категории и товаре, зафиксировать базовые LCP/TBT/CLS.

**Приоритет 2 (1 день)**
3. Самохостинг Manrope (или preconnect + `<link>` вместо `@import`), сократить число начертаний (п.3).
4. Плитки категорий и главное фото товара — через IPX (WebP, srcset), preload LCP-изображения (п.4–5).
5. Единая форма URL (без слеша) с 301 и чистка внутренних ссылок (п.7).
6. `routeRules` для `/sales`, `/delivery`, `/contacts`, `/oferta` (п.8); swr каталога 30 → 300 с (п.9).

**Приоритет 3 (по ходу)**
7. `width`/`height` у `<img>`, `aria-label` у поиска, skip-link (п.10–12).
8. Cache-Control для корневой статики, прямой редирект `http://www` → apex (п.13–14).
9. Brotli для статики (precompressed), CAA, вторичный DNS (п.6, 15).
10. Сократить payload брендов на главной (п.16).

---

## 6. Проверенные URL и команды

**URL (всего ~50 запросов HTML и заголовков к gost.by с паузами 0,7–1 с; плюс две загрузки бандла главной: 39 JS/CSS и 27 JS — эквивалент двух визитов браузера):**
- `https://gost.by/` (×5), `http://gost.by/`, `http://www.gost.by/`, `https://www.gost.by/`
- `https://gost.by/catalog/` (×2), `https://gost.by/catalog`, `https://gost.by/catalog/hoztovary` (×3)
- `https://gost.by/product/bolt-mebelnyi-m8h60-mm-s-kvadratom-din-603-5-kg-starfix-smv1-93823-5` (×3)
- `https://gost.by/brand/awtools` (×2), `https://gost.by/brand/`, `https://gost.by/sales`, `https://gost.by/delivery` (×6, включая тесты сжатия), `https://gost.by/delivery/`
- `https://gost.by/index.php`, `https://gost.by/no-such-page-xyz`, `https://gost.by/product/no-such-product-xyz`
- `https://gost.by/robots.txt`, `/favicon.ico`, `/logo-mark.svg`, `/site.webmanifest`, `/_nuxt/CDy8nCtz.js`, `/_nuxt/entry.ewYhAntG.css`, `/_nuxt/builds/meta/9233f50c-….json`, один `/_ipx/w_300&f_webp&q_80/…`
- одно фото поставщика `content.tools.by/…-1200x900.jpg` (LCP товара)

**Команды (основные):**
```bash
# тайминги и размер
curl -s -o page.html --compressed -A "<Chrome UA>" -D headers.txt \
  -w "%{http_code} conn=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download} h=%{http_version}" URL
# сжатие
curl -s -o /dev/null -H "Accept-Encoding: gzip|br|zstd" -D h.txt -w "size=%{size_download}" https://gost.by/delivery
# keep-alive
curl -s --http1.1 -o /dev/null https://gost.by/robots.txt https://gost.by/favicon.ico -w "%{num_connects}"
# редиректы
curl -s -L --max-redirs 5 -D chain.txt -w "%{http_code} %{num_redirects} %{url_effective}" URL
# TLS
curl -s -o /dev/null -v https://gost.by/robots.txt   # SSL connection / ALPN / issuer / expire
# DNS (dig в среде нет — через DNS-over-HTTPS)
curl -s "https://dns.google/resolve?name=gost.by&type=A|AAAA|NS|MX|SOA|CAA"
curl -s "https://dns.google/resolve?name=www.gost.by&type=A"
curl -s https://ipinfo.io/87.232.67.114/json
# PSI (неудачно: 429 quota exceeded)
curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://gost.by/&strategy=mobile"
```
Разбор HTML (img/alt/lazy/width, `<label>`, `aria-*`, `__NUXT_DATA__` с развёрткой по ключам и подсчётом узлов дерева) — скрипты Python по сохранённым страницам. Попытка запустить Playwright Chromium для CWV и консоли не удалась (`libglib-2.0.so.0: cannot open shared object file`).
