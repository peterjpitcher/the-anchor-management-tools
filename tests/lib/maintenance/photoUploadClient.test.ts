import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  confirmMaintenancePhotoUpload,
  requestMaintenancePhotoUpload,
} from '@/app/actions/maintenance-photos'
import {
  UNREADABLE_PHOTO_MESSAGE,
  normaliseMaintenancePhoto,
  type DecodedPhoto,
  type PhotoNormaliseDeps,
} from '@/lib/maintenance/photo-normalise'
import {
  uploadMaintenancePhoto,
  type MaintenancePhotoUploadDeps,
  type MaintenancePhotoUploadStage,
} from '@/app/(authenticated)/maintenance/_components/photoClient'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const PHOTO_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '99999999-9999-4999-8999-999999999999'

/**
 * This suite wires the real server actions to a fake storage layer, so the
 * request, the browser-direct upload and the confirm run against each other
 * rather than against stubs of each other. The bytes are a real JPEG and the
 * confirm verifies them with the real sharp, so the round trip is genuine.
 */

function queryStub(result: { data?: unknown; error?: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const stub: Record<string, unknown> = { calls }

  for (const method of ['select', 'eq', 'is', 'lt', 'order', 'limit', 'insert', 'update', 'delete']) {
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

function photoRow(storagePath: string, state: 'pending' | 'ready') {
  return {
    id: PHOTO_ID,
    item_id: ITEM_ID,
    storage_path: storagePath,
    file_name: 'IMG_0042.HEIC',
    mime_type: 'image/jpeg',
    file_size_bytes: 1234,
    width: 2000,
    height: 1500,
    caption: null,
    taken_on: null,
    state,
    uploaded_by: USER_ID,
    uploaded_by_email: 'owner@example.com',
    uploaded_at: '2026-09-05T09:00:00.000Z',
    redacted_at: null,
    redacted_by: null,
    redacted_by_email: null,
    redaction_reason: null,
  }
}

/** Bytes the browser actually uploaded, keyed by storage path. */
const uploaded = new Map<string, Buffer>()

/** jsdom's Blob has no arrayBuffer(), so read it the way jsdom does support. */
function readBytes(blob: Blob): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('could not read the blob'))
    reader.readAsArrayBuffer(blob)
  })
}

function buildBackend() {
  let issuedPath: string | null = null

  const storage = {
    createSignedUploadUrl: vi.fn(async (path: string) => {
      // Echo the path the action generated, so the real value is what the
      // browser uploads to and what confirm then validates.
      issuedPath = path
      return { data: { path, token: 'signed-token' }, error: null }
    }),
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://storage.example/sign/${path}?token=abc` },
      error: null,
    })),
    download: vi.fn(async (path: string) => {
      const bytes = uploaded.get(path)
      if (!bytes) return { data: null, error: { message: 'not found' } }
      return {
        data: {
          arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        },
        error: null,
      }
    }),
    remove: vi.fn(async () => ({ error: null })),
  }

  const photoStubs: ReturnType<typeof queryStub>[] = []
  let photoCall = 0

  const admin = {
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from: vi.fn((table: string) => {
      if (table === 'maintenance_items') return queryStub({ data: { id: ITEM_ID } })
      if (table === 'maintenance_photos') {
        photoCall += 1
        const path = issuedPath ?? ''
        // 1: the pending insert, 2: confirm reads the row, 3: confirm promotes it.
        const stub =
          photoCall === 1
            ? queryStub({ data: { id: PHOTO_ID } })
            : photoCall === 2
              ? queryStub({ data: photoRow(path, 'pending') })
              : queryStub({ data: photoRow(path, 'ready') })
        photoStubs.push(stub)
        return stub
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    storage: { from: vi.fn(() => storage) },
  }

  const browserSupabase = {
    storage: {
      from: vi.fn(() => ({
        uploadToSignedUrl: vi.fn(async (path: string, _token: string, file: File) => {
          uploaded.set(path, await readBytes(file))
          return { data: { path }, error: null }
        }),
      })),
    },
  }

  return { admin, storage, browserSupabase, photoStubs, issuedPath: () => issuedPath }
}

/**
 * Canvas stand-in. jsdom has no 2d context, so the encode step is done by sharp,
 * which produces the same thing the browser would: a real JPEG at the target size.
 */
function canvasDeps(source: { width: number; height: number }): PhotoNormaliseDeps {
  return {
    decode: vi.fn(
      async (): Promise<DecodedPhoto> => ({
        width: source.width,
        height: source.height,
        source: {} as unknown as CanvasImageSource,
        release: vi.fn(),
      })
    ),
    encodeJpeg: vi.fn(async (_photo, width, height, quality) => {
      const sharp = (await import('sharp')).default
      const buffer = await sharp({
        create: { width, height, channels: 3, background: { r: 120, g: 140, b: 160 } },
      })
        .jpeg({ quality: Math.round(quality * 100) })
        .toBuffer()
      return new Blob([buffer], { type: 'image/jpeg' })
    }),
  }
}

function depsWith(overrides: Partial<MaintenancePhotoUploadDeps>): MaintenancePhotoUploadDeps {
  const backend = buildBackend()
  mockedCreateAdminClient.mockReturnValue(backend.admin)

  return {
    normalise: (file) => normaliseMaintenancePhoto(file, canvasDeps({ width: 4032, height: 3024 })),
    requestUpload: requestMaintenancePhotoUpload,
    confirmUpload: confirmMaintenancePhotoUpload,
    getSupabase: () => backend.browserSupabase as never,
    wait: async () => undefined,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  uploaded.clear()
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID, email: 'owner@example.com' } },
        error: null,
      })),
    },
  })
})

