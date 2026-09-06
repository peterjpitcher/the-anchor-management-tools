import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import {
  cleanupStaleMaintenancePhotoUploads,
  confirmMaintenancePhotoUpload,
  listMaintenancePhotos,
  requestMaintenancePhotoUpload,
} from '@/app/actions/maintenance-photos'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ITEM_ID = '22222222-2222-4222-8222-222222222222'
const PHOTO_ID = '33333333-3333-4333-8333-333333333333'
const OBJECT_UUID = '44444444-4444-4444-8444-444444444444'
const STORAGE_PATH = `${ITEM_ID}/${OBJECT_UUID}.jpg`
const USER_ID = '99999999-9999-4999-8999-999999999999'

/**
 * A chainable, thenable PostgREST stub. Every filter method returns itself, so a
 * chain of any shape resolves to the one result the test configured.
 */
function queryStub(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const stub: Record<string, unknown> = { calls }

  for (const method of [
    'select',
    'eq',
    'is',
    'in',
    'lt',
    'gt',
    'order',
    'limit',
    'insert',
    'update',
    'delete',
    'upsert',
  ]) {
    stub[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args })
      return stub
    })
  }

  const settled = { data: null, error: null, ...result }
  stub.single = vi.fn(async () => settled)
  stub.maybeSingle = vi.fn(async () => settled)
  stub.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(settled).then(resolve, reject)

  return stub as Record<string, Mock> & { calls: typeof calls }
}

interface AdminOptions {
  items?: ReturnType<typeof queryStub>
  photos?: ReturnType<typeof queryStub>[]
  isSuperAdmin?: boolean | null
  /** Only read when the RPC is unavailable (isSuperAdmin: null). */
  roleNames?: string[]
  storage?: Partial<{
    createSignedUploadUrl: Mock
    createSignedUrl: Mock
    download: Mock
    remove: Mock
  }>
}

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PHOTO_ID,
    item_id: ITEM_ID,
    storage_path: STORAGE_PATH,
    file_name: 'IMG_0042.JPG',
    mime_type: 'image/jpeg',
    file_size_bytes: 1024,
    width: 40,
    height: 30,
    caption: null,
    taken_on: null,
    state: 'ready',
    uploaded_by: USER_ID,
    uploaded_by_email: 'owner@example.com',
    uploaded_at: '2026-09-05T09:00:00.000Z',
    redacted_at: null,
    redacted_by: null,
    redacted_by_email: null,
    redaction_reason: null,
    ...overrides,
  }
}

function makeAdmin(options: AdminOptions = {}) {
  const photoQueue = [...(options.photos ?? [])]
  const storage = {
    createSignedUploadUrl:
      options.storage?.createSignedUploadUrl ??
      vi.fn(async () => ({ data: { path: STORAGE_PATH, token: 'signed-token' }, error: null })),
    createSignedUrl:
      options.storage?.createSignedUrl ??
      vi.fn(async () => ({
        data: { signedUrl: `https://storage.example/sign/${STORAGE_PATH}?token=abc` },
        error: null,
      })),
    download: options.storage?.download ?? vi.fn(async () => ({ data: null, error: null })),
    remove: options.storage?.remove ?? vi.fn(async () => ({ error: null })),
  }

  const usedPhotoStubs: ReturnType<typeof queryStub>[] = []

  const admin = {
    rpc: vi.fn(async () => ({
      data: options.isSuperAdmin ?? true,
      error: options.isSuperAdmin === null ? { message: 'no rpc' } : null,
    })),
    from: vi.fn((table: string) => {
      if (table === 'maintenance_items') {
        return options.items ?? queryStub({ data: { id: ITEM_ID } })
      }
      if (table === 'maintenance_photos') {
        const next = photoQueue.shift() ?? queryStub({ data: null })
        usedPhotoStubs.push(next)
        return next
      }
      if (table === 'user_roles') {
        const names = options.roleNames ?? ['super_admin']
        return queryStub({ data: names.map((name) => ({ roles: { name } })) })
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    storage: { from: vi.fn(() => storage) },
  }

  return { admin, storage, usedPhotoStubs }
}

function signedInAs(userId: string | null) {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId, email: 'owner@example.com' } : null },
        error: null,
      })),
    },
  })
}

async function realJpeg(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 90, b: 40 } },
  })
    .jpeg()
    .toBuffer()
}

function blobOf(buffer: Buffer) {
  return {
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  }
}

