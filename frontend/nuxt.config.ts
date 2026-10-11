// https://nuxt.com/docs/api/configuration/nuxt-config
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
  },
  css: ['@/assets/scss/main.scss'],
  ssr: true,
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
      ],
      meta: [
        { name: 'color-scheme', content: 'light' },
        { name: 'theme-color', content: '#1d4ed8' },
        { name: 'apple-mobile-web-app-title', content: 'Мультитул' },
        // Default social preview; pages with their own image override it.
        { property: 'og:image', content: '/og-image.png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:site_name', content: 'Мультитул' },
        { property: 'og:locale', content: 'ru_RU' },
        { name: 'twitter:image', content: '/og-image.png' },
      ],
    },
  },
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: '@use "@/assets/scss/mixins.scss" as *;'
        }
      }
    }
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
    '/': { swr: 60 },
    '/catalog': { swr: 30 },
    '/catalog/**': { swr: 30 },
    '/product/**': { isr: 900, swr: 900 },
    // Brand pages are aggregates over the catalogue — they only shift when a
    // parser adds or removes products, so they tolerate a longer window than
    // the catalogue itself.
    '/brand': { isr: 900, swr: 900 },
    '/brand/**': { isr: 900, swr: 900 },
    '/cart': { ssr: false },
    '/checkout/**': { ssr: false },
    // Wishlist and comparison live in localStorage — nothing to render on the
    // server. Both carry noindex meta of their own.
    '/favorites': { ssr: false },
    '/compare': { ssr: false },
    // The account session lives in localStorage, so these pages have nothing
    // to render on the server; they carry noindex meta of their own.
    '/login': { ssr: false },
    '/register': { ssr: false },
    '/account': { ssr: false },
    '/admin': { ssr: false },
    '/admin/**': { ssr: false },
    '/sitemap.xml': { swr: 3600 }
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
