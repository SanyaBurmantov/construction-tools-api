export type ProductImage = {
  url: string
  alt?: string
  order?: number
}

export type ProductSpec = {
  name: string
  value: string
}

export type ProductPrice = {
  value?: number
  currency?: string
  oldValue?: number
}

export type ProductStock = {
  status?: string
  quantity?: number
}

export type ProductDescription = {
  short?: string
  full?: string
  features?: string[]
}

export type ProductSeo = {
  title?: string
  description?: string
  keywords?: string[]
}

export type TProduct = {
  id?: string

  name: string
  slug: string

  brand?: string
  brandId?: string

  categoryId: string

  sku?: string
  barcode?: string
  model?: string

  price?: ProductPrice
  stock?: ProductStock

  images?: ProductImage[]

  specs?: ProductSpec[]

  description?: ProductDescription

  seo?: ProductSeo
}