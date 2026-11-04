/**
 * Feature flags (backend `features/`, switched in /admin/features).
 *
 * Loaded client-side once the page is ready (`plugins/features.client.ts`):
 * storefront HTML is cached and shared, so the server never decides per
 * visitor, and a flag can never make a cached page wrong. Until the answer
 * arrives — or when it fails — each flag has its code default, mirrored from
 * the backend registry, so a kill switch defaults to «on» and a new feature to
 * «off». `admins` mode shows the feature to a signed-in admin only.
 */
export type FeatureMode = 'off' | 'admins' | 'on'

export const FEATURE_DEFAULTS: Record<string, FeatureMode> = {
  'cart-suggestions': 'on',
  'client-error-reports': 'on',
}

export function useFeatureModes() {
  return useState<Record<string, FeatureMode> | null>('feature-modes', () => null)
}

export function useFeature(key: string) {
  const modes = useFeatureModes()
  const { isAdmin } = useAuth()
  return computed(() => {
    const mode = modes.value?.[key] ?? FEATURE_DEFAULTS[key] ?? 'off'
    return mode === 'on' || (mode === 'admins' && isAdmin.value)
  })
}
