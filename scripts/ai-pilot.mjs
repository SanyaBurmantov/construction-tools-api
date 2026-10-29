#!/usr/bin/env node
/**
 * The DeepSeek pilot on the catalogue texts (2026-10): picks the cards, keeps
 * a control group, creates the AI tasks in stages and reports on them — all
 * through the admin API, so it runs from any machine with Node 22.
 *
 *   node scripts/ai-pilot.mjs select   [--out DIR]   pick 300 cards + control + 5 categories (read-only)
 *   node scripts/ai-pilot.mjs create   --stage 1|2|categories [--out DIR]   create the AI tasks (once per stage)
 *   node scripts/ai-pilot.mjs report   [--out DIR]   what the tasks wrote, refused, flagged and cost
 *
 * Auth: AI_PILOT_TOKEN (a bearer session token), or ADMIN_LOGIN + ADMIN_PASSWORD.
 * API: AI_PILOT_API (default https://gost.by/api).
 *
 * The control group is the point of keeping the output: ~300 cards of the
 * same brands and categories that are *not* rewritten, to compare impressions
 * and indexing against in Yandex.Webmaster / Search Console 3–4 weeks later.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = (process.env.AI_PILOT_API || 'https://gost.by/api').replace(/\/+$/, '')

/** Brands of the pilot (owner's list, 2026-10-29) — matched by name. */
const BRANDS = ['STARFIX', 'STARTUL', 'BULL', 'GEPARD', 'TOPTUL', 'MAKITA']
const PER_BRAND = 50
const STAGE_ONE_PER_BRAND = 5
const CATEGORY_COUNT = 5
/** Pages of 100 read per brand, spread over its whole list. */
const PAGES_PER_BRAND = 12

const PRODUCT_FIELDS = ['name', 'descriptionShort', 'descriptionFull', 'seoTitle', 'seoDescription']
const CATEGORY_FIELDS = ['description', 'seoTitle', 'seoDescription']

const args = process.argv.slice(2)
const command = args[0]
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const OUT = option('out', 'ai-pilot')

let token = process.env.AI_PILOT_TOKEN || ''

async function login() {
  if (token) return
  const login = process.env.ADMIN_LOGIN
  const password = process.env.ADMIN_PASSWORD
  if (!login || !password) throw new Error('Set AI_PILOT_TOKEN or ADMIN_LOGIN + ADMIN_PASSWORD')
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Transport': 'bearer' },
    body: JSON.stringify({ login, password }),
  })
  if (!res.ok) throw new Error(`login: HTTP ${res.status}`)
  token = (await res.json()).token
}

async function api(path, init = {}) {
  await login()
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...init.headers,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const query = (params) => new URLSearchParams(params).toString()

/** «Анкер забиваемый М10х12х40 мм (4 шт) STARFIX» → its line, sizes masked. */
function family(name, brand) {
  return name
    .toLowerCase()
    .replace(brand.toLowerCase(), '')
    .replace(/\d+(?:[.,]\d+)?/g, '#')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-zа-яё#]+/gi, ' ')
    .trim()
}

async function brandProducts(brand) {
  const base = { brandId: brand.id, status: 'PUBLISHED', stock: 'in_stock', limit: '100' }
  const first = await api(`/admin/ai/products?${query({ ...base, page: '1' })}`)
  const pages = first.pagination.pages
  const reads = Math.min(PAGES_PER_BRAND, pages)
  const picks = new Set([1])
  for (let i = 1; i < reads; i++) {
    picks.add(1 + Math.round((i * (pages - 1)) / (reads - 1)))
  }
  const rows = [...first.data]
  for (const page of [...picks].filter((p) => p !== 1)) {
    rows.push(...(await api(`/admin/ai/products?${query({ ...base, page: String(page) })}`)).data)
  }
  return rows
}

/**
 * Round-robin over the brand's categories, one product per line: the pilot
 * should cover many kinds of product and no line twice — ten sizes of one bit
 * would test one template ten times and make ten near-identical pages.
 * Cards with a supplier description or specs come first; cards already
 * rewritten by AI are left out.
 */
function pick(rows, brandName, count, taken) {
  const byCategory = new Map()
  for (const row of rows) {
    if (taken.has(row.id) || row.aiLockedFields?.length) continue
    const key = row.category?.id ?? 'none'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key).push(row)
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => (b.lengths?.descriptionFull ?? 0) - (a.lengths?.descriptionFull ?? 0))
  }
  const usedFamilies = new Set()
  const chosen = []
  const queues = [...byCategory.values()]
  let progress = true
  while (chosen.length < count && progress) {
    progress = false
    for (const queue of queues) {
      while (queue.length) {
        const row = queue.shift()
        const fam = family(row.name, brandName)
        if (usedFamilies.has(fam)) continue
        usedFamilies.add(fam)
        chosen.push(row)
        progress = true
        break
      }
      if (chosen.length >= count) break
    }
  }
  return chosen
}

