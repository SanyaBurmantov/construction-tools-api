/**
 * Which recommendation block put a line in the cart. Stored on the order line
 * (`OrderItem.upsellSource`) for the admin's upsell report; the storefront
 * sends it, nothing trusts it.
 */
export const UPSELL_SOURCES = [
  'accessories', // «Аксессуары и расходники» stated for this model
  'consumables', // the same block, by standard (disc 125, LXT, SDS-plus…)
  'fits', // «Подходит для»
  'similar', // «Похожие товары»
  'cart', // «Не забудьте к заказу» in the cart
  'packs', // another pack of the same item
] as const;

export type UpsellSource = (typeof UPSELL_SOURCES)[number];

export const UPSELL_LABELS: Record<UpsellSource, string> = {
  accessories: 'Аксессуары к модели',
  consumables: 'Расходники по стандарту',
  fits: 'Подходит для',
  similar: 'Похожие товары',
  cart: 'Корзина: не забудьте',
  packs: 'Другая фасовка',
};
