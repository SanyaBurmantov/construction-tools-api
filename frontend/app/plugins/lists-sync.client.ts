import { useWishlistStore } from '~/stores/wishlist'
import { useCompareStore } from '~/stores/compare'
import type { UserListLine } from '~/composables/useUserLists'

/**
 * Restores favourites and comparison from localStorage and, for a signed-in
 * account, keeps the stored copies in step — the same machine as the cart
 * (`utils/server-mirror.ts`). Lists are sets, so there is nothing to reconcile
 * beyond membership.
 */
export default defineNuxtPlugin(() => {
  const wishlist = useWishlistStore()
  const compare = useCompareStore()
  const { mergeLocal, replace, fetchStored } = useUserLists()

  const toEntry = (line: UserListLine) => ({
    productId: line.productId,
    slug: line.slug,
    name: line.name,
    image: line.image,
    price: line.price,
    oldPrice: line.oldPrice,
    currency: line.currency,
  })

  mirrorToAccount({
    name: 'lists',
    fetch: fetchStored,
    reset() {
      wishlist.clear()
      compare.clear()
    },
    load() {
      wishlist.load()
      compare.load()
    },
    // Membership only: a price refresh is not a change to the list.
    key: () => [
      wishlist.items.map(item => item.productId).join(','),
      compare.items.map(item => item.productId).join(','),
    ].join('|'),
    payload: () => ({
      wishlist: wishlist.items.map(item => item.productId),
      compare: compare.items.map(item => item.productId),
    }),
    merge: mergeLocal,
    replace,
    apply(lists) {
      wishlist.applyServerList(lists.wishlist.map(toEntry))
      compare.applyServerList(
        lists.compare.map(line => ({
          ...toEntry(line),
          categorySlug: line.categorySlug,
          categoryName: line.categoryName,
        }))
      )
    },
  })
})
