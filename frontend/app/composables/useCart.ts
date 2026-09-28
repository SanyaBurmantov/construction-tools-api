type CartProduct = {
  id: string
  slug: string
  name: string
  priceValue?: number | null
  priceCurrency?: string | null
  stockStatus?: string | null
  brand?: { name: string } | null
  category?: { name: string } | null
  images?: Array<{ url: string, alt?: string | null }>
}

type CartItem = {
  product: CartProduct
  quantity: number
}

const CART_STORAGE_KEY = 'multitool-cart'

export function useCart() {
  const items = useState<CartItem[]>('cart-items', () => [])
  const initialized = useState<boolean>('cart-initialized', () => false)
  const isDrawerOpen = useState<boolean>('cart-drawer-open', () => false)
  const notification = useState<string>('cart-notification', () => '')

  if (import.meta.client && !initialized.value) {
    const saved = localStorage.getItem(CART_STORAGE_KEY)

    if (saved) {
      try {
        items.value = JSON.parse(saved)
      } catch {
        items.value = []
      }
    }

    initialized.value = true
  }

  if (import.meta.client) {
    watch(items, value => {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(value))
    }, { deep: true })
  }

  const totalQuantity = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0))
  const totalAmount = computed(() => items.value.reduce((sum, item) => sum + (item.product.priceValue || 0) * item.quantity, 0))

  function getItemQuantity(productId: string) {
    return items.value.find(item => item.product.id === productId)?.quantity || 0
  }

  function addItem(product: CartProduct, quantity = 1) {
    const existing = items.value.find(item => item.product.id === product.id)

    if (existing) {
      existing.quantity += quantity
      showNotification(`Добавили еще: ${product.name}`)
      return
    }

    items.value.push({ product, quantity })
    showNotification(`Добавлено в корзину: ${product.name}`)
  }

  function updateQuantity(productId: string, quantity: number) {
    const item = items.value.find(entry => entry.product.id === productId)
    if (!item) return

    if (quantity <= 0) {
      removeItem(productId)
      return
    }

    item.quantity = quantity
  }

  function removeItem(productId: string) {
    items.value = items.value.filter(item => item.product.id !== productId)
  }

  function clearCart() {
    items.value = []
  }

  function openDrawer() {
    isDrawerOpen.value = true
  }

  function closeDrawer() {
    isDrawerOpen.value = false
  }

  function showNotification(message: string) {
    notification.value = message

    if (import.meta.client) {
      setTimeout(() => {
        if (notification.value === message) {
          notification.value = ''
        }
      }, 2400)
    }
  }

  return {
    items,
    isDrawerOpen,
    notification,
    totalQuantity,
    totalAmount,
    getItemQuantity,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    openDrawer,
    closeDrawer
  }
}
