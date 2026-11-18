/**
 * An in-memory stand-in for `unstable_cache` and `revalidateTag` from `next/cache`, which
 * throw outside a Next request. It honours the key parts, the tags and the TTL, and returns
 * values through a JSON round trip as the real data cache does. Errors are never stored.
 *
 * It cannot prove Next's own stale-while-revalidate behaviour; that is read from the Next source.
 */
interface Entry { body: string; storedAt: number; revalidate: number; tags: string[] }

export function createFakeNextCache(): {
  unstable_cache: <T>(fn: () => Promise<T>, keyParts: string[], options: { revalidate: number; tags: string[] }) => () => Promise<T>
  revalidateTag: (tag: string) => void
  reset: () => void
  size: () => number
} {
  const entries = new Map<string, Entry>()
  return {
    unstable_cache<T>(fn: () => Promise<T>, keyParts: string[], options: { revalidate: number; tags: string[] }) {
      return async (): Promise<T> => {
        const key = JSON.stringify(keyParts)
        const hit = entries.get(key)
        if (hit && Date.now() - hit.storedAt < hit.revalidate * 1000) return JSON.parse(hit.body) as T
        const value = await fn()
        entries.set(key, { body: JSON.stringify(value), storedAt: Date.now(), revalidate: options.revalidate, tags: options.tags })
        return value
      }
    },
    revalidateTag(tag: string) {
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key)
    },
    reset() { entries.clear() },
    size() { return entries.size },
  }
}