/**
 * One control card per pilot card: same brand, same category when the brand
 * has another card there, else any other card of the brand. Not rewritten.
 */
function control(rows, pilot, taken) {
  const out = []
  const free = (row) => !taken.has(row.id) && !row.aiLockedFields?.length
  for (const card of pilot) {
    const sibling =
      rows.find((row) => free(row) && row.category?.id === card.category?.id) ??
      rows.find(free)
    if (sibling) {
      taken.add(sibling.id)
      out.push(sibling)
    }
  }
  return out
}

const brief = (row, brand) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  brand,
  category: row.category ? { id: row.category.id, name: row.category.name } : null,
})

async function select() {
  const brands = (await api('/brands?limit=1000'))
  const list = Array.isArray(brands) ? brands : brands.data ?? brands.items ?? []
  const pilot = []
  const controlGroup = []
  const taken = new Set()

  for (const name of BRANDS) {
    const brand = list.find((b) => b.name.toUpperCase() === name)
    if (!brand) {
      console.warn(`brand not found: ${name}`)
      continue
    }
    const rows = await brandProducts(brand)
    const chosen = pick(rows, name, PER_BRAND, taken)
    for (const row of chosen) taken.add(row.id)
    pilot.push(...chosen.map((row) => brief(row, name)))
    controlGroup.push(...control(rows, chosen, taken).map((row) => brief(row, name)))
    console.log(`${name}: ${rows.length} read, ${chosen.length} picked`)
  }

  // Stage 1: the first cards of each brand's round-robin — the most varied.
  const stageOne = []
  for (const name of BRANDS) {
    const cards = pilot.filter((card) => card.brand === name)
    stageOne.push(...cards.slice(0, STAGE_ONE_PER_BRAND).map((card) => card.id))
  }

  // Category texts: of the categories the pilot cards live in, the five with
  // the most products — where a page text reaches the most searches.
  const sizes = new Map()
  for (let page = 1; ; page++) {
    const res = await api(`/admin/ai/categories?${query({ page: String(page), limit: '100', visible: 'yes' })}`)
    for (const row of res.data) sizes.set(row.id, row._count?.products ?? 0)
    if (page >= res.pagination.pages) break
  }
  const seen = new Map()
  for (const card of pilot) {
    // A supplier's per-brand branch («Ключи комбинированные TOPTUL») is not
    // a category a buyer searches for.
    const branded = BRANDS.some((brand) => card.category?.name.toUpperCase().includes(brand))
    if (card.category && sizes.has(card.category.id) && !branded) {
      seen.set(card.category.id, { ...card.category, products: sizes.get(card.category.id) })
    }
  }
  const categories = [...seen.values()].sort((a, b) => b.products - a.products).slice(0, CATEGORY_COUNT)

  mkdirSync(OUT, { recursive: true })
  const result = { generatedAt: new Date().toISOString(), api: API, pilot, stageOne, control: controlGroup, categories }
  writeFileSync(join(OUT, 'selection.json'), JSON.stringify(result, null, 2))
  console.log(
    `pilot ${pilot.length} (stage 1: ${stageOne.length}), control ${controlGroup.length}, categories ${categories.length} → ${join(OUT, 'selection.json')}`,
  )
}

