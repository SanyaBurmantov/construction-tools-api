// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/eslint', '@nuxt/image'],
  css: ['~/assets/css/main.css', '@/assets/css/theme.css', '@/assets/css/fonts.css',],
  ssr: true,
  nitro: {
    preset: "static"
  }
})