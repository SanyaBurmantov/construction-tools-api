/**
 * Order vocabulary, declared once.
 *
 * Status, delivery and payment labels used to be re-declared in five screens
 * and had already drifted (INVOICE read «По счёту» in one and «Счёт (для юр.
 * лиц)» in another; the dashboard still listed a `COMPLETED` status the
 * database never had).
 */
import type { DeliveryMethod, OrderStatus, PaymentMethod } from '~/types/api'
import type { CustomerType } from '~/composables/useAuth'

type Tone = 'neutral' | 'brand' | 'info' | 'warning' | 'success' | 'danger'

export const ORDER_STATUSES: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
]

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  PROCESSING: 'Собирается',
  SHIPPED: 'Отправлен',
  DELIVERED: 'Доставлен',
  CANCELLED: 'Отменён',
}

/** Plural form for filters and counters: «Новые», «Доставленные»… */
export const ORDER_STATUS_PLURAL: Record<OrderStatus, string> = {
  NEW: 'Новые',
  CONFIRMED: 'Подтверждённые',
  PROCESSING: 'В сборке',
  SHIPPED: 'Отправленные',
  DELIVERED: 'Доставленные',
  CANCELLED: 'Отменённые',
}

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  NEW: 'info',
  CONFIRMED: 'info',
  PROCESSING: 'warning',
  SHIPPED: 'warning',
  DELIVERED: 'success',
  CANCELLED: 'danger',
}

/** Delivered and cancelled are terminal. */
export const FINISHED_ORDER_STATUSES: OrderStatus[] = ['DELIVERED', 'CANCELLED']

export const isActiveOrder = (status: OrderStatus) =>
  !FINISHED_ORDER_STATUSES.includes(status)

/** `<UiSelect>` options, singular labels; `withAll` prepends «Все статусы». */
export function orderStatusOptions(options: { plural?: boolean, withAll?: boolean } = {}) {
  const labels = options.plural ? ORDER_STATUS_PLURAL : ORDER_STATUS_LABEL
  const list = ORDER_STATUSES.map(value => ({ value, label: labels[value] }))
  return options.withAll ? [{ value: '', label: 'Все статусы' }, ...list] : list
}

/** Next steps offered for the current status — cancelling is always allowed until it ends. */
export function nextOrderStatuses(status: OrderStatus): OrderStatus[] {
  if (!isActiveOrder(status)) return []
  const next = ORDER_STATUSES[ORDER_STATUSES.indexOf(status) + 1]
  return next && next !== 'CANCELLED' ? [next, 'CANCELLED'] : ['CANCELLED']
}

export const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
  PICKUP: 'Самовывоз',
  COURIER: 'Курьер',
  POST: 'Почта',
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Наличными',
  CARD: 'Картой',
  INVOICE: 'По счёту',
}

export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  INDIVIDUAL: 'Физическое лицо',
  COMPANY: 'Юридическое лицо',
}