function loadSelection() {
  return JSON.parse(readFileSync(join(OUT, 'selection.json'), 'utf8'))
}

async function create() {
  const stage = option('stage')
  const selection = loadSelection()
  const file = join(OUT, 'tasks.json')
  let known = []
  try {
    known = JSON.parse(readFileSync(file, 'utf8'))
  } catch {}
  // A second run of the same stage would pay for the same cards twice.
  if (known.some((task) => task.stage === stage) && !args.includes('--force')) {
    throw new Error(`stage ${stage} was already created (${file}); --force to create it again`)
  }
  const date = new Date().toISOString().slice(0, 10)
  let body
  if (stage === '1' || stage === '2') {
    const first = new Set(selection.stageOne)
    const ids = stage === '1' ? selection.stageOne : selection.pilot.map((c) => c.id).filter((id) => !first.has(id))
    body = { name: `Пилот ${date}, этап ${stage}`, entity: 'PRODUCT', fields: PRODUCT_FIELDS, ids }
  } else if (stage === 'categories') {
    body = {
      name: `Пилот ${date}, категории`,
      entity: 'CATEGORY',
      fields: CATEGORY_FIELDS,
      ids: selection.categories.map((c) => c.id),
    }
  } else {
    throw new Error('--stage 1 | 2 | categories')
  }
  const created = await api('/admin/ai/tasks', {
    method: 'POST',
    body: JSON.stringify({ ...body, templates: true, batchSize: 5 }),
  })
  const tasks = created.tasks ?? [created]
  known.push(...tasks.map((t) => ({ ...t, stage })))
  writeFileSync(file, JSON.stringify(known, null, 2))
  for (const t of tasks) console.log(`created ${t.id}  ${t.total}  ${t.name}`)
}

async function report() {
  const tasks = JSON.parse(readFileSync(join(OUT, 'tasks.json'), 'utf8'))
  const totals = { items: 0, applied: 0, failed: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0 }
  const rejected = new Map()
  let warned = 0
  for (const known of tasks) {
    const task = await api(`/admin/ai/tasks/${known.id}`)
    totals.items += task.total
    totals.applied += task.applied
    totals.failed += task.failed
    totals.promptTokens += task.promptTokens ?? 0
    totals.completionTokens += task.completionTokens ?? 0
    totals.cacheHitTokens += task.cacheHitTokens ?? 0
    console.log(`${task.status.padEnd(9)} ${task.processed}/${task.total} applied ${task.applied} failed ${task.failed}  ${task.name}`)
    for (let page = 1; ; page++) {
      const items = await api(`/admin/ai/tasks/${known.id}/items?${query({ page: String(page), limit: '100' })}`)
      const rows = items.data ?? items
      for (const item of rows) {
        for (const [field, reason] of Object.entries(item.rejected ?? {})) {
          const kind = `${field}: ${String(reason).replace(/«[^»]*»|\d+(?:\.\d+)?/g, '…')}`
          rejected.set(kind, (rejected.get(kind) ?? 0) + 1)
        }
        if (item.warnings) warned++
      }
      if (!items.pagination || page >= items.pagination.pages) break
    }
  }
  console.log('\ntotals', totals)
  console.log(`near-duplicate flags: ${warned}`)
  console.log('refused fields by reason:')
  for (const [kind, count] of [...rejected].sort((a, b) => b[1] - a[1])) console.log(`  ${count}  ${kind}`)
}

const commands = { select, create, report }
if (!commands[command]) {
  console.error('usage: node scripts/ai-pilot.mjs select | create --stage 1|2|categories | report  [--out DIR]')
  process.exit(1)
}
commands[command]().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