const validRequest = {
  itemId: ITEM_ID,
  fileName: 'IMG_0042.JPG',
  mimeType: 'image/jpeg' as const,
  sizeBytes: 90_000,
  width: 2000,
  height: 1500,
}

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs(USER_ID)
})

describe('requestMaintenancePhotoUpload', () => {
  it('issues a signed upload URL under the item prefix and records a pending row', async () => {
    const insertStub = queryStub({ data: { id: PHOTO_ID } })
    const { admin, storage } = makeAdmin({ photos: [insertStub] })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect(result).toEqual({ photoId: PHOTO_ID, path: STORAGE_PATH, token: 'signed-token' })

    const insert = insertStub.calls.find((call) => call.method === 'insert')
    const row = insert?.args[0] as Record<string, unknown>
    expect(row.state).toBe('pending')
    expect(row.item_id).toBe(ITEM_ID)
    expect(String(row.storage_path).startsWith(`${ITEM_ID}/`)).toBe(true)
    // The original filename is kept as metadata only, never as the object path.
    expect(String(row.storage_path)).not.toContain('IMG_0042')
    expect(row.file_name).toBe('IMG_0042.JPG')
    expect(storage.createSignedUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('refuses a caller who is not a super admin', async () => {
    const { admin, storage } = makeAdmin({ isSuperAdmin: false })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller', async () => {
    signedInAs(null)
    const { admin, storage } = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('leaves no orphan when the metadata insert fails: no URL is ever issued', async () => {
    const insertStub = queryStub({ data: null, error: { message: 'insert failed' } })
    const { admin, storage } = makeAdmin({ photos: [insertStub] })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect(result).toEqual({ error: 'The upload could not be prepared. Please try again.' })
    // No signed URL means no object can be stored, so there is nothing to orphan.
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('removes the pending row when the signed URL cannot be created', async () => {
    const insertStub = queryStub({ data: { id: PHOTO_ID } })
    const deleteStub = queryStub({ data: null })
    const { admin } = makeAdmin({
      photos: [insertStub, deleteStub],
      storage: {
        createSignedUploadUrl: vi.fn(async () => ({ data: null, error: { message: 'nope' } })),
      },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect(result).toEqual({ error: 'The upload could not be prepared. Please try again.' })
    expect(deleteStub.calls.some((call) => call.method === 'delete')).toBe(true)
  })

  it('refuses an unknown item', async () => {
    const { admin, storage } = makeAdmin({ items: queryStub({ data: null }) })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect(result).toEqual({ error: 'That maintenance item could not be found.' })
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('falls back to the role rows when the RPC is unavailable', async () => {
    const insertStub = queryStub({ data: { id: PHOTO_ID } })
    const { admin, storage } = makeAdmin({
      photos: [insertStub],
      isSuperAdmin: null,
      roleNames: ['super_admin'],
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload(validRequest)

    expect('photoId' in result).toBe(true)
    expect(storage.createSignedUploadUrl).toHaveBeenCalledTimes(1)
  })

  it.each([['manager'], ['staff'], ['super_admin_readonly']])(
    'refuses a %s when the RPC is unavailable',
    async (roleName) => {
      const { admin, storage } = makeAdmin({ isSuperAdmin: null, roleNames: [roleName] })
      mockedCreateAdminClient.mockReturnValue(admin)

      const result = await requestMaintenancePhotoUpload(validRequest)

      expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
      expect(storage.createSignedUploadUrl).not.toHaveBeenCalled()
    }
  )

  it('refuses a mime type the bucket does not allow', async () => {
    const { admin, storage } = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await requestMaintenancePhotoUpload({
      ...validRequest,
      mimeType: 'image/heic' as unknown as 'image/jpeg',
    })

    expect('error' in result).toBe(true)
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled()
  })
})

describe('confirmMaintenancePhotoUpload', () => {
  it('verifies real JPEG bytes and promotes the row to ready', async () => {
    const jpeg = await realJpeg(40, 30)
    const pending = queryStub({ data: readyRow({ state: 'pending' }) })
    const promote = queryStub({ data: readyRow() })
    const { admin, storage } = makeAdmin({
      photos: [pending, promote],
      storage: { download: vi.fn(async () => ({ data: blobOf(jpeg), error: null })) },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect('success' in result).toBe(true)
    if ('success' in result) {
      expect(result.photo.state).toBe('ready')
      expect(result.photo.signedUrl).toContain('/sign/')
      expect(result.photo.signedUrlExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }

    const update = promote.calls.find((call) => call.method === 'update')
    const patch = update?.args[0] as Record<string, unknown>
    expect(patch).toMatchObject({ state: 'ready', mime_type: 'image/jpeg', width: 40, height: 30 })
    expect(patch.file_size_bytes).toBe(jpeg.byteLength)
    expect(storage.remove).not.toHaveBeenCalled()
    expect(mockedLogAuditEvent).toHaveBeenCalledTimes(1)
  })

  it('is a no-op the second time it runs', async () => {
    const already = queryStub({ data: readyRow() })
    const { admin, storage } = makeAdmin({ photos: [already] })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect('success' in result).toBe(true)
    // Nothing is downloaded, re-verified, promoted or audited a second time.
    expect(storage.download).not.toHaveBeenCalled()
    expect(already.calls.some((call) => call.method === 'update')).toBe(false)
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('deletes the object and marks the row failed when the bytes are not an image', async () => {
    const pending = queryStub({ data: readyRow({ state: 'pending' }) })
    const failed = queryStub({ data: null })
    const notAnImage = Buffer.from('%PDF-1.7\nnot a photo at all', 'utf8')
    const { admin, storage } = makeAdmin({
      photos: [pending, failed],
      storage: { download: vi.fn(async () => ({ data: blobOf(notAnImage), error: null })) },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect(result).toEqual({
      error: 'That file is not a JPEG, PNG or WebP image, so it has not been kept.',
    })
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH])
    const update = failed.calls.find((call) => call.method === 'update')
    expect(update?.args[0]).toEqual({ state: 'failed' })
    expect(mockedLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_status: 'failure' })
    )
  })

  it('rejects a valid JPEG header wrapped round rubbish', async () => {
    const pending = queryStub({ data: readyRow({ state: 'pending' }) })
    const failed = queryStub({ data: null })
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 0x41)])
    const { admin, storage } = makeAdmin({
      photos: [pending, failed],
      storage: { download: vi.fn(async () => ({ data: blobOf(fake), error: null })) },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect(result).toEqual({
      error:
        'That photo could not be read once uploaded, so it has not been kept. Please try a different photo.',
    })
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH])
  })

  it('still marks the row failed when the object delete fails, and never loops on it', async () => {
    const pending = queryStub({ data: readyRow({ state: 'pending' }) })
    const failed = queryStub({ data: null })
    const notAnImage = Buffer.from('still not a photo', 'utf8')
    const { admin, storage } = makeAdmin({
      photos: [pending, failed],
      storage: {
        download: vi.fn(async () => ({ data: blobOf(notAnImage), error: null })),
        remove: vi.fn(async () => ({ error: { message: 'storage unavailable' } })),
      },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect('error' in result).toBe(true)
    expect(storage.remove).toHaveBeenCalledTimes(1)
    // The row leaves pending, so no later pass picks it up again.
    expect(failed.calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      state: 'failed',
    })
  })

  it('refuses a client-supplied path outside the item prefix without touching the database', async () => {
    const { admin, storage } = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: `${OTHER_ITEM_ID}/${OBJECT_UUID}.jpg`,
    })

    expect(result).toEqual({
      error: 'The photo was uploaded but could not be saved. Please try again.',
    })
    expect(admin.from).not.toHaveBeenCalled()
    expect(storage.download).not.toHaveBeenCalled()
  })

  it.each([
    ['traversal', `${ITEM_ID}/../${OTHER_ITEM_ID}/${OBJECT_UUID}.jpg`],
    ['nested', `${ITEM_ID}/nested/${OBJECT_UUID}.jpg`],
    ['bare filename', `${OBJECT_UUID}.jpg`],
    ['wrong extension', `${ITEM_ID}/${OBJECT_UUID}.svg`],
    ['not a uuid', `${ITEM_ID}/kitchen-tap.jpg`],
  ])('refuses a %s path', async (_label, storagePath) => {
    const { admin } = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({ itemId: ITEM_ID, storagePath })

    expect('error' in result).toBe(true)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('refuses when permission was lost between requesting and confirming', async () => {
    const { admin, storage } = makeAdmin({ isSuperAdmin: false })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
    expect(admin.from).not.toHaveBeenCalled()
    expect(storage.download).not.toHaveBeenCalled()
  })

  it('returns the shared answer when a racing confirm promoted the row first', async () => {
    const jpeg = await realJpeg(24, 24)
    const pending = queryStub({ data: readyRow({ state: 'pending' }) })
    // The conditional update matches nothing because the other call won.
    const promote = queryStub({ data: null })
    const reread = queryStub({ data: readyRow() })
    const { admin } = makeAdmin({
      photos: [pending, promote, reread],
      storage: { download: vi.fn(async () => ({ data: blobOf(jpeg), error: null })) },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await confirmMaintenancePhotoUpload({
      itemId: ITEM_ID,
      storagePath: STORAGE_PATH,
    })

    expect('success' in result).toBe(true)
  })
})

describe('listMaintenancePhotos', () => {
  it('signs only ready, unredacted photos', async () => {
    const rows = queryStub({ data: [readyRow()] })
    const { admin, storage } = makeAdmin({ photos: [rows] })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await listMaintenancePhotos(ITEM_ID)

    expect('photos' in result).toBe(true)
    if ('photos' in result) {
      expect(result.photos).toHaveLength(1)
      expect(result.photos[0].signedUrl).toContain('/sign/')
    }
    expect(storage.createSignedUrl).toHaveBeenCalledWith(STORAGE_PATH, 3600)
    const filters = rows.calls.filter((call) => call.method === 'eq' || call.method === 'is')
    expect(filters).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['state', 'ready'] },
        { method: 'is', args: ['redacted_at', null] },
      ])
    )
  })

  it('refuses a caller who is not a super admin, without saying whether the item exists', async () => {
    const { admin, storage } = makeAdmin({ isSuperAdmin: false })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await listMaintenancePhotos(ITEM_ID)

    expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
    expect(storage.createSignedUrl).not.toHaveBeenCalled()
  })

  it('reports a read failure rather than showing an empty gallery', async () => {
    const rows = queryStub({ data: null, error: { message: 'boom' } })
    const { admin } = makeAdmin({ photos: [rows] })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await listMaintenancePhotos(ITEM_ID)

    expect(result).toEqual({ error: 'The photos could not be loaded. Please try again.' })
  })
})

describe('cleanupStaleMaintenancePhotoUploads', () => {
  it('retires pending rows older than 24 hours and deletes their objects', async () => {
    const stale = queryStub({
      data: [{ id: PHOTO_ID, item_id: ITEM_ID, storage_path: STORAGE_PATH }],
    })
    const retire = queryStub({ data: null })
    const { admin, storage } = makeAdmin({ photos: [stale, retire] })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await cleanupStaleMaintenancePhotoUploads()

    expect('success' in result).toBe(true)
    if ('success' in result) {
      expect(result.examined).toBe(1)
      expect(result.cleaned).toBe(1)
      expect(result.orphanedObjects).toBe(0)
      expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/)
    }
    expect(storage.remove).toHaveBeenCalledWith([STORAGE_PATH])

    const cutoff = stale.calls.find((call) => call.method === 'lt')
    expect(cutoff?.args[0]).toBe('uploaded_at')
    const cutoffMs = Date.parse(String(cutoff?.args[1]))
    expect(Date.now() - cutoffMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5000)
    // The object is gone, so the row that pointed at it goes too.
    expect(retire.calls.some((call) => call.method === 'delete')).toBe(true)
    expect(retire.calls).toEqual(
      expect.arrayContaining([{ method: 'eq', args: ['state', 'pending'] }])
    )
  })

  it('counts an undeletable object as an orphan for reconciliation and still retires the row', async () => {
    const stale = queryStub({
      data: [{ id: PHOTO_ID, item_id: ITEM_ID, storage_path: STORAGE_PATH }],
    })
    const retire = queryStub({ data: null })
    const { admin } = makeAdmin({
      photos: [stale, retire],
      storage: { remove: vi.fn(async () => ({ error: { message: 'storage unavailable' } })) },
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await cleanupStaleMaintenancePhotoUploads()

    expect('success' in result).toBe(true)
    if ('success' in result) {
      expect(result.orphanedObjects).toBe(1)
      // Not counted as cleaned, because the bytes are still there.
      expect(result.cleaned).toBe(0)
    }
    // The row is kept as failed so the orphan stays traceable, and it leaves
    // pending so the next pass does not pick it up and loop.
    expect(retire.calls.find((call) => call.method === 'update')?.args[0]).toEqual({
      state: 'failed',
    })
    expect(retire.calls.some((call) => call.method === 'delete')).toBe(false)
  })

  it('refuses a caller who is neither the cron nor a super admin', async () => {
    signedInAs(null)
    const { admin, storage } = makeAdmin()
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await cleanupStaleMaintenancePhotoUploads()

    expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
    expect(storage.remove).not.toHaveBeenCalled()
  })
})
