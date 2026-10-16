/**
 * try → toast → reload → catch → toast, written once.
 *
 * Admin screens repeated this block ~46 times. `run()` resolves to the
 * request's result, or `undefined` when it failed (the error is already
 * toasted), so a caller can still branch — e.g. keep a modal open on failure.
 * `busy` holds the key of the running action ('' when idle), so a list can
 * spin just the row being changed.
 */
export function useAdminAction() {
  const { errorMessage } = useAdminApi()
  const toast = useAppToast()
  const busy = ref('')

  async function run<R>(
    fn: () => Promise<R>,
    options: {
      error: string
      success?: string | ((result: R) => string)
      key?: string
      after?: (result: R) => unknown
    },
  ): Promise<R | undefined> {
    busy.value = options.key ?? 'action'
    try {
      const result = await fn()
      const message
        = typeof options.success === 'function' ? options.success(result) : options.success
      if (message) toast.success(message)
      await options.after?.(result)
      return result
    } catch (error) {
      toast.error(errorMessage(error, options.error))
      return undefined
    } finally {
      busy.value = ''
    }
  }

  return { run, busy }
}
