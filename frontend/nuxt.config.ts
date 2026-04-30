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
    '/': { isr: 3600 },
    '/catalog/**': { ssr: true },
    '/product/**': { isr: 86400 },
    '/admin/**': { ssr: false },
    '/api/**': { proxy: `${process.env.API_BASE_SERVER || process.env.API_BASE || 'http://localhost:8000'}/**` }
  },
  build: {
    transpile: ['vuetify'],
  },
  runtimeConfig: {
    apiBaseServer: process.env.API_BASE_SERVER || process.env.API_BASE || 'http://localhost:8000',
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '/api',
    },
  }
})
