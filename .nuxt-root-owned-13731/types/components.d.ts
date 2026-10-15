
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

interface _GlobalComponents {
  'AdminParsingCategoryQueuePanel': typeof import("../../app/components/admin/parsing/categoryQueuePanel.vue")['default']
  'AdminParsingCronHealth': typeof import("../../app/components/admin/parsing/cronHealth.vue")['default']
  'AdminParsingDataQuality': typeof import("../../app/components/admin/parsing/dataQuality.vue")['default']
  'AdminParsingErrorLog': typeof import("../../app/components/admin/parsing/errorLog.vue")['default']
  'AdminParsingImportProduct': typeof import("../../app/components/admin/parsing/importProduct.vue")['default']
  'AdminParsingQueuePanel': typeof import("../../app/components/admin/parsing/queuePanel.vue")['default']
  'AdminParsingRunHistory': typeof import("../../app/components/admin/parsing/runHistory.vue")['default']
  'AdminParsingSourceControl': typeof import("../../app/components/admin/parsing/sourceControl.vue")['default']
  'AdminParsingSourceSummary': typeof import("../../app/components/admin/parsing/sourceSummary.vue")['default']
  'AdminProductSourceNote': typeof import("../../app/components/admin/productSourceNote.vue")['default']
  'AdminSetupWarnings': typeof import("../../app/components/admin/setupWarnings.vue")['default']
  'BrandLogo': typeof import("../../app/components/brandLogo.vue")['default']
  'CartIssues': typeof import("../../app/components/cart/cartIssues.vue")['default']
  'CatalogView': typeof import("../../app/components/catalog/CatalogView.vue")['default']
  'CatalogFilters': typeof import("../../app/components/catalog/catalogFilters.vue")['default']
  'HomeHeroBanners': typeof import("../../app/components/home/heroBanners.vue")['default']
  'LayoutCompareBar': typeof import("../../app/components/layout/compareBar.vue")['default']
  'LayoutFooter': typeof import("../../app/components/layout/footer.vue")['default']
  'LayoutHeader': typeof import("../../app/components/layout/header.vue")['default']
  'LayoutMobileNav': typeof import("../../app/components/layout/mobileNav.vue")['default']
  'ProductCatalogCard': typeof import("../../app/components/product/productCatalogCard.vue")['default']
  'ProductCatalogRow': typeof import("../../app/components/product/productCatalogRow.vue")['default']
  'ProductGallery': typeof import("../../app/components/product/productGallery.vue")['default']
  'ProductReviews': typeof import("../../app/components/product/productReviews.vue")['default']
  'UiAlert': typeof import("../../app/components/ui/UiAlert.vue")['default']
  'UiBadge': typeof import("../../app/components/ui/UiBadge.vue")['default']
  'UiBreadcrumbs': typeof import("../../app/components/ui/UiBreadcrumbs.vue")['default']
  'UiButton': typeof import("../../app/components/ui/UiButton.vue")['default']
  'UiCard': typeof import("../../app/components/ui/UiCard.vue")['default']
  'UiCategoryCard': typeof import("../../app/components/ui/UiCategoryCard.vue")['default']
  'UiCheckbox': typeof import("../../app/components/ui/UiCheckbox.vue")['default']
  'UiDrawer': typeof import("../../app/components/ui/UiDrawer.vue")['default']
  'UiEmpty': typeof import("../../app/components/ui/UiEmpty.vue")['default']
  'UiField': typeof import("../../app/components/ui/UiField.vue")['default']
  'UiInput': typeof import("../../app/components/ui/UiInput.vue")['default']
  'UiModal': typeof import("../../app/components/ui/UiModal.vue")['default']
  'UiPagination': typeof import("../../app/components/ui/UiPagination.vue")['default']
  'UiPrice': typeof import("../../app/components/ui/UiPrice.vue")['default']
  'UiQuantity': typeof import("../../app/components/ui/UiQuantity.vue")['default']
  'UiRating': typeof import("../../app/components/ui/UiRating.vue")['default']
  'UiScroller': typeof import("../../app/components/ui/UiScroller.vue")['default']
  'UiSelect': typeof import("../../app/components/ui/UiSelect.vue")['default']
  'UiSkeleton': typeof import("../../app/components/ui/UiSkeleton.vue")['default']
  'UiStat': typeof import("../../app/components/ui/UiStat.vue")['default']
  'UiTable': typeof import("../../app/components/ui/UiTable.vue")['default']
  'UiTabs': typeof import("../../app/components/ui/UiTabs.vue")['default']
  'UiTextarea': typeof import("../../app/components/ui/UiTextarea.vue")['default']
  'UiToaster': typeof import("../../app/components/ui/UiToaster.vue")['default']
  'NuxtWelcome': typeof import("../../node_modules/nuxt/dist/app/components/welcome.vue")['default']
  'NuxtLayout': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-layout")['default']
  'NuxtErrorBoundary': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-error-boundary.vue")['default']
  'ClientOnly': typeof import("../../node_modules/nuxt/dist/app/components/client-only")['default']
  'DevOnly': typeof import("../../node_modules/nuxt/dist/app/components/dev-only")['default']
  'ServerPlaceholder': typeof import("../../node_modules/nuxt/dist/app/components/server-placeholder")['default']
  'NuxtLink': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-link")['default']
  'NuxtLoadingIndicator': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-loading-indicator")['default']
  'NuxtTime': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-time.vue")['default']
  'NuxtRouteAnnouncer': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-route-announcer")['default']
  'NuxtImg': typeof import("../../node_modules/@nuxt/image/dist/runtime/components/NuxtImg.vue")['default']
  'NuxtPicture': typeof import("../../node_modules/@nuxt/image/dist/runtime/components/NuxtPicture.vue")['default']
  'NuxtPage': typeof import("../../node_modules/nuxt/dist/pages/runtime/page")['default']
  'NoScript': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['NoScript']
  'Link': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Link']
  'Base': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Base']
  'Title': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Title']
  'Meta': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Meta']
  'Style': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Style']
  'Head': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Head']
  'Html': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Html']
  'Body': typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Body']
  'NuxtIsland': typeof import("../../node_modules/nuxt/dist/app/components/nuxt-island")['default']
  'LazyAdminParsingCategoryQueuePanel': LazyComponent<typeof import("../../app/components/admin/parsing/categoryQueuePanel.vue")['default']>
  'LazyAdminParsingCronHealth': LazyComponent<typeof import("../../app/components/admin/parsing/cronHealth.vue")['default']>
  'LazyAdminParsingDataQuality': LazyComponent<typeof import("../../app/components/admin/parsing/dataQuality.vue")['default']>
  'LazyAdminParsingErrorLog': LazyComponent<typeof import("../../app/components/admin/parsing/errorLog.vue")['default']>
  'LazyAdminParsingImportProduct': LazyComponent<typeof import("../../app/components/admin/parsing/importProduct.vue")['default']>
  'LazyAdminParsingQueuePanel': LazyComponent<typeof import("../../app/components/admin/parsing/queuePanel.vue")['default']>
  'LazyAdminParsingRunHistory': LazyComponent<typeof import("../../app/components/admin/parsing/runHistory.vue")['default']>
  'LazyAdminParsingSourceControl': LazyComponent<typeof import("../../app/components/admin/parsing/sourceControl.vue")['default']>
  'LazyAdminParsingSourceSummary': LazyComponent<typeof import("../../app/components/admin/parsing/sourceSummary.vue")['default']>
  'LazyAdminProductSourceNote': LazyComponent<typeof import("../../app/components/admin/productSourceNote.vue")['default']>
  'LazyAdminSetupWarnings': LazyComponent<typeof import("../../app/components/admin/setupWarnings.vue")['default']>
  'LazyBrandLogo': LazyComponent<typeof import("../../app/components/brandLogo.vue")['default']>
  'LazyCartIssues': LazyComponent<typeof import("../../app/components/cart/cartIssues.vue")['default']>
  'LazyCatalogView': LazyComponent<typeof import("../../app/components/catalog/CatalogView.vue")['default']>
  'LazyCatalogFilters': LazyComponent<typeof import("../../app/components/catalog/catalogFilters.vue")['default']>
  'LazyHomeHeroBanners': LazyComponent<typeof import("../../app/components/home/heroBanners.vue")['default']>
  'LazyLayoutCompareBar': LazyComponent<typeof import("../../app/components/layout/compareBar.vue")['default']>
  'LazyLayoutFooter': LazyComponent<typeof import("../../app/components/layout/footer.vue")['default']>
  'LazyLayoutHeader': LazyComponent<typeof import("../../app/components/layout/header.vue")['default']>
  'LazyLayoutMobileNav': LazyComponent<typeof import("../../app/components/layout/mobileNav.vue")['default']>
  'LazyProductCatalogCard': LazyComponent<typeof import("../../app/components/product/productCatalogCard.vue")['default']>
  'LazyProductCatalogRow': LazyComponent<typeof import("../../app/components/product/productCatalogRow.vue")['default']>
  'LazyProductGallery': LazyComponent<typeof import("../../app/components/product/productGallery.vue")['default']>
  'LazyProductReviews': LazyComponent<typeof import("../../app/components/product/productReviews.vue")['default']>
  'LazyUiAlert': LazyComponent<typeof import("../../app/components/ui/UiAlert.vue")['default']>
  'LazyUiBadge': LazyComponent<typeof import("../../app/components/ui/UiBadge.vue")['default']>
  'LazyUiBreadcrumbs': LazyComponent<typeof import("../../app/components/ui/UiBreadcrumbs.vue")['default']>
  'LazyUiButton': LazyComponent<typeof import("../../app/components/ui/UiButton.vue")['default']>
  'LazyUiCard': LazyComponent<typeof import("../../app/components/ui/UiCard.vue")['default']>
  'LazyUiCategoryCard': LazyComponent<typeof import("../../app/components/ui/UiCategoryCard.vue")['default']>
  'LazyUiCheckbox': LazyComponent<typeof import("../../app/components/ui/UiCheckbox.vue")['default']>
  'LazyUiDrawer': LazyComponent<typeof import("../../app/components/ui/UiDrawer.vue")['default']>
  'LazyUiEmpty': LazyComponent<typeof import("../../app/components/ui/UiEmpty.vue")['default']>
  'LazyUiField': LazyComponent<typeof import("../../app/components/ui/UiField.vue")['default']>
  'LazyUiInput': LazyComponent<typeof import("../../app/components/ui/UiInput.vue")['default']>
  'LazyUiModal': LazyComponent<typeof import("../../app/components/ui/UiModal.vue")['default']>
  'LazyUiPagination': LazyComponent<typeof import("../../app/components/ui/UiPagination.vue")['default']>
  'LazyUiPrice': LazyComponent<typeof import("../../app/components/ui/UiPrice.vue")['default']>
  'LazyUiQuantity': LazyComponent<typeof import("../../app/components/ui/UiQuantity.vue")['default']>
  'LazyUiRating': LazyComponent<typeof import("../../app/components/ui/UiRating.vue")['default']>
  'LazyUiScroller': LazyComponent<typeof import("../../app/components/ui/UiScroller.vue")['default']>
  'LazyUiSelect': LazyComponent<typeof import("../../app/components/ui/UiSelect.vue")['default']>
  'LazyUiSkeleton': LazyComponent<typeof import("../../app/components/ui/UiSkeleton.vue")['default']>
  'LazyUiStat': LazyComponent<typeof import("../../app/components/ui/UiStat.vue")['default']>
  'LazyUiTable': LazyComponent<typeof import("../../app/components/ui/UiTable.vue")['default']>
  'LazyUiTabs': LazyComponent<typeof import("../../app/components/ui/UiTabs.vue")['default']>
  'LazyUiTextarea': LazyComponent<typeof import("../../app/components/ui/UiTextarea.vue")['default']>
  'LazyUiToaster': LazyComponent<typeof import("../../app/components/ui/UiToaster.vue")['default']>
  'LazyNuxtWelcome': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/welcome.vue")['default']>
  'LazyNuxtLayout': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-layout")['default']>
  'LazyNuxtErrorBoundary': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-error-boundary.vue")['default']>
  'LazyClientOnly': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/client-only")['default']>
  'LazyDevOnly': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/dev-only")['default']>
  'LazyServerPlaceholder': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/server-placeholder")['default']>
  'LazyNuxtLink': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-link")['default']>
  'LazyNuxtLoadingIndicator': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-loading-indicator")['default']>
  'LazyNuxtTime': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-time.vue")['default']>
  'LazyNuxtRouteAnnouncer': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-route-announcer")['default']>
  'LazyNuxtImg': LazyComponent<typeof import("../../node_modules/@nuxt/image/dist/runtime/components/NuxtImg.vue")['default']>
  'LazyNuxtPicture': LazyComponent<typeof import("../../node_modules/@nuxt/image/dist/runtime/components/NuxtPicture.vue")['default']>
  'LazyNuxtPage': LazyComponent<typeof import("../../node_modules/nuxt/dist/pages/runtime/page")['default']>
  'LazyNoScript': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['NoScript']>
  'LazyLink': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Link']>
  'LazyBase': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Base']>
  'LazyTitle': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Title']>
  'LazyMeta': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Meta']>
  'LazyStyle': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Style']>
  'LazyHead': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Head']>
  'LazyHtml': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Html']>
  'LazyBody': LazyComponent<typeof import("../../node_modules/nuxt/dist/head/runtime/components")['Body']>
  'LazyNuxtIsland': LazyComponent<typeof import("../../node_modules/nuxt/dist/app/components/nuxt-island")['default']>
}

declare module 'vue' {
  export interface GlobalComponents extends _GlobalComponents { }
}

export {}