describe('uploadMaintenancePhoto round trip', () => {
  it('normalises, requests, uploads browser-direct and confirms', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const stages: MaintenancePhotoUploadStage[] = []
    const file = new File([new Uint8Array(4096)], 'IMG_0042.HEIC', { type: 'image/heic' })

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file, onStage: (stage) => stages.push(stage) },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 4032, height: 3024 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmMaintenancePhotoUpload,
        getSupabase: () => backend.browserSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(stages).toEqual(['preparing', 'uploading', 'saving', 'done'])
    expect('photo' in result).toBe(true)
    if ('photo' in result) {
      expect(result.photo.state).toBe('ready')
      expect(result.photo.signedUrl).toContain('/sign/')
    }

    // The bytes reached storage as a real JPEG, downscaled to the 2000px cap.
    const path = backend.issuedPath()
    expect(path).not.toBeNull()
    expect(String(path).startsWith(`${ITEM_ID}/`)).toBe(true)
    const stored = uploaded.get(String(path))
    expect(stored).toBeDefined()
    expect(stored?.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))

    const sharp = (await import('sharp')).default
    const meta = await sharp(stored as Buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(2000)
    expect(meta.height).toBe(1500)
  })

  it('gives the plain English message for a file the browser cannot decode', async () => {
    const requestUpload = vi.fn()
    const file = new File([new Uint8Array(64)], 'IMG_0001.HEIC', { type: 'image/heic' })
    const stages: MaintenancePhotoUploadStage[] = []

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file, onStage: (stage) => stages.push(stage) },
      depsWith({
        // The real normaliser against a decode that fails the way a desktop
        // browser fails on a raw iPhone HEIC.
        normalise: (input) =>
          normaliseMaintenancePhoto(input, {
            decode: vi.fn(async () => {
              throw new Error(
                'heif: Error while loading plugin: Support for this compression format has not been built in'
              )
            }),
            encodeJpeg: vi.fn(async () => new Blob([new Uint8Array([1])])),
          }),
        requestUpload: requestUpload as never,
      })
    )

    expect(result).toEqual({ error: UNREADABLE_PHOTO_MESSAGE })
    expect(stages).toEqual(['preparing', 'failed'])
    // Nothing was requested, so no pending row and no signed URL were created.
    expect(requestUpload).not.toHaveBeenCalled()
  })

  it('retries a lost confirm, which is safe because confirm is idempotent', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const confirmUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({
        success: true,
        photo: {
          id: PHOTO_ID,
          state: 'ready',
          signedUrl: 'https://storage.example/sign/x',
          signedUrlExpiresAt: new Date().toISOString(),
        },
      })

    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmUpload as never,
        getSupabase: () => backend.browserSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(confirmUpload).toHaveBeenCalledTimes(2)
    expect('photo' in result).toBe(true)
  })

  it('gives up after three lost confirms and leaves the row for the cleanup pass', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const confirmUpload = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmUpload as never,
        getSupabase: () => backend.browserSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(confirmUpload).toHaveBeenCalledTimes(3)
    expect(result).toEqual({
      error: 'The photo uploaded but saving it did not finish. Please try again in a moment.',
    })
  })

  it('does not retry a settled rejection from the server', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const confirmUpload = vi.fn().mockResolvedValue({ error: 'That photo is too large, so it has not been kept.' })
    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmUpload as never,
        getSupabase: () => backend.browserSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(confirmUpload).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ error: 'That photo is too large, so it has not been kept.' })
  })

  it('surfaces an upload failure and never confirms', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const confirmUpload = vi.fn()
    const failingSupabase = {
      storage: {
        from: vi.fn(() => ({
          uploadToSignedUrl: vi.fn(async () => ({
            data: null,
            error: { message: 'network gone' },
          })),
        })),
      },
    }

    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })
    const stages: MaintenancePhotoUploadStage[] = []

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file, onStage: (stage) => stages.push(stage) },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmUpload as never,
        getSupabase: () => failingSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(result).toEqual({ error: 'That photo could not be uploaded. Please try again.' })
    expect(stages).toEqual(['preparing', 'uploading', 'failed'])
    expect(confirmUpload).not.toHaveBeenCalled()
  })

  it('settles when the request for an upload URL never comes back', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    // A rejected promise, not a returned error: the connection dropped mid call.
    const requestUpload = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    const confirmUpload = vi.fn()
    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })
    const stages: MaintenancePhotoUploadStage[] = []

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file, onStage: (stage) => stages.push(stage) },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestUpload as never,
        confirmUpload: confirmUpload as never,
        getSupabase: () => backend.browserSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(result).toEqual({
      error: 'Could not upload that photo. Check your connection and try again.',
    })
    // The stage is settled, so nothing is left showing "Preparing" for ever.
    expect(stages).toEqual(['preparing', 'failed'])
    expect(confirmUpload).not.toHaveBeenCalled()
    expect(uploaded.size).toBe(0)
  })

  it('settles when the browser-direct upload itself throws', async () => {
    const backend = buildBackend()
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const confirmUpload = vi.fn()
    const throwingSupabase = {
      storage: {
        from: vi.fn(() => ({
          uploadToSignedUrl: vi.fn().mockRejectedValue(new Error('Failed to fetch')),
        })),
      },
    }

    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })
    const stages: MaintenancePhotoUploadStage[] = []

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file, onStage: (stage) => stages.push(stage) },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmUpload as never,
        getSupabase: () => throwingSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(result).toEqual({
      error: 'Could not upload that photo. Check your connection and try again.',
    })
    expect(stages).toEqual(['preparing', 'uploading', 'failed'])
    expect(confirmUpload).not.toHaveBeenCalled()
  })

  it('refuses at the request step when the caller is not a super admin', async () => {
    const backend = buildBackend()
    backend.admin.rpc = vi.fn(async () => ({ data: false, error: null }))
    mockedCreateAdminClient.mockReturnValue(backend.admin)

    const confirmUpload = vi.fn()
    const file = new File([new Uint8Array(4096)], 'IMG_0042.JPG', { type: 'image/jpeg' })

    const result = await uploadMaintenancePhoto(
      { itemId: ITEM_ID, file },
      {
        normalise: (input) =>
          normaliseMaintenancePhoto(input, canvasDeps({ width: 1200, height: 900 })),
        requestUpload: requestMaintenancePhotoUpload,
        confirmUpload: confirmUpload as never,
        getSupabase: () => backend.browserSupabase as never,
        wait: async () => undefined,
      }
    )

    expect(result).toEqual({ error: 'You do not have permission to manage maintenance photos.' })
    expect(confirmUpload).not.toHaveBeenCalled()
    expect(uploaded.size).toBe(0)
  })
})
