#!/usr/bin/env node
// Google Search Console for gost.by, read-only, no dependencies.
//
//   node scripts/gsc.mjs inspect GROUPS.json OUT.json [--prev PREV.json] [--resolve]
//       URL Inspection for every product of every group. GROUPS.json is
//       { "<group>": [{ "slug": "…" }, …], … } — any top-level array of objects
//       with a slug is a group (ai-pilot/selection.json works as it is:
//       pilot + control). --resolve follows a product's 301 first (AI renamed
//       it), --prev prints the change against an earlier OUT.json.
//   node scripts/gsc.mjs search [--days 28]
//       Clicks, impressions, CTR and position: total and per day.
//   node scripts/gsc.mjs sitemaps
//       Submitted sitemaps and when Google last read them.
//
// The service-account key is read from GSC_KEY_FILE (the JSON key) or from
// GSC_MEMORY (the gsc-service-account.md memory file, key in its ```json
// block). It never goes into the repository. Behind a proxy run with
// NODE_USE_ENV_PROXY=1. The Inspection API allows 2 000 URLs a day.
import fs from 'node:fs'
import crypto from 'node:crypto'

const SITE = 'sc-domain:gost.by'
const ORIGIN = 'https://gost.by'
const [command, ...rest] = process.argv.slice(2)
const flag = (name) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
const positional = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] ?? '').match(/^--(prev|days)$/))

function readKey() {
  if (process.env.GSC_KEY_FILE) return JSON.parse(fs.readFileSync(process.env.GSC_KEY_FILE, 'utf8'))
  if (process.env.GSC_MEMORY) {
    const block = fs.readFileSync(process.env.GSC_MEMORY, 'utf8').match(/```json\n([\s\S]*?)\n```/)
    if (block) return JSON.parse(block[1])
  }
  throw new Error('Set GSC_KEY_FILE (service-account JSON) or GSC_MEMORY (the gsc-service-account.md memory file)')
}

async function accessToken() {
  const key = readKey()
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })}`
  const jwt = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url')}`
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`Google refused the key: ${JSON.stringify(json)}`)
  return json.access_token
}

async function api(token, url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function pool(items, size, fn) {
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

function readGroups(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const items = []
  for (const [group, list] of Object.entries(raw)) {
    if (!Array.isArray(list) || !list.length || typeof list[0]?.slug !== 'string') continue
    for (const it of list) items.push({ id: it.id, slug: it.slug, group })
  }
  if (!items.length) throw new Error(`${file}: no group found (expected { "<group>": [{ "slug": … }] })`)
  return items
}

// The slug the product lives at today: the API answers 404 + redirectTo for an address that moved.
async function currentSlug(slug) {
  try {
    const res = await fetch(`${ORIGIN}/api/products/${encodeURIComponent(slug)}`)
    if (res.status === 404) return (await res.json()).redirectTo || slug
  } catch {
    /* keep the slug we have */
  }
  return slug
}

const isIndexed = (row) => row.verdict === 'PASS'

function summary(rows) {
  const out = {}
  for (const row of rows) {
    const g = (out[row.group] ??= { n: 0, indexed: 0, coverage: {} })
    g.n++
    if (isIndexed(row)) g.indexed++
    g.coverage[row.coverage ?? 'нет ответа'] = (g.coverage[row.coverage ?? 'нет ответа'] ?? 0) + 1
  }
  return out
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—')

async function inspect() {
  const [groupsFile, outFile] = positional
  if (!groupsFile || !outFile) throw new Error('usage: gsc.mjs inspect GROUPS.json OUT.json [--prev PREV.json] [--resolve]')
  const items = readGroups(groupsFile)
  const token = await accessToken()
  const rows = []
  await pool(items, 5, async (it) => {
    const slug = rest.includes('--resolve') ? await currentSlug(it.slug) : it.slug
    const url = `${ORIGIN}/product/${slug}`
    const { status, json } = await api(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      inspectionUrl: url,
      siteUrl: SITE,
      languageCode: 'ru',
    })
    const s = json.inspectionResult?.indexStatusResult ?? {}
    rows.push({
      ...it,
      ...(slug !== it.slug ? { movedTo: slug } : {}),
      url,
      http: status,
      verdict: s.verdict ?? null,
      coverage: s.coverageState ?? json.error?.message ?? null,
      lastCrawl: s.lastCrawlTime ?? null,
    })
  })
  rows.sort((a, b) => a.group.localeCompare(b.group) || a.slug.localeCompare(b.slug))
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1))

  const failed = rows.filter((r) => r.http !== 200).length
  if (failed) console.log(`! ${failed} of ${rows.length} requests were refused (quota is 2 000 a day) — those rows count as not indexed`)
  const now = summary(rows)
  const prevFile = flag('--prev')
  const before = prevFile ? summary(JSON.parse(fs.readFileSync(prevFile, 'utf8'))) : null
  for (const [group, g] of Object.entries(now)) {
    const was = before?.[group]
    const change = was ? `   was ${was.indexed}/${was.n} (${pct(was.indexed, was.n)})   change ${g.indexed - was.indexed >= 0 ? '+' : ''}${g.indexed - was.indexed}` : ''
    console.log(`${group}: indexed ${g.indexed}/${g.n} (${pct(g.indexed, g.n)})${change}`)
    for (const [state, n] of Object.entries(g.coverage).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${state}`)
  }
  const moved = rows.filter((r) => r.movedTo).length
  if (moved) console.log(`${moved} product(s) were inspected at the address they moved to`)
  console.log(`rows → ${outFile}`)
}

async function search() {
  const days = Number(flag('--days')) || 28
  const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
  const token = await accessToken()
  const { status, json } = await api(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    startDate: day(days + 2), // the last two days are incomplete in Search Console
    endDate: day(3),
    dimensions: ['date'],
    rowLimit: 1000,
  })
  if (status !== 200) throw new Error(`searchAnalytics: ${status} ${JSON.stringify(json)}`)
  const rows = json.rows ?? []
  let clicks = 0
  let impressions = 0
  let weighted = 0
  console.log('date         clicks  impressions    ctr  position')
  for (const r of rows) {
    clicks += r.clicks
    impressions += r.impressions
    weighted += r.position * r.impressions
    console.log(`${r.keys[0]}  ${String(r.clicks).padStart(6)}  ${String(r.impressions).padStart(11)}  ${(r.ctr * 100).toFixed(1).padStart(4)}%  ${r.position.toFixed(1).padStart(8)}`)
  }
  console.log(
    `total ${day(days + 2)}…${day(3)}: ${clicks} clicks, ${impressions} impressions, CTR ${pct(clicks, impressions)}, position ${impressions ? (weighted / impressions).toFixed(1) : '—'}`,
  )
}

async function sitemaps() {
  const token = await accessToken()
  const { status, json } = await api(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps`)
  if (status !== 200) throw new Error(`sitemaps: ${status} ${JSON.stringify(json)}`)
  for (const s of json.sitemap ?? []) {
    const urls = (s.contents ?? []).map((c) => `${c.type} ${c.submitted}`).join(', ')
    console.log(`${s.path}\n    submitted ${s.lastSubmitted?.slice(0, 10) ?? '—'}, read ${s.lastDownloaded?.slice(0, 10) ?? '—'}, errors ${s.errors ?? 0}, warnings ${s.warnings ?? 0}${urls ? `, ${urls}` : ''}`)
  }
}

const commands = { inspect, search, sitemaps }
if (!commands[command]) {
  console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(1)
}
commands[command]().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
