// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

/**
 * Яндекс.Метрика. Только в production-сборке: `npm run dev` иначе писал бы
 * localhost-визиты в боевой счётчик. Счётчик сам отслеживает переходы через
 * History API, так что SPA-навигация считается без ручных `ym('hit')`.
 * Хосты, которые он грузит и куда шлёт данные, открыты в CSP (deploy/Caddyfile).
 */
const YANDEX_METRIKA_ID = 113800110
const isProdBuild = process.env.NODE_ENV === 'production'
const metrikaHead = isProdBuild
  ? {
      script: [
        {
          key: 'yandex-metrika',
          innerHTML: `(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_ID}','ym');ym(${YANDEX_METRIKA_ID},'init',{ssr:true,webvisor:true,clickmap:true,ecommerce:'dataLayer',referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`,
        },
      ],
      noscript: [
        {
          key: 'yandex-metrika-noscript',
          innerHTML: `<div><img src="https://mc.yandex.ru/watch/${YANDEX_METRIKA_ID}" style="position:absolute; left:-9999px;" alt="" /></div>`,
        },
      ],
    }
  : {}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  modules: ['@pinia/nuxt', '@nuxt/eslint', '@nuxt/image'],
  /**
   * `@nuxt/image` was in `modules` but unused — every product photo was
   * hot-linked straight from the supplier. Measured on one catalogue page:
   * 1.6 MB over 24 images, averaging 68 KB, served at 750x750 / 970x970 /
   * 1200x900 into a box that is ~230px wide on desktop and ~290px on a phone,
   * and with no `Cache-Control` on any of them, so every visit re-downloaded
   * the lot. Resizing the same photos through IPX gives 22 KB and 9 KB.
   *
   * `domains` is the allowlist IPX needs to fetch a remote original; without an
   * entry here the module refuses the URL and the image does not render.
   * Keep it in step with the hosts the parsers store: th-tool.by,
   * content.tools.by (tools.by's media host) and dukon.by.
   */
  image: {
    domains: ['th-tool.by', 'content.tools.by', 'dukon.by'],
    // The catalogue grid tops out at ~300px per card and the gallery at 480px;
    // these are the only widths worth generating.
    screens: { card: 300, cardx2: 600, gallery: 480, galleryx2: 960 },
    format: ['webp'],
    quality: 80,
    /**
     * IPX takes the photo's `max-age` from the supplier's own response and
     * that header wins over the `/_ipx/**` route rule below: th-tool.by says
     * 300 s, so every gallery photo was re-fetched after five minutes
     * (PageSpeed: «время жизни кеша 5 мин»). Ignore theirs, send a week.
     */
    ipx: {
      http: { maxAge: 604800, ignoreCacheControl: true },
    },
  },
  css: ['@/assets/scss/main.scss'],
  app: {
    head: {
      htmlAttrs: { lang: 'ru' },
      link: [
        // SVG first for crisp tabs on modern browsers, PNG/ICO as fallback.
        { rel: 'icon', type: 'image/svg+xml', href: '/logo-mark.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
        // Self-hosted Manrope (see assets/scss/main.scss). Both subsets are
        // preloaded: the latin one is not optional on a Russian page — it
        // holds the digits, spaces and punctuation, so «50 000+ позиций» in
        // the hero waited for it at the end of HTML → CSS → font (PageSpeed:
        // 2.3 s on the critical path, the LCP element). `crossorigin` is
        // required even same-origin, or the preload is fetched twice.
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/manrope-cyrillic.woff2', crossorigin: '' },
        { rel: 'preload', as: 'font', type: 'font/woff2', href: '/fonts/manrope-latin.woff2', crossorigin: '' },
      ],
      meta: [
        { name: 'color-scheme', content: 'light' },
        { name: 'theme-color', content: '#1d4ed8' },
        { name: 'apple-mobile-web-app-title', content: 'Gost.by' },
        // Default social preview; pages with their own image override it.
        { property: 'og:image', content: '/og-image.png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:site_name', content: 'Gost.by' },
        { property: 'og:locale', content: 'ru_RU' },
        { name: 'twitter:image', content: '/og-image.png' },
      ],
      ...metrikaHead,
    },
  },
  routeRules: {
    /**
     * IPX answers with `max-age=300` by default, which defeats the point: the
     * whole win is the browser not re-fetching the photo. A week is safe
     * because a replaced photo almost always lands on a new supplier URL (both
     * th-tool.by and content.tools.by put an image id in the path), and it is
     * deliberately not `immutable` for the cases where it does not.
     */
    '/_ipx/**': {
      headers: {
        'cache-control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
      /**
       * Deliberately NOT `cache: { … }`. Nitro's response cache serialises the
       * body as text: a 14 842-byte WebP came back as 53 088 bytes of invalid
       * data — the hit was 1600x faster and the image was broken. Caching
       * these server-side belongs in a CDN or a caching proxy in front of
       * Nitro, not in a route rule.
       */
    },
    // Self-hosted fonts: plain files, not hashed — rename the file if it is
    // ever replaced, rather than shortening this.
    '/fonts/**': {
      headers: { 'cache-control': 'public, max-age=31536000' },
    },
    '/': { swr: 60 },
    '/catalog': { swr: 30 },
    '/catalog/**': { swr: 30 },
    '/product/**': { isr: 900, swr: 900 },
    // Brand pages are aggregates over the catalogue — they only shift when a
    // parser adds or removes products, so they tolerate a longer window than
    // the catalogue itself.
    '/brand': { isr: 900, swr: 900 },
    '/brand/**': { isr: 900, swr: 900 },
    '/sales': { swr: 300 },
    // Static information pages: they change with a deploy, not with the
    // catalogue, so an hour of cache costs nothing.
    '/delivery': { swr: 3600 },
    '/organizaciyam': { swr: 3600 },
    '/about': { swr: 3600 },
    '/contacts': { swr: 3600 },
    '/garantiya': { swr: 3600 },
    '/usloviya': { swr: 3600 },
    '/privacy': { swr: 3600 },
    '/cart': { ssr: false },
    '/checkout/**': { ssr: false },
    // Wishlist and comparison live in localStorage — nothing to render on the
    // server. Both carry noindex meta of their own.
    '/favorites': { ssr: false },
    '/compare': { ssr: false },
    // The account session is an HttpOnly cookie scoped to /api, so SSR never
    // sees it: these pages have nothing to render on the server (own noindex).
    '/login': { ssr: false },
    '/register': { ssr: false },
    '/account': { ssr: false },
    '/verify-email': { ssr: false },
    // «Публичная оферта» переименована в «Условия продажи»: документ больше не
    // оферта. Оба варианта ключом — route rules срабатывают раньше
    // нормализующего middleware, так что редирект получается в один шаг.
    '/oferta': { redirect: { to: '/usloviya', statusCode: 301 } },
    '/oferta/': { redirect: { to: '/usloviya', statusCode: 301 } },
    '/admin': { ssr: false },
    '/admin/**': { ssr: false },
    // `/sitemap.xml` and its child files carry no route cache on purpose: they
    // are all cut from one in-process snapshot (server/utils/sitemap.ts), which
    // is the expensive part and what keeps the index and children consistent.
  },
  nitro: {
    /**
     * Every `swr` response above is kept in Nitro's `cache` storage, and the
     * default production driver is a memory store that never evicts — so the
     * frontend's heap grew with every distinct URL a crawler fetched until the
     * container hit its `mem_limit` and was killed (502s from Caddy while it
     * restarted). This driver is the same in-memory cache with an LRU budget;
     * see server/storage/bounded-memory.ts. `NUXT_CACHE_MAX_MB` overrides the
     * size at runtime.
     */
    storage: {
      cache: {
        driver: fileURLToPath(new URL('./server/storage/bounded-memory.ts', import.meta.url)),
        maxMb: 96,
      },
    },
    // Dev (and the build step itself) keep the stock driver.
    devStorage: {
      cache: { driver: 'memory' },
    },
  },
  runtimeConfig: {
    apiBaseServer: process.env.API_BASE_SERVER || process.env.API_BASE || 'http://localhost:8000',
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '/api',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
      // Must mirror the backend's DELIVERY_COST_* — the API is the authority
      // and recomputes them on every order; these only drive what we promise
      // on the storefront, so a mismatch would show the customer a wrong total.
      deliveryCourier: Number(process.env.DELIVERY_COST_COURIER ?? 15),
      deliveryPost: Number(process.env.DELIVERY_COST_POST ?? 10),
    },
  }
})
