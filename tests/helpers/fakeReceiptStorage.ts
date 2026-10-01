/**
 * A stand-in for the receipts storage bucket: objects held in a map, with every removal and
 * upload recorded so a test can say what was, and was not, touched.
 */

type StorageError = { message: string } | null

export type FakeReceiptStorage = {
  /** Attach to the fake client as `client.storage`. */
  storage: { from: (bucket: string) => Record<string, (...args: any[]) => Promise<any>> }
  objects: Map<string, Uint8Array>
  /** When each object was stored, for the sweep. A path with no entry counts as old. */
  createdAt: Map<string, string>
  removed: string[]
  uploaded: Array<{ path: string; bytes: Uint8Array; options: unknown }>
  downloads: string[]
  /** The next call of this kind fails with this message. */
  failNext: (operation: 'download' | 'remove' | 'upload' | 'list', message: string) => void
}

export function createFakeReceiptStorage(seed: Record<string, Uint8Array | string> = {}): FakeReceiptStorage {
  const objects = new Map<string, Uint8Array>()
  for (const [path, value] of Object.entries(seed)) {
    objects.set(path, typeof value === 'string' ? new TextEncoder().encode(value) : value)
  }
  const createdAt = new Map<string, string>()
  const removed: string[] = []
  const uploaded: FakeReceiptStorage['uploaded'] = []
  const downloads: string[] = []
  const failures = new Map<string, string>()

  const take = (operation: string): StorageError => {
    const message = failures.get(operation)
    if (!message) return null
    failures.delete(operation)
    return { message }
  }

  const bucket = {
    download: async (path: string) => {
      downloads.push(path)
      const error = take('download')
      if (error) return { data: null, error }
      const bytes = objects.get(path)
      if (!bytes) return { data: null, error: { message: 'Object not found' } }
      return {
        data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
        error: null,
      }
    },
    remove: async (paths: string[]) => {
      const error = take('remove')
      if (error) return { data: null, error }
      for (const path of paths) {
        removed.push(path)
        objects.delete(path)
      }
      return { data: paths.map((name) => ({ name })), error: null }
    },
    upload: async (path: string, body: Uint8Array, options: unknown) => {
      const error = take('upload')
      if (error) return { data: null, error }
      if (objects.has(path)) return { data: null, error: { message: 'The resource already exists' } }
      const bytes = Uint8Array.from(body)
      objects.set(path, bytes)
      uploaded.push({ path, bytes, options })
      return { data: { path }, error: null }
    },
    // Folders have a null id, as the storage API returns them.
    list: async (prefix: string, options: { limit?: number; offset?: number } = {}) => {
      const error = take('list')
      if (error) return { data: null, error }
      const entries = new Map<string, { name: string; id: string | null; created_at: string | null }>()
      for (const path of [...objects.keys()].sort()) {
        if (prefix) {
          if (!path.startsWith(`${prefix}/`)) continue
          const name = path.slice(prefix.length + 1)
          if (name.includes('/')) continue
          entries.set(name, { name, id: `object-${path}`, created_at: createdAt.get(path) ?? null })
        } else if (path.includes('/')) {
          const folder = path.split('/')[0]
          entries.set(folder, { name: folder, id: null, created_at: null })
        } else {
          entries.set(path, { name: path, id: `object-${path}`, created_at: createdAt.get(path) ?? null })
        }
      }
      const all = [...entries.values()]
      const offset = options.offset ?? 0
      return { data: all.slice(offset, offset + (options.limit ?? 100)), error: null }
    },
  }

  return {
    storage: { from: () => bucket },
    objects,
    createdAt,
    removed,
    uploaded,
    downloads,
    failNext: (operation, message) => failures.set(operation, message),
  }
}
