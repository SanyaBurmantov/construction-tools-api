import type { AiStatus } from '~/types/ai'

/**
 * `/admin/ai/status` shared by the AI screens: whether the key is set, the
 * default model, the field catalogue and today's free quota.
 */
export function useAiStatus() {
  const { adminFetch } = useAdminApi()
  const status = useState<AiStatus | null>('ai-status', () => null)

  async function loadStatus() {
    try {
      status.value = await adminFetch<AiStatus>('/ai/status')
    } catch {
      // Decoration: the screens work without it.
    }
    return status.value
  }

  return { status, loadStatus }
}
