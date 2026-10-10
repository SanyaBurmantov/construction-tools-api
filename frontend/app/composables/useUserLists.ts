export type UserListLine = {
  productId: string
  slug: string
  name: string
  image: string | null
  price: number | null
  oldPrice: number | null
  currency: string
  stockStatus: string | null
  categorySlug: string | null
  categoryName: string | null
}

export type UserLists = {
  wishlist: UserListLine[]
  compare: UserListLine[]
}

export type UserListsPayload = {
  wishlist?: string[]
  compare?: string[]
}

/**
 * The account's favourites and comparison (`/lists` on the API).
 *
 * Same arrangement as the stored cart: localStorage is what the UI renders,
 * this is the copy that survives a new device. Guests never call it.
 */
export function useUserLists() {
  const { authFetch } = useAuth()

  const fetchLists = () => authFetch<UserLists>('/lists')

  /** Sign-in step: union of the browser lists and the stored ones. */
  const mergeLocal = (payload: UserListsPayload) =>
    authFetch<UserLists>('/lists/merge', { method: 'POST', body: payload })

  /** Mirrors a local change up. Last write wins. */
  const replace = (payload: UserListsPayload) =>
    authFetch<UserLists>('/lists', { method: 'PUT', body: payload })

  return { fetchLists, mergeLocal, replace }
}
