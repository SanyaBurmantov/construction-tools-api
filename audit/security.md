# Пассивный аудит безопасности https://gost.by/

**Дата аудита:** 2026-10-15
**Метод:** только неинвазивные проверки с позиции обычного посетителя: около 35 HTTP-запросов к сайту с паузами, 5 TLS-рукопожатий, DNS через DNS-over-HTTPS (dns.google), RDAP (RIPE). Брутфорса, сканеров, фаззинга, инъекций и попыток входа не было, формы не отправлялись.
**Дополнительно:** сайт собран из этого репозитория (Caddy + Nuxt 4 + NestJS), поэтому причины находок сверены с `deploy/Caddyfile`, `frontend/nuxt.config.ts`, `backend/src/main.ts`. Также выполнен `npm audit --omit=dev` по lock-файлам (локально, без обращений к сайту).

---

## Краткое резюме

**Общая оценка: удовлетворительно, есть пробелы средней серьёзности.** Критичных находок, подтверждённых снаружи, нет.

Транспортный уровень настроен хорошо: только TLS 1.2/1.3, действующие сертификаты Let's Encrypt, корректные редиректы http→https и www→без-www. Служебные файлы (`.git`, `.env`, бэкапы, phpMyAdmin) недоступны, Swagger выключен, CORS для чужих origin закрыт.

Основные слабые места:
1. **У HTML-страниц витрины нет заголовков безопасности**: нет CSP, X-Frame-Options, HSTS, Referrer-Policy и прочих. HSTS и защитные заголовки helmet есть только на ответах `/api/*`.
2. **Токен сессии хранится в localStorage, а CSP нет.** Любой XSS сразу даёт угон сессии, в том числе админской.
3. **В зависимостях фронтенда есть известные уязвимости**: nuxt 4.2.0, vue 3.5.22, h3 1.15.4, devalue, ipx. Среди них high-advisory в рантайм-пакетах.
4. **Публичный `/api/health/parser` раскрывает внутреннюю информацию**: коды поставщиков, размеры очередей, ошибки джобов. Названия поставщиков также видны в HTML через прямые URL картинок (`th-tool.by`, `content.tools.by`, `dukon.by`).
5. **Почта домена не защищена от подделки**: DMARC нет, DKIM не найден, SPF с `~all`. CAA тоже нет.

---

## Таблица находок

