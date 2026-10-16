/** `Product.status` vocabulary, declared once for the admin screens. */
export type ProductStatus = 'PUBLISHED' | 'DRAFT' | 'HIDDEN' | 'ARCHIVED'

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  PUBLISHED: 'Опубликован',
  DRAFT: 'Черновик',
  HIDDEN: 'Скрыт',
  ARCHIVED: 'Архив',
}

export const PRODUCT_STATUS_TONE: Record<ProductStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  PUBLISHED: 'success',
  DRAFT: 'neutral',
  HIDDEN: 'warning',
  ARCHIVED: 'danger',
}

export const productStatusOptions = (withAll = false) => [
  ...(withAll ? [{ value: '', label: 'Все статусы' }] : []),
  ...(Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[]).map(value => ({
    value,
    label: PRODUCT_STATUS_LABEL[value],
  })),
]
