<script setup lang="ts">
import { defaultOgImageUrl } from '~/utils/og-image'

// The default social preview, as an absolute URL (a relative og:image is
// ignored by Telegram, VK and Facebook). It lives here rather than in
// nuxt.config's `app.head`, which is fixed at build time while the site
// origin is runtime config. Pages with their own picture override it.
const defaultImage = defaultOgImageUrl(useSite().siteUrl)
useSeoMeta({ ogImage: defaultImage, twitterImage: defaultImage })
</script>

<template>
  <!-- A thin bar that fills while the next page loads (search, catalogue
       navigation): progress shown gradually instead of a frozen screen. -->
  <NuxtLoadingIndicator color="var(--brand)" :height="3" :throttle="150" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
