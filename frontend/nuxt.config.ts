// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/eslint', '@nuxt/image'],
  ui: { colorMode: false },
  app: {
    head: {
      meta: [{ name: 'color-scheme', content: 'light' }],
    },
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
    '/': { swr: 60 },
    '/catalog': { swr: 30 },
    '/catalog/**': { swr: 30 },
    '/product/**': { isr: 900, swr: 900 },
    '/cart': { ssr: false },
    '/checkout/**': { ssr: false },
    // Wishlist and comparison live in localStorage — nothing to render on the
    // server. Both carry noindex meta of their own.
    '/favorites': { ssr: false },
    '/compare': { ssr: false },
    '/admin': { ssr: false },
    '/admin/**': { ssr: false },
    '/sitemap.xml': { swr: 3600 }
  },
  build: {
    transpile: ['vuetify'],
  },
  runtimeConfig: {
    apiBaseServer: process.env.API_BASE_SERVER || process.env.API_BASE || 'http://localhost:8000',
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '/api',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    },
  }
})
