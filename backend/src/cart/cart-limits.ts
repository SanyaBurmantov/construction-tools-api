/**
 * One set of cart limits for the storefront cart, the stored cart,
 * `POST /cart/validate` and `POST /orders` — if they disagree, a cart the UI
 * accepted is refused at checkout. Sized for a company's purchase request
 * (screws by the thousand, a few hundred lines of consumables), not a
 * household basket: 999 × 100 turned such an order away.
 * The frontend mirrors these in `stores/cart.ts`.
 */
export const MAX_LINE_QUANTITY = 9999;
export const MAX_CART_LINES = 300;
