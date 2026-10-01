// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV !== 'production' },
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/eslint', '@nuxt/image'],
  css: ['@/assets/scss/main.scss'],
  ssr: true,
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
