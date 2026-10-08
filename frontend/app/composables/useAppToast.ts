export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
  title?: string
  timeout: number
}

let nextId = 0

/**
 * App-wide toast queue. Shared via `useState` so any component can push and the
 * single <UiToaster> in the layout renders them.
 */
export function useAppToast() {
  const toasts = useState<Toast[]>('toasts', () => [])

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function push(
    message: string,
    options: { tone?: ToastTone, title?: string, timeout?: number } = {}
  ) {
    const toast: Toast = {
      id: (nextId += 1),
      message,
      tone: options.tone ?? 'info',
      title: options.title,
      timeout: options.timeout ?? 3500,
    }
    toasts.value = [...toasts.value, toast]

    if (import.meta.client && toast.timeout > 0) {
      setTimeout(() => dismiss(toast.id), toast.timeout)
    }
    return toast.id
  }

  return {
    toasts,
    dismiss,
    push,
    success: (message: string, title?: string) => push(message, { tone: 'success', title }),
    error: (message: string, title?: string) =>
      push(message, { tone: 'danger', title, timeout: 6000 }),
    info: (message: string, title?: string) => push(message, { tone: 'info', title }),
    warning: (message: string, title?: string) => push(message, { tone: 'warning', title }),
  }
}
