
import type { DefineComponent, SlotsType } from 'vue'
type IslandComponent<T> = DefineComponent<{}, {refresh: () => Promise<void>}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, SlotsType<{ fallback: { error: unknown } }>> & T

type HydrationStrategies = {
  hydrateOnVisible?: IntersectionObserverInit | true
  hydrateOnIdle?: number | true
  hydrateOnInteraction?: keyof HTMLElementEventMap | Array<keyof HTMLElementEventMap> | true
  hydrateOnMediaQuery?: string
  hydrateAfter?: number
  hydrateWhen?: boolean
  hydrateNever?: true
}
type LazyComponent<T> = DefineComponent<HydrationStrategies, {}, {}, {}, {}, {}, {}, { hydrated: () => void }> & T


export const AdminParsingCategoryQueuePanel: typeof import("../app/components/admin/parsing/categoryQueuePanel.vue")['default']
export const AdminParsingCronHealth: typeof import("../app/components/admin/parsing/cronHealth.vue")['default']
export const AdminParsingDataQuality: typeof import("../app/components/admin/parsing/dataQuality.vue")['default']
export const AdminParsingErrorLog: typeof import("../app/components/admin/parsing/errorLog.vue")['default']
export const AdminParsingImportProduct: typeof import("../app/components/admin/parsing/importProduct.vue")['default']
export const AdminParsingQueuePanel: typeof import("../app/components/admin/parsing/queuePanel.vue")['default']
export const AdminParsingRunHistory: typeof import("../app/components/admin/parsing/runHistory.vue")['default']
export const AdminParsingSourceControl: typeof import("../app/components/admin/parsing/sourceControl.vue")['default']
export const AdminParsingSourceSummary: typeof import("../app/components/admin/parsing/sourceSummary.vue")['default']
export const AdminProductSourceNote: typeof import("../app/components/admin/productSourceNote.vue")['default']
export const AdminSetupWarnings: typeof import("../app/components/admin/setupWarnings.vue")['default']
export const BrandLogo: typeof import("../app/components/brandLogo.vue")['default']
export const CartIssues: typeof import("../app/components/cart/cartIssues.vue")['default']
export const CatalogView: typeof import("../app/components/catalog/CatalogView.vue")['default']
export const CatalogFilters: typeof import("../app/components/catalog/catalogFilters.vue")['default']
export const HomeHeroBanners: typeof import("../app/components/home/heroBanners.vue")['default']
export const LayoutCompareBar: typeof import("../app/components/layout/compareBar.vue")['default']
export const LayoutFooter: typeof import("../app/components/layout/footer.vue")['default']
export const LayoutHeader: typeof import("../app/components/layout/header.vue")['default']
export const LayoutMobileNav: typeof import("../app/components/layout/mobileNav.vue")['default']
export const ProductCatalogCard: typeof import("../app/components/product/productCatalogCard.vue")['default']
export const ProductCatalogRow: typeof import("../app/components/product/productCatalogRow.vue")['default']
export const ProductGallery: typeof import("../app/components/product/productGallery.vue")['default']
export const ProductReviews: typeof import("../app/components/product/productReviews.vue")['default']
export const UiAlert: typeof import("../app/components/ui/UiAlert.vue")['default']
export const UiBadge: typeof import("../app/components/ui/UiBadge.vue")['default']
export const UiBreadcrumbs: typeof import("../app/components/ui/UiBreadcrumbs.vue")['default']
export const UiButton: typeof import("../app/components/ui/UiButton.vue")['default']
export const UiCard: typeof import("../app/components/ui/UiCard.vue")['default']
export const UiCategoryCard: typeof import("../app/components/ui/UiCategoryCard.vue")['default']
export const UiCheckbox: typeof import("../app/components/ui/UiCheckbox.vue")['default']
export const UiDrawer: typeof import("../app/components/ui/UiDrawer.vue")['default']
export const UiEmpty: typeof import("../app/components/ui/UiEmpty.vue")['default']
export const UiField: typeof import("../app/components/ui/UiField.vue")['default']
export const UiInput: typeof import("../app/components/ui/UiInput.vue")['default']
export const UiModal: typeof import("../app/components/ui/UiModal.vue")['default']
export const UiPagination: typeof import("../app/components/ui/UiPagination.vue")['default']
export const UiPrice: typeof import("../app/components/ui/UiPrice.vue")['default']
export const UiQuantity: typeof import("../app/components/ui/UiQuantity.vue")['default']
export const UiRating: typeof import("../app/components/ui/UiRating.vue")['default']
export const UiScroller: typeof import("../app/components/ui/UiScroller.vue")['default']
export const UiSelect: typeof import("../app/components/ui/UiSelect.vue")['default']
export const UiSkeleton: typeof import("../app/components/ui/UiSkeleton.vue")['default']
export const UiStat: typeof import("../app/components/ui/UiStat.vue")['default']
export const UiTable: typeof import("../app/components/ui/UiTable.vue")['default']
export const UiTabs: typeof import("../app/components/ui/UiTabs.vue")['default']
export const UiTextarea: typeof import("../app/components/ui/UiTextarea.vue")['default']
export const UiToaster: typeof import("../app/components/ui/UiToaster.vue")['default']
export const NuxtWelcome: typeof import("../node_modules/nuxt/dist/app/components/welcome.vue")['default']
export const NuxtLayout: typeof import("../node_modules/nuxt/dist/app/components/nuxt-layout")['default']
export const NuxtErrorBoundary: typeof import("../node_modules/nuxt/dist/app/components/nuxt-error-boundary.vue")['default']
export const ClientOnly: typeof import("../node_modules/nuxt/dist/app/components/client-only")['default']
export const DevOnly: typeof import("../node_modules/nuxt/dist/app/components/dev-only")['default']
export const ServerPlaceholder: typeof import("../node_modules/nuxt/dist/app/components/server-placeholder")['default']
export const NuxtLink: typeof import("../node_modules/nuxt/dist/app/components/nuxt-link")['default']
export const NuxtLoadingIndicator: typeof import("../node_modules/nuxt/dist/app/components/nuxt-loading-indicator")['default']
export const NuxtTime: typeof import("../node_modules/nuxt/dist/app/components/nuxt-time.vue")['default']
export const NuxtRouteAnnouncer: typeof import("../node_modules/nuxt/dist/app/components/nuxt-route-announcer")['default']
export const NuxtImg: typeof import("../node_modules/@nuxt/image/dist/runtime/components/NuxtImg.vue")['default']
export const NuxtPicture: typeof import("../node_modules/@nuxt/image/dist/runtime/components/NuxtPicture.vue")['default']
export const NuxtPage: typeof import("../node_modules/nuxt/dist/pages/runtime/page")['default']
export const NoScript: typeof import("../node_modules/nuxt/dist/head/runtime/components")['NoScript']
export const Link: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Link']
export const Base: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Base']
export const Title: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Title']
export const Meta: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Meta']
export const Style: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Style']
export const Head: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Head']
export const Html: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Html']
export const Body: typeof import("../node_modules/nuxt/dist/head/runtime/components")['Body']
export const NuxtIsland: typeof import("../node_modules/nuxt/dist/app/components/nuxt-island")['default']
export const LazyAdminParsingCategoryQueuePanel: LazyComponent<typeof import("../app/components/admin/parsing/categoryQueuePanel.vue")['default']>
export const LazyAdminParsingCronHealth: LazyComponent<typeof import("../app/components/admin/parsing/cronHealth.vue")['default']>
export const LazyAdminParsingDataQuality: LazyComponent<typeof import("../app/components/admin/parsing/dataQuality.vue")['default']>
export const LazyAdminParsingErrorLog: LazyComponent<typeof import("../app/components/admin/parsing/errorLog.vue")['default']>
export const LazyAdminParsingImportProduct: LazyComponent<typeof import("../app/components/admin/parsing/importProduct.vue")['default']>
export const LazyAdminParsingQueuePanel: LazyComponent<typeof import("../app/components/admin/parsing/queuePanel.vue")['default']>
export const LazyAdminParsingRunHistory: LazyComponent<typeof import("../app/components/admin/parsing/runHistory.vue")['default']>
export const LazyAdminParsingSourceControl: LazyComponent<typeof import("../app/components/admin/parsing/sourceControl.vue")['default']>
export const LazyAdminParsingSourceSummary: LazyComponent<typeof import("../app/components/admin/parsing/sourceSummary.vue")['default']>
export const LazyAdminProductSourceNote: LazyComponent<typeof import("../app/components/admin/productSourceNote.vue")['default']>
export const LazyAdminSetupWarnings: LazyComponent<typeof import("../app/components/admin/setupWarnings.vue")['default']>
export const LazyBrandLogo: LazyComponent<typeof import("../app/components/brandLogo.vue")['default']>
export const LazyCartIssues: LazyComponent<typeof import("../app/components/cart/cartIssues.vue")['default']>
export const LazyCatalogView: LazyComponent<typeof import("../app/components/catalog/CatalogView.vue")['default']>
export const LazyCatalogFilters: LazyComponent<typeof import("../app/components/catalog/catalogFilters.vue")['default']>
export const LazyHomeHeroBanners: LazyComponent<typeof import("../app/components/home/heroBanners.vue")['default']>
export const LazyLayoutCompareBar: LazyComponent<typeof import("../app/components/layout/compareBar.vue")['default']>
export const LazyLayoutFooter: LazyComponent<typeof import("../app/components/layout/footer.vue")['default']>
export const LazyLayoutHeader: LazyComponent<typeof import("../app/components/layout/header.vue")['default']>
export const LazyLayoutMobileNav: LazyComponent<typeof import("../app/components/layout/mobileNav.vue")['default']>
export const LazyProductCatalogCard: LazyComponent<typeof import("../app/components/product/productCatalogCard.vue")['default']>
export const LazyProductCatalogRow: LazyComponent<typeof import("../app/components/product/productCatalogRow.vue")['default']>
export const LazyProductGallery: LazyComponent<typeof import("../app/components/product/productGallery.vue")['default']>
export const LazyProductReviews: LazyComponent<typeof import("../app/components/product/productReviews.vue")['default']>
export const LazyUiAlert: LazyComponent<typeof import("../app/components/ui/UiAlert.vue")['default']>
export const LazyUiBadge: LazyComponent<typeof import("../app/components/ui/UiBadge.vue")['default']>
export const LazyUiBreadcrumbs: LazyComponent<typeof import("../app/components/ui/UiBreadcrumbs.vue")['default']>
export const LazyUiButton: LazyComponent<typeof import("../app/components/ui/UiButton.vue")['default']>
export const LazyUiCard: LazyComponent<typeof import("../app/components/ui/UiCard.vue")['default']>
export const LazyUiCategoryCard: LazyComponent<typeof import("../app/components/ui/UiCategoryCard.vue")['default']>
export const LazyUiCheckbox: LazyComponent<typeof import("../app/components/ui/UiCheckbox.vue")['default']>
export const LazyUiDrawer: LazyComponent<typeof import("../app/components/ui/UiDrawer.vue")['default']>
export const LazyUiEmpty: LazyComponent<typeof import("../app/components/ui/UiEmpty.vue")['default']>
export const LazyUiField: LazyComponent<typeof import("../app/components/ui/UiField.vue")['default']>
export const LazyUiInput: LazyComponent<typeof import("../app/components/ui/UiInput.vue")['default']>
export const LazyUiModal: LazyComponent<typeof import("../app/components/ui/UiModal.vue")['default']>
export const LazyUiPagination: LazyComponent<typeof import("../app/components/ui/UiPagination.vue")['default']>
export const LazyUiPrice: LazyComponent<typeof import("../app/components/ui/UiPrice.vue")['default']>
export const LazyUiQuantity: LazyComponent<typeof import("../app/components/ui/UiQuantity.vue")['default']>
export const LazyUiRating: LazyComponent<typeof import("../app/components/ui/UiRating.vue")['default']>
export const LazyUiScroller: LazyComponent<typeof import("../app/components/ui/UiScroller.vue")['default']>
export const LazyUiSelect: LazyComponent<typeof import("../app/components/ui/UiSelect.vue")['default']>
export const LazyUiSkeleton: LazyComponent<typeof import("../app/components/ui/UiSkeleton.vue")['default']>
export const LazyUiStat: LazyComponent<typeof import("../app/components/ui/UiStat.vue")['default']>
export const LazyUiTable: LazyComponent<typeof import("../app/components/ui/UiTable.vue")['default']>
export const LazyUiTabs: LazyComponent<typeof import("../app/components/ui/UiTabs.vue")['default']>
export const LazyUiTextarea: LazyComponent<typeof import("../app/components/ui/UiTextarea.vue")['default']>
export const LazyUiToaster: LazyComponent<typeof import("../app/components/ui/UiToaster.vue")['default']>
export const LazyNuxtWelcome: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/welcome.vue")['default']>
export const LazyNuxtLayout: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-layout")['default']>
export const LazyNuxtErrorBoundary: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-error-boundary.vue")['default']>
export const LazyClientOnly: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/client-only")['default']>
export const LazyDevOnly: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/dev-only")['default']>
export const LazyServerPlaceholder: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/server-placeholder")['default']>
export const LazyNuxtLink: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-link")['default']>
export const LazyNuxtLoadingIndicator: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-loading-indicator")['default']>
export const LazyNuxtTime: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-time.vue")['default']>
export const LazyNuxtRouteAnnouncer: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-route-announcer")['default']>
export const LazyNuxtImg: LazyComponent<typeof import("../node_modules/@nuxt/image/dist/runtime/components/NuxtImg.vue")['default']>
export const LazyNuxtPicture: LazyComponent<typeof import("../node_modules/@nuxt/image/dist/runtime/components/NuxtPicture.vue")['default']>
export const LazyNuxtPage: LazyComponent<typeof import("../node_modules/nuxt/dist/pages/runtime/page")['default']>
export const LazyNoScript: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['NoScript']>
export const LazyLink: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Link']>
export const LazyBase: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Base']>
export const LazyTitle: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Title']>
export const LazyMeta: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Meta']>
export const LazyStyle: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Style']>
export const LazyHead: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Head']>
export const LazyHtml: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Html']>
export const LazyBody: LazyComponent<typeof import("../node_modules/nuxt/dist/head/runtime/components")['Body']>
export const LazyNuxtIsland: LazyComponent<typeof import("../node_modules/nuxt/dist/app/components/nuxt-island")['default']>

export const componentNames: string[]
