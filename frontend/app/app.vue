<template>
  <!-- A thin bar that fills while the next page loads (search, catalogue
       navigation): progress shown gradually instead of a frozen screen. -->
  <NuxtLoadingIndicator color="var(--brand)" :height="3" :throttle="150" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
