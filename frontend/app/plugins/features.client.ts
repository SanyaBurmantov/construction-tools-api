/** Fetches the feature flags once the page is up (see composables/useFeature.ts). */
export default defineNuxtPlugin(() => {
  const modes = useFeatureModes()
  const { apiBase } = useSite()
  onNuxtReady(async () => {
    try {
      const answer = await $fetch<{ flags: Record<string, FeatureMode> }>(`${apiBase}/features`)
      modes.value = answer.flags
    } catch {
      // Defaults stay in force — a flag fetch must never break a page.
    }
  })
})
