// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/eslint', '@nuxt/image'],
  css: ['@/assets/scss/main.scss'],
  ssr: true,
  vite: {
    server: {
      watch: {
        usePolling: true,
        interval: 1000,
      },
      hmr: {
        protocol: 'ws',
        host: 'localhost',
        port: 3000,
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: '@import "@/assets/scss/mixins.scss";'
        }
      }
    }
  },
  nitro: {
    preset: "static"
  },
  routeRules: {
    '/': { prerender: true },
    '/category/**': { isr: 3600 },
    '/product/**': { isr: 86400 }
  },
  build: {
    transpile: ['vuetify'],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.API_BASE || 'http://localhost:8000',
    },
  }
})