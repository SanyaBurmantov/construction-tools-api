export interface ProductImage {
    src: string
    srcset: string
    alt: string
}

export interface ProductFeature {
    name: string
    value: string
}

export interface ProductPrice {
    current: string
    currency: string
    full: string
}

export interface ProductData {
    id: string
    sku_id: string
    url: string
    name: string
    brand: string
    code: string
    article: string
    availability: string
    availability_status: "in_stock" | "out_of_stock" | string
    price: ProductPrice
    images: ProductImage[]
    rating: number
    max_rating: number
    features: ProductFeature[]
    description: string
    quick_view_url: string
    add_to_cart_action: string
    default_quantity: number
}