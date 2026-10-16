import { useCartStore } from '~/stores/cart'

/**
 * Restores the cart from localStorage and, for a signed-in account, keeps the
 * stored copy in step (see `utils/server-mirror.ts`). A product in both carts
 * keeps the larger quantity — the server does the merge, so two tabs cannot
 * double a line.
 */
export default defineNuxtPlugin(() => {
  const cart = useCartStore()
  const { mergeLocal, replace } = useServerCart()
  const toast = useAppToast()

  mirrorToAccount({
    load: () => cart.load(),
    key: () => cart.items.map(item => `${item.productId}:${item.quantity}`).join(','),
    payload: () =>
      cart.items.map(item => ({ productId: item.productId, quantity: item.quantity })),
    merge: mergeLocal,
    replace,
    apply(server) {
      cart.applyServerCart(
        server.items.map(line => ({
          productId: line.productId,
          slug: line.slug,
          name: line.name,
          sku: line.sku,
          image: line.image,
          // A line with no price is kept at 0 and flagged by the cart screen's
          // own validation, same as any other stale line.
          price: line.price ?? 0,
          currency: line.currency,
          quantity: line.quantity,
        }))
      )
      if (server.dropped.length) {
        toast.warning(
          server.dropped.length === 1
            ? `Товар «${server.dropped[0]?.name || 'без названия'}» больше не доступен и убран из корзины`
            : `${server.dropped.length} товаров больше не доступны и убраны из корзины`
        )
      }
    },
  })
})