| # | Severity | Находка | Доказательство | Рекомендация |
|---|---|---|---|---|
| 1 | **Высоко** | Известные уязвимости в рантайм-зависимостях фронтенда. Снаружи подтверждены версии **Nuxt 4.2.0** и **Vue 3.5.22**: в бандле `/_nuxt/CDy8nCtz.js` есть строки `nuxt(){return"4.2.0` и `const Hd="3.5.22"`. | `npm audit --omit=dev` (frontend): 61 уязвимость (6 critical, 38 high). Из них в рантайме: nuxt (GHSA-mm7m-92g8-7m47, CVE-2026-53721, обход route-rule middleware; GHSA-9473-5f9j-94wq RCE и GHSA-9pgf-384g-p7mv / GHSA-hxcr-hm88-mpq6 DoS через server islands; GHSA-fx6j-w5w5-h468 и GHSA-934w-87qh-qr26 XSS); @vue/server-renderer (GHSA-g2v6-rqmx-r4w6, XSS); h3 1.15.4 (GHSA-mp2g-9vg9-f4cg, request smuggling); devalue 5.4.2 (DoS); ipx 3.1.1 (high; `/_ipx` доступен публично); nitropack (GHSA-5w89-w975-hf9q, GHSA-9phm-9p8f-hw5m). | Обновить nuxt до ≥ 4.5.1, vue до > 3.5.41, затем `npm audit fix` и пересобрать образ. Часть advisory касается server islands и route-rule middleware. Проект, судя по коду, не использует ни то, ни другое для авторизации (она на API), поэтому реальный риск ниже номинального. Но DoS/XSS/smuggling-пункты затрагивают обычный SSR. |
| 2 | **Средне** | На HTML-страницах витрины нет заголовков безопасности: CSP, X-Frame-Options/frame-ancestors, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, COOP/CORP. | `GET /` → `HTTP/2 200`; заголовки только `cache-control`, `content-type`, `etag`, `vary`, `via: 1.1 Caddy`, `x-powered-by: Nuxt`. То же на `/product/…` и `/login`. Для сравнения: 404-страницы Nitro отдают `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`. | Задать заголовки один раз в Caddy в блоке `{$DOMAIN}` через `header { … }`, чтобы они попадали и в ISR/SWR-кэшированные ответы: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (или `frame-ancestors 'none'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`. |
| 3 | **Средне** | Сессия в localStorage при отсутствии CSP. Любой XSS (см. п. 1: advisory с XSS во vue/nuxt/unhead) сразу даёт кражу bearer-токена, включая токен ADMIN. | Cookie сайт не ставит ни на одном ответе, `set-cookie` не встречается. В `__NUXT_DATA__` главной есть ключ `$sauth-token` (для гостя пустой). Заголовка `Content-Security-Policy` нет ни на одном ответе. | Ввести CSP. Начать с `Content-Security-Policy-Report-Only` (`default-src 'self'; img-src 'self' data: https://th-tool.by https://content.tools.by https://dukon.by; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`), затем ужесточать, например через nonce для inline-скрипта Nuxt. В долгой перспективе стоит рассмотреть HttpOnly-cookie для админской сессии. |
| 4 | **Средне** | Кликджекинг: `/login`, `/checkout`, `/account`, `/admin` можно встроить во фрейм чужого сайта. | `GET /login` → `200`, нет `X-Frame-Options` и `frame-ancestors`. `GET /admin` → `200` (SPA-оболочка), без XFO. | Закрывается заголовками из п. 2 (`X-Frame-Options: DENY` / `frame-ancestors 'none'`). |
| 5 | **Средне** | Публичный `GET /api/health/parser` раскрывает внутреннюю информацию: коды поставщиков (`dukon`, `th-tools`, `tools-by`), число позиций у каждого, размеры очередей, число неудачных разборов, названия и статусы cron-джобов с временем ошибок. Это противоречит правилу проекта «кто какой поставщик — внутреннее». | `GET /api/health/parser` → `200 application/json`, 2679 байт: `{"ok":false,…"priceFreshness":[{"sourceCode":"dukon","total":3017,…},{"sourceCode":"th-tools","total":26254,…},{"sourceCode":"tools-by",…}],"queues":[…"failed":3346…],"jobs":[…"health":"ERROR"…]}` | Перевести эндпоинт за `AdminGuard` (мониторинг ходит с `x-admin-token`). Либо публично отдавать только `{"ok":true/false}`. Для контейнерного healthcheck достаточно `/health`. |
| 6 | **Низко** | Поставщики видны в HTML витрины: картинки товаров ссылаются напрямую на CDN поставщиков. Кроме того, браузер посетителя обращается к сторонним хостам (они видят IP и Referer-origin). | В HTML главной: 1545 вхождений `https://content.tools.by/images…`, 657 `https://th-tool.by/wa-data…`, 194 `https://dukon.by/upload…`; поле `url` у изображений в `__NUXT_DATA__`. | Если факт поставщиков должен быть закрыт, отдавать изображения только через `/_ipx/…` (уже настроено для части компонентов) или копировать к себе. В любом случае добавить `Referrer-Policy`. |
| 7 | **Средне** | Почта домена: нет DMARC, DKIM не найден, SPF мягкий. Письма «от @gost.by» легко подделать для фишинга клиентов. | `TXT gost.by` → `v=spf1 +a +mx include:_spf.hoster.by ~all`; `_dmarc.gost.by` → NXDOMAIN; `_domainkey.gost.by` → NXDOMAIN (селекторов DKIM в зоне, по всей видимости, нет; проверены `default`, `mail`, `dkim`, `google`, `selector1`); MX `30 mailbe03.hoster.by.` | Включить DKIM у hoster.by и опубликовать селектор. Добавить `_dmarc.gost.by TXT "v=DMARC1; p=none; rua=mailto:…"` с переходом к `p=quarantine`/`reject`. После проверки ужесточить SPF до `-all`. Если домен почту не отправляет: `v=spf1 -all` и `p=reject`. |
| 8 | **Низко** | Нет CAA-записи: сертификат на домен может выпустить любой УЦ. | `CAA gost.by` → пустой ответ (NOERROR, только SOA); у зоны `by` CAA тоже нет. | `gost.by. CAA 0 issue "letsencrypt.org"` (+ `iodef`). |
| 9 | **Низко** | HSTS только на ответах `/api/*` и без `preload`; HTML-страницы HSTS не отдают. Первый заход по http защищён только редиректом. | `/api/health/parser`: `strict-transport-security: max-age=31536000; includeSubDomains`. `GET /` — заголовка нет. | Отдавать `Strict-Transport-Security: max-age=31536000; includeSubDomains` из Caddy на всех ответах. `preload` добавлять, только если все поддомены навсегда на HTTPS. |
| 10 | **Низко** | Раскрытие стека. | `x-powered-by: Nuxt`, `via: 1.1 Caddy`, `server: Caddy` (на редиректах); `GET /api/` → `200 "Hello World!"` (шаблонный контроллер NestJS); 404 API в формате Express: `{"message":"Cannot GET /docs",…}`. | Убрать `X-Powered-By` (`header -X-Powered-By`, `-Server`, `-Via` в Caddy), удалить шаблонный `GET /`. |
| 11 | **Инфо** | Запись AAAA указывает в другую сеть, чем A. Возможно, IPv6-посетители попадают не на тот сервер, где работает Caddy. **Не подтверждено**: IPv6 из среды аудита недоступен. | `A gost.by` → `87.232.67.114` (HOSTER-CLOUD, PTR `87-232-67-114.hosterby.com`); `AAAA gost.by` и `www` → `2a0a:7d80:1:7::130:7b` (HOSTERBY-1, PTR нет). SOA зоны: `root.vh130.hoster.by` (сервер виртуального хостинга). `curl -6` → `Couldn't connect`. | Проверить с IPv6-хоста (`curl -6 -v https://gost.by/`). Если адрес не принадлежит VPS, удалить AAAA или указать верный IPv6. |
| 12 | **Инфо** | Нет `security.txt`; один из запросов к `/security.txt` вернул 502. | `/.well-known/security.txt` → `404`; `/security.txt` → сначала `502` (пустое тело), повторно `404`. | Добавить `public/.well-known/security.txt` (Contact, Expires). Разовый 502 стоит сверить с логами Caddy/frontend на 08:21 UTC. |
| 13 | **Инфо** | Объёмные ответы: дешёвый для атакующего способ нагрузить канал и сервер. | `/sitemap.xml` → `200`, 9 035 116 байт, 55 009 `<loc>` (выше лимита протокола в 50 000 URL на файл); `GET /` → 1 372 570 байт HTML, из них ~1,2 МБ `__NUXT_DATA__`. | Разбить sitemap на sitemap-index; урезать payload главной. Ограничение частоты запросов на уровне Caddy в любом случае полезно. |
| 14 | **Инфо** | Зависимости бэкенда (снаружи не наблюдаемы, версии не раскрываются). | `npm audit --omit=dev` (backend): 16 уязвимостей (1 critical: proxy-addr, IP spoofing через IPv4-mapped IPv6; 11 high: @nestjs/core, multer, path-to-regexp, undici, fast-xml-parser, lodash, js-yaml). | Обновить NestJS и транзитивные зависимости. proxy-addr важен, потому что троттлинг отзывов и промокодов завязан на IP клиента. |

---

## Что сделано хорошо

- **TLS:** только TLS 1.3 и 1.2 (`-tls1_1` → `no protocols available`), шифры AEAD (`TLS_AES_128_GCM_SHA256`, `ECDHE-ECDSA-AES128-GCM-SHA256`), ECDSA-сертификат, проверка цепочки `Verify return code: 0 (ok)`.
- **Сертификаты:** Let's Encrypt (YE2), `gost.by` и `www.gost.by` (отдельные сертификаты, SAN совпадает с именем), действуют с 2026-10-12 по 2027-01-10, автопродление Caddy. HTTP/2 и HTTP/3 (`alt-svc: h3`).
- **Редиректы:** `http://gost.by/` → `308` на `https://gost.by/`; `https://www.gost.by/` → `301` на `https://gost.by/`; `http://www.gost.by/` → `308` на `https://www.gost.by/` → `301` на канонический адрес.
- **Служебные пути закрыты:** `/.git/HEAD`, `/.env`, `/wp-admin`, `/wp-login.php`, `/phpmyadmin`, `/server-status`, `/backup.zip` → `404`. Swagger (`/api/docs`) → `404`.
- **CORS закрыт для чужих origin:** с `Origin: https://evil.example` ни GET главной, ни GET API, ни preflight `OPTIONS /api/orders` не возвращают `Access-Control-Allow-Origin`, значит `CORS_ORIGIN` в проде задан.
- **API отдаёт полный набор helmet-заголовков:** HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, COOP/CORP `same-origin`.
- **`/admin` закрыт по API:** страница отдаёт только пустую SPA-оболочку (`ssr: false`), данных в HTML нет. В `__NUXT_DATA__` гостя `$sauth-user: null`, `$sadmin-authorized: false`, `$sadmin-product-sources: {}`. Себестоимость, supplier URL товаров, ipHash и хэши паролей в HTML не найдены.
- **Нет смешанного контента:** ни одной ссылки `http://` в HTML главной. Все ресурсы с того же origin или по HTTPS. Сторонних скриптов нет вообще, поэтому вопрос SRI не возникает: единственный внешний JS — собственный `/_nuxt/*.js`.
- **jQuery, lodash, axios, moment** в клиентском бандле не обнаружены.
- **Формы:** на главной только две формы поиска (`role="search"`, без `action`, обрабатываются в JS, ничего не меняют). Формы входа и оформления заказа рендерятся на клиенте и шлют запросы с `Authorization: Bearer`, а не с cookie, поэтому классический CSRF к ним неприменим. Сами формы не отправлялись.
- **robots.txt** закрывает `/admin`, `/cart`, `/checkout` от индексации.

---

## План исправлений (по приоритету)

1. **Обновить фронтенд-зависимости** (nuxt ≥ 4.5.1, vue > 3.5.41, h3, devalue, ipx, nitropack), пересобрать и задеплоить. Следом обновить NestJS-стек бэкенда (proxy-addr, multer, path-to-regexp, undici).
2. **Добавить заголовки безопасности в Caddy** для всего `{$DOMAIN}`: HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP. Убрать `X-Powered-By`/`Server`/`Via`. Одно изменение закрывает пп. 2, 4, 9 и 10.
3. **Ввести CSP**: сначала `Report-Only`, затем в боевом режиме. Это главная защита токена в localStorage (п. 3).
4. **Закрыть `/api/health/parser` за `AdminGuard`** или урезать его до `ok` (п. 5). Удалить шаблонный `GET /` → `Hello World!`.
5. **DNS:** DMARC + DKIM, ужесточение SPF, CAA `letsencrypt.org`. Проверить и исправить AAAA (пп. 7, 8, 11).
6. **Мелочи:** `security.txt`, разбиение sitemap, решение по прямым ссылкам на картинки поставщиков (пп. 6, 12, 13).

---

## Перечень выполненных проверок

| Проверка | Как | Результат |
|---|---|---|
| TLS-протокол, шифр, цепочка | `openssl s_client` (по умолчанию, `-tls1_2`, `-tls1_1`) | TLS 1.3/1.2 да, 1.1 нет, цепочка ок |
| Сертификаты gost.by и www | `openssl x509 -subject -issuer -dates -ext subjectAltName` | LE YE2, 2026-10-12 – 2027-01-10 |
| http→https, www→apex | `curl -D -` на 4 комбинации | 308/301, корректно |
| Заголовки безопасности | `curl -D -` на `/`, `/product/…`, `/login`, `/.env` (404), `/api/health/parser` | см. пп. 2, 9, 10 |
| Cookies | все ответы выше | `Set-Cookie` не выставляется |
| CORS | GET с `Origin: https://evil.example` на `/` и `/api/health/parser`; preflight `OPTIONS /api/orders` | ACAO не возвращается |
| Служебные пути | по одному GET: `/.git/HEAD`, `/.env`, `/robots.txt`, `/security.txt`, `/.well-known/security.txt`, `/admin`, `/wp-admin`, `/wp-login.php`, `/phpmyadmin`, `/server-status`, `/backup.zip`, `/sitemap.xml`, `/api/`, `/api/docs`, `/api/health`, `/api/health/parser` | 404 на все чувствительные; 200: robots, sitemap, `/admin` (оболочка SPA), `/api/`, `/api/health`, `/api/health/parser` |
| Фреймворк и версии JS | заголовки + поиск версий в `/_nuxt/CDy8nCtz.js` | Nuxt 4.2.0, Vue 3.5.22; jQuery и пр. нет |
| CVE по версиям | WebSearch + `npm audit --omit=dev` (frontend, backend) | см. пп. 1, 14 |
| Смешанный контент, SRI, iframes | разбор HTML главной | `http://` нет, внешних скриптов нет, iframe нет |
| Формы и CSRF | разбор разметки (без отправки) | только поисковые формы; авторизация через Bearer |
| Утечки в SSR-payload | разбор `__NUXT_DATA__` | себестоимости, supplier URL и PII нет; есть URL картинок поставщиков |
| DNS: A/AAAA/NS/MX/TXT(SPF)/DMARC/DKIM/CAA/MTA-STS | DoH `dns.google` (`dig` в среде отсутствует), PTR, RDAP RIPE | см. пп. 7, 8, 11 |

**Что не удалось проверить:**
- Доступность и содержимое сайта по IPv6 (п. 11): в среде аудита нет IPv6.
- Наличие DKIM под нестандартным селектором: вывод сделан по NXDOMAIN на `_domainkey.gost.by`.
- Поведение форм входа, регистрации и заказа: они рендерятся на клиенте, а отправка запрещена условиями аудита.
- Поддержка устаревших шифров TLS 1.2 по полному списку: сканер шифров не запускался.
