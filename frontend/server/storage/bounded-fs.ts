import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readdir, readFile, rename, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import type { Driver } from 'unstorage'
import boundedMemoryDriver from './bounded-memory'

/**
 * Nitro's page cache on disk: gzip-compressed, least recently used first out
 * once it holds `NUXT_CACHE_DISK_MB` (1.5 GB) — ~45k product pages at ~22 KB
 * each, against ~500 in the 64 MB the memory cache could afford. Pages served
 * from here cost no render and no API call; a restart of the same build (a
 * backend-only deploy, the watchdog, a reboot) keeps them.
 *
 * The cache lives in a directory per frontend build: a cached page points at
 * that build's `/_nuxt/<hash>.js`, which the next build no longer serves, so
 * an older build's pages are dropped instead of served broken.
 *
 * Without `NUXT_CACHE_DIR` (dev) or an unwritable one, it is the bounded
 * memory driver — the site never depends on the disk being there.
 */
type Options = { dir?: string, maxMb?: number, minFreeMb?: number }
type Entry = { size: number }

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** Nuxt writes the build id next to the client assets. */
function buildId(): string {
  try {
    const latest = JSON.parse(readFileSync(join(process.cwd(), '.output/public/_nuxt/builds/latest.json'), 'utf8')) as { id?: string }
    if (latest.id) return latest.id.replace(/[^\w-]/g, '')
  } catch {
    // No build manifest (dev): one shared directory.
  }
  return 'dev'
}

export default function boundedFsDriver(opts: Options = {}): Driver {
  const base = process.env.NUXT_CACHE_DIR || opts.dir
  const fromEnv = Number(process.env.NUXT_CACHE_DISK_MB)
  const maxBytes = (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : opts.maxMb || 1536) * 1024 * 1024
  // Leave room for docker builds on the same disk: below this, no new writes.
  const minFree = (opts.minFreeMb ?? 1024) * 1024 * 1024
  if (!base) return boundedMemoryDriver()

  const build = buildId()
  const dir = join(base, build)
  try {
    mkdirSync(dir, { recursive: true })
  } catch (error) {
    console.warn(`[page-cache] ${dir} unavailable, caching in memory:`, (error as Error).message)
    return boundedMemoryDriver()
  }

  // Recency order: a Map iterates in insertion order, a read re-inserts.
  const entries = new Map<string, Entry>()
  let total = 0
  let diskFull = false
  let lastSpaceCheck = 0
  let writes = 0

  const file = (key: string) => join(dir, `${createHash('sha1').update(key).digest('hex')}.gz`)
  const idOf = (key: string) => file(key)

  function forget(id: string) {
    const existing = entries.get(id)
    if (!existing) return
    total -= existing.size
    entries.delete(id)
  }

  function evict() {
    for (const [id] of entries) {
      if (total <= maxBytes) break
      forget(id)
      void unlink(id).catch(() => {})
    }
  }

  // What the previous run left in this build's directory, oldest first; and
  // the directories of other builds, whose pages point at assets that are gone.
  void (async () => {
    try {
      for (const other of await readdir(base)) {
        if (other !== build) await rm(join(base, other), { recursive: true, force: true })
      }
      const found: Array<{ id: string, size: number, mtime: number }> = []
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.gz')) {
          await unlink(join(dir, name)).catch(() => {})
          continue
        }
        const path = join(dir, name)
        const info = await stat(path).catch(() => null)
        if (info) found.push({ id: path, size: info.size, mtime: info.mtimeMs })
      }
      found.sort((a, b) => a.mtime - b.mtime)
      for (const entry of found) {
        if (entries.has(entry.id)) continue
        entries.set(entry.id, { size: entry.size })
        total += entry.size
      }
      evict()
    } catch (error) {
      console.warn('[page-cache] scan failed:', (error as Error).message)
    }
  })()

  async function spaceLeft() {
    const now = Date.now()
    if (now - lastSpaceCheck < 60_000) return !diskFull
    lastSpaceCheck = now
    try {
      const info = await statfs(dir)
      const free = info.bavail * info.bsize
      if (free < minFree !== diskFull) {
        diskFull = free < minFree
        console.warn(`[page-cache] ${diskFull ? 'disk nearly full — not caching new pages' : 'caching again'} (${Math.round(free / 1048576)} MB free)`)
      }
    } catch {
      // statfs unsupported: keep the last verdict.
    }
    return !diskFull
  }

  async function get(key: string): Promise<string | null> {
    const id = idOf(key)
    const existing = entries.get(id)
    if (!existing) return null
    entries.delete(id)
    entries.set(id, existing)
    try {
      return (await gunzipAsync(await readFile(id))).toString('utf8')
    } catch {
      forget(id)
      return null
    }
  }

  async function set(key: string, value: unknown) {
    if (!(await spaceLeft())) return
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? null)
    const body = await gzipAsync(Buffer.from(text, 'utf8'))
    if (body.length > maxBytes) return
    const id = idOf(key)
    // Write aside, then rename: a reader never sees half a page.
    const temp = `${id}.${process.pid}.${++writes}.tmp`
    try {
      await writeFile(temp, body)
      await rename(temp, id)
    } catch (error) {
      void unlink(temp).catch(() => {})
      console.warn('[page-cache] write failed:', (error as Error).message)
      return
    }
    forget(id)
    entries.set(id, { size: body.length })
    total += body.length
    evict()
  }

  async function remove(key: string) {
    const id = idOf(key)
    forget(id)
    await unlink(id).catch(() => {})
  }

  return {
    name: 'bounded-fs',
    options: opts,
    hasItem: key => entries.has(idOf(key)),
    getItem: key => get(key),
    setItem: (key, value) => set(key, value),
    removeItem: key => remove(key),
    // Only hashes are kept; nothing in the request path lists the cache.
    getKeys: () => [],
    clear: async () => {
      entries.clear()
      total = 0
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    },
  }
}
