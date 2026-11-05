/**
 * Addresses of the shops that lived on gost.by before this one.
 *
 * The Wayback Machine shows an OpenCart workwear shop in 2017–2019
 * (`/spetsodezhda/…`, `/siz/…`, `/spetsobuv/…`, `index.php?route=…`) and a
 * Bitrix site until 2025. Search engines, bookmarks and other sites still
 * send visitors there, and every one of them landed on «Страница не найдена»
 * (seen in Metrika, 2026-11-05). Each old section now answers 301 with the
 * closest category of ours; an old product page goes to its section, since
 * its transliterated slug finds nothing in our Russian search.
 *
 * Pure (no h3), so `npm test` covers it; `server/middleware/0.legacy-urls.ts`
 * applies it before the canonical-URL middleware, so `/siz/` is one hop.
 */

/** Old path prefix (lower case, no trailing slash) → our path. */
const PREFIX_RULES: Array<[string, string]> = [
  // СИЗ
  ['/siz/zaschita-ruk/kragi-vachegi', '/catalog/rukavicy-kragi'],
  ['/siz/zaschita-ruk/rukavicy', '/catalog/rukavicy-kragi'],
  ['/siz/zaschita-ruk/trikotazhnye-perchatki', '/catalog/perchatki-trikotazhnye'],
  ['/siz/zaschita-ruk/spilkovye-perchatki', '/catalog/perchatki-kozhanye-i-spilkovye'],
  ['/siz/zaschita-ruk/perchatki-himreagenty', '/catalog/perchatki-hozyaistvennye-i-promyshlennye'],
  ['/siz/zaschita-ruk/zaschita-hizkih-t', '/catalog/perchatki-dlya-zashchity-ot-ponizhennyh-temperatur'],
  ['/siz/zaschita-ruk', '/catalog/sredstva-individualnoi-zashchity-i-specodezhda-perchatki'],
  ['/siz/zaschita-dyhaniya', '/catalog/sredstva-zashchity-organov-dyhaniya'],
  ['/siz/zaschita-golovy', '/catalog/kaski-maski'],
  ['/siz/zaschita-glaz-lica', '/catalog/sredstva-zashchity-golovy-zreniya-sluha'],
  ['/siz/zaschita-sluha', '/catalog/naushniki-berushi'],
  ['/siz', '/catalog/sredstva-individualnoi-zashchity-i-specodezhda'],
  // Спецобувь
  ['/spetsobuv/zimnyaya-obuv', '/catalog/sapogi-i-polusapogi-rabochie'],
  ['/spetsobuv/demisezon-obuv', '/catalog/botinki-i-polubotinki-rabochie'],
  ['/spetsobuv/letnyaya-obuv', '/catalog/botinki-i-polubotinki-rabochie'],
  ['/spetsobuv/rezinovaya-pvkh-obuv', '/catalog/sapogi-galoshi-iz-pvh-chulok-mehovoi'],
  ['/spetsobuv/ohota-turizm-ohrana', '/catalog/obuv-iz-eva'],
  ['/spetsobuv', '/catalog/sredstva-individualnoi-zashchity-i-specodezhda-obuv'],
  // Спецодежда
  ['/spetsodezhda/letnya/rabochie-kostumy', '/catalog/kostyumy-rabochie'],
  ['/spetsodezhda/letnya/letnie-kurtki', '/catalog/kurtki-rabochie'],
  ['/spetsodezhda/letnya/letnie-zhilety', '/catalog/zhilety-rabochie'],
  ['/spetsodezhda/zimnaya/zimnie-rabochie-kostumy', '/catalog/kostyumy-rabochie'],
  ['/spetsodezhda/zimnaya/zimnie-kurtki', '/catalog/kurtki-rabochie'],
  ['/spetsodezhda/zimnaya/zimnie-zhilety', '/catalog/zhilety-rabochie'],
  ['/spetsodezhda/zaschitnaya-vsesezonnaya/signalnaya-zaschitnaya', '/catalog/zhilety-rabochie'],
  ['/spetsodezhda', '/catalog/specodezhda'],
  // Shop pages
  ['/about_us', '/about'],
  ['/about-us', '/about'],
  ['/contact-us', '/contacts'],
  ['/contact', '/contacts'],
  ['/terms', '/usloviya'],
  ['/specials', '/sales'],
  ['/catalogue', '/catalog'],
  ['/my-account', '/account'],
  ['/order-history', '/account'],
  ['/wishlist', '/favorites'],
  ['/compare-products', '/compare'],
  ['/simpleregister', '/register'],
  ['/simplecheckout', '/cart'],
  ['/forgot-password', '/login'],
  ['/add-return', '/contacts'],
  ['/nanesenie-logotipov', '/organizaciyam'],
  ['/newsletter', '/'],
  ['/sitemap', '/catalog'],
  ['/phone', '/'],
  ['/tablet', '/'],
]

/** The old sites' file-style pages (canonical-url leaves extensions alone). */
const FILE_RULES: Record<string, string> = {
  '/index.html': '/',
  '/catalogue.html': '/catalog',
  '/contact.html': '/contacts',
  '/anker.html': '/',
}

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * Where an old address should go, or `null` for anything of ours. Takes the
 * raw pathname and query string; the old query (`?page=3`) is dropped.
 */
export function legacyRedirect(pathname: string, search = ''): string | null {
  const path = pathname.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'

  if (FILE_RULES[path]) return FILE_RULES[path]
  // OpenCart: index.php?route=product/product&product_id=181 and friends.
  if (path === '/index.php') {
    return /route=product/i.test(search) ? '/catalog' : '/'
  }

  for (const [prefix, target] of PREFIX_RULES) {
    if (matchesPrefix(path, prefix)) return target
  }
  return null
}
