/**
 * Shapes behind `/admin/parsing`.
 *
 * The page used to be a single 2000-line file, so these lived next to the
 * markup that read them. Now that each panel is its own component, the page and
 * its components need a common place to agree on what the API sends.
 */
import type { Paginated } from './api'

export type QueueStatus = 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED'

export type QueueStats = {
  queued: number
  visited: number
  failed: number
  skipped: number
  total: number
}

/** All four supplier queues share one model, so one row type covers them. */
export type QueueRow = {
  id: string
  url: string
  status: QueueStatus
  attempts: number
  lastError?: string | null
  lastTriedAt?: string | null
}

export type QueueRowsResponse = Paginated<QueueRow>

export type BulkRetryResponse = { count: number }

export type ParserHealth = {
  ok: boolean
  maxAgeHours: number
  priceMaxAgeHours: number
  priceStalePercent: number
  priceFreshness: Array<{
    sourceCode: string, total: number, stale: number, stalePercent: number,
    oldestSync: string | null, newestSync: string | null, health: 'OK' | 'STALE' | 'EMPTY'
  }>
  jobs: Array<{
    key: string
    label: string
    isRunning: boolean
    maxAgeHours: number | null
    health: 'OK' | 'RUNNING' | 'ERROR' | 'STALE'
    startedAt: string | null
    finishedAt: string | null
    lastSuccessAt: string | null
    lastErrorAt: string | null
    lastError: string | null
    runs: number
    successes: number
    failures: number
  }>
}

export type ParserRun = {
  id: string
  key: string
  label: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  error: string | null
  errorCount: number
}

export type ParserError = { url: string, message: string, createdAt: string }

/** The admin projection of a supplier — `url` included, unlike the public one. */
export type Source = { id: string, name: string, code: string, url: string }

export type SupplierSummary = {
  source: { id: string, name: string, code: string }
  total: number, published: number, draft: number, hidden: number, archived: number
  withoutPrice: number, withoutImages: number, withoutSku: number
}

export type ProductRef = { id: string, name: string, slug: string }

export type DuplicateGroup = { key: string, products: Array<ProductRef & { sources: string[] }> }

export type DataQualityReport = {
  generatedAt: string
  summary: {
    publishedProducts: number, totalProducts: number, withoutImages: number, withoutPrice: number,
    withoutSpecs: number, withoutBrand: number, inFallbackCategory: number, staleProducts: number,
    staleDays: number, duplicateGroups: number, allCapsNames: number
  }
  samples: {
    withoutImages: ProductRef[], withoutPrice: ProductRef[], withoutSpecs: ProductRef[],
    inFallbackCategory: ProductRef[], stale: ProductRef[], allCapsNames: ProductRef[],
    duplicates: DuplicateGroup[]
  }
}

export type CategoryStats = {
  queued: number, visited: number, failed: number, skipped: number, disabled: number
  total: number, productsFound: number, productsQueued: number
}

export type ParserSourceOverview = {
  code: string
  name: string
  /** The supplier's domain — what the queue tabs are labelled with. */
  host: string
  /**
   * Where this source's queue lives under `/admin/queue`: `''` for the first
   * source, `/<something>` for the rest. It comes from the backend so the
   * admin page does not have to hard-code one supplier at a time.
   */
  queuePrefix: string
  hasCategoryQueue: boolean
  cronEnabled: boolean
  /** Global switch AND the source switch — what the cron actually checks. */
  effectiveEnabled: boolean
  batchLimit: number
  requestDelayMs: number
  maxPages: number
  /** Only sent for a source with a category queue. */
  categoryBatchLimit?: number
  categoryFilters: { include: string, exclude: string }
  envFlag: string
  envFlagValue: string | null
  products: QueueStats
  categories: CategoryStats | null
  jobs: ParserHealth['jobs']
}

export type ParserOverview = {
  cronEnabled: boolean
  envCronEnabled: string | null
  globalOverriddenInDb: boolean
  isRunning: boolean
  health: { ok: boolean, maxAgeHours: number }
  /** The process that runs every job; silent for 3 min = not alive. */
  worker: { alive: boolean, lastSeenAt: string | null }
  sources: ParserSourceOverview[]
}

/** The edited copy of a source's settings, kept apart from the server's own. */
export type SourceDraft = {
  batchLimit: number
  requestDelayMs: number
  maxPages: number
  categoryBatchLimit: number
  categoryIncludeRegex: string
  categoryExcludeRegex: string
}

export type ParserJob = {
  name: string
  key: string
  label: string
  description: string
  isRunning: boolean
  /** A daily crawl queued until the source's current batch ends. */
  isWaiting?: boolean
  health: 'OK' | 'RUNNING' | 'ERROR' | 'STALE' | null
  lastSuccessAt: string | null
  lastError: string | null
}

export type CategoryRow = {
  id: string
  url: string
  name: string
  path: string[]
  level: number
  isEnabled: boolean
  status: QueueStatus
  attempts: number
  pagesCrawled: number
  productsFound: number
  productsQueued: number
  lastError: string | null
  visitedAt: string | null
}
