import type { Driver } from 'unstorage'

/**
 * A memory driver for Nitro's `cache` mount that **forgets** — least recently
 * used first — once it holds `maxMb` worth of entries.
 *
 * Nitro's default production cache is unstorage's plain memory driver, which
 * never evicts anything (it ignores TTLs too). Every URL behind an `swr` route
 * rule therefore stays in the heap for the life of the process: each product,
 * each brand, every `/catalog` filter combination (the key is the full URL).
 * At ~1.2 MB of HTML per page — and Cyrillic strings take two bytes per
 * character in V8 — a crawler walking the 52k products fills the frontend
 * container's 384 MB `mem_limit` after a couple of hundred pages; the kernel
 * kills it, `restart` brings it back, and every request in between is a 502
 * from Caddy. That is the shape of the `/brand` and `/delivery/` 502s in the
 * 2026-10 SEO audit.
 *
 * Bounded, the cache keeps the hot pages and drops the long tail, which is
 * all an SWR cache is for. `NUXT_CACHE_MAX_MB` overrides the size at runtime
 * without a rebuild.
 */
type Options = { maxMb?: number }

type Entry = { value: unknown, size: number }

function sizeOf(key: string, value: unknown) {
  // Strings are what unstorage hands a driver (it JSON-stringifies first).
  // Two bytes per character is V8's cost for any non-Latin-1 string.
  const length = typeof value === 'string' ? value.length : JSON.stringify(value ?? null).length
  return (key.length + length) * 2
}

export default function boundedMemoryDriver(opts: Options = {}): Driver {
  const fromEnv = Number(process.env.NUXT_CACHE_MAX_MB)
  const maxBytes = (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : opts.maxMb || 96) * 1024 * 1024

  // A Map iterates in insertion order, so re-inserting on read makes the
  // first key the least recently used one.
  const entries = new Map<string, Entry>()
  let total = 0

  function remove(key: string) {
    const existing = entries.get(key)
    if (!existing) return
    total -= existing.size
    entries.delete(key)
  }

  function set(key: string, value: unknown) {
    remove(key)
    const size = sizeOf(key, value)
    // A single entry bigger than the whole budget is not worth evicting
    // everything else for.
    if (size > maxBytes) return
    entries.set(key, { value, size })
    total += size
    for (const oldest of entries.keys()) {
      if (total <= maxBytes) break
      remove(oldest)
    }
  }

  function get(key: string) {
    const existing = entries.get(key)
    if (!existing) return null
    entries.delete(key)
    entries.set(key, existing)
    return existing.value
  }

  return {
    name: 'bounded-memory',
    options: opts,
    hasItem: key => entries.has(key),
    getItem: key => get(key),
    getItemRaw: key => get(key),
    setItem: (key, value) => set(key, value),
    setItemRaw: (key, value) => set(key, value),
    removeItem: key => remove(key),
    getKeys: () => [...entries.keys()],
    clear: () => {
      entries.clear()
      total = 0
    },
    dispose: () => {
      entries.clear()
      total = 0
    },
  }
}
