import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The daily tidy-up of receipt storage: what it removes (uploads abandoned for a day, once the
 * database has released them) and what it only reports. It must never remove a stored file a
 * payment refers to.
 */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { performReceiptStorageSweep } from '@/services/receipts/receiptSweep'
import { GET } from '@/app/api/cron/receipts-sweep/route'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'
import { createFakeReceiptStorage, type FakeReceiptStorage } from '../../helpers/fakeReceiptStorage'

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedAuthorize = authorizeCronRequest as unknown as Mock

const NOW = new Date('2026-10-02T03:50:00Z')
const TWO_DAYS_AGO = '2026-09-30T03:50:00Z'
const AN_HOUR_AGO = '2026-10-02T02:50:00Z'
const USER = '22222222-2222-4222-8222-222222222222'

function intent(n: number, overrides: Row = {}): Row {
  return {
    id: `intent-${String(n).padStart(5, '0')}`,
    transaction_id: `tx-${n}`,
    storage_path: `2026/upload_${n}`,
    issued_to: USER,
    issued_at: TWO_DAYS_AGO,
    completed_at: null,
    ...overrides,
  }
}

function arrange(options: {
  intents?: Row[]
  files?: Row[]
  objects?: Record<string, string>
  createdAt?: Record<string, string>
  release?: (args: Row) => { data: unknown; error: { message: string } | null }
  bare?: { data: unknown; error: { message: string } | null }
} = {}): { db: FakeDb; storage: FakeReceiptStorage; rpc: Mock } {
  const db = createFakeDb({
    receipt_upload_intents: options.intents ?? [],
    receipt_files: options.files ?? [],
  })
  const storage = createFakeReceiptStorage(options.objects ?? {})
  for (const [path, at] of Object.entries(options.createdAt ?? {})) storage.createdAt.set(path, at)
  ;(db.client as unknown as { storage: unknown }).storage = storage.storage

  const rpc = vi.fn(async (name: string, args: Row) => {
    if (name === 'release_receipt_upload_intent') {
      if (options.release) return options.release(args)
      // As the database does it: the open upload is closed, unless a payment holds the path.
      if (db.rows('receipt_files').some((file) => file.storage_path === args.p_storage_path)) return { data: 'referenced', error: null }
      const open = db.rows('receipt_upload_intents').find((row) => row.storage_path === args.p_storage_path && row.completed_at === null)
      if (!open) return { data: 'not_found', error: null }
      db.rows('receipt_upload_intents').splice(db.rows('receipt_upload_intents').indexOf(open), 1)
      return { data: 'released', error: null }
    }
    if (name === 'count_receipts_completed_without_receipt') return options.bare ?? { data: 0, error: null }
    throw new Error(`Unexpected rpc: ${name}`)
  })
  db.onRpc((name, args) => rpc(name, args) as Promise<any>)
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, storage, rpc }
}

const released = (rpc: Mock) => rpc.mock.calls.filter(([name]) => name === 'release_receipt_upload_intent').map(([, args]) => args as Row)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockedAuthorize.mockReturnValue({ authorized: true })
})

describe('performReceiptStorageSweep', () => {
  it('removes an upload abandoned for more than a day, and leaves one that is newer or finished', async () => {
    const { rpc, storage } = arrange({
      intents: [
        intent(1),
        intent(2, { issued_at: AN_HOUR_AGO }),
        intent(3, { completed_at: '2026-09-30T04:00:00Z' }),
      ],
      files: [{ id: 'f-3', storage_path: '2026/upload_3' }],
      objects: { '2026/upload_1': 'a', '2026/upload_2': 'b', '2026/upload_3': 'c' },
    })

    const result = await performReceiptStorageSweep(NOW)

    expect(result).toEqual({
      abandonedUploads: 1,
      removed: 1,
      removeFailed: 0,
      referenced: 0,
      unreferencedObjects: 0,
      unreferencedSample: [],
      completedWithoutReceipt: 0,
    })
    expect(released(rpc)).toEqual([{ p_transaction_id: 'tx-1', p_storage_path: '2026/upload_1', p_user_id: USER }])
    expect(storage.removed).toEqual(['2026/upload_1'])
    expect([...storage.objects.keys()].sort()).toEqual(['2026/upload_2', '2026/upload_3'])
  })

  it('never removes a stored file that a payment refers to', async () => {
    const { storage } = arrange({
      // The upload was attached but its record was left open.
      intents: [intent(1)],
      files: [{ id: 'f-1', storage_path: '2026/upload_1' }],
      objects: { '2026/upload_1': 'a' },
    })

    const result = await performReceiptStorageSweep(NOW)

    expect(result).toMatchObject({ abandonedUploads: 1, removed: 0, referenced: 1 })
    expect(storage.removed).toEqual([])
    expect(storage.objects.has('2026/upload_1')).toBe(true)
  })

  it('removes nothing when the database gives any answer but "released"', async () => {
    for (const answer of ['not_found', null, 'something_new']) {
      const { storage } = arrange({
        intents: [intent(1)],
        objects: { '2026/upload_1': 'a' },
        release: () => ({ data: answer, error: null }),
      })

      const result = await performReceiptStorageSweep(NOW)

      expect(result.removed).toBe(0)
      expect(storage.removed).toEqual([])
    }
  })

  it('stops, and removes nothing more, when a release fails', async () => {
    const { storage } = arrange({
      intents: [intent(1), intent(2)],
      objects: { '2026/upload_1': 'a', '2026/upload_2': 'b' },
      release: () => ({ data: null, error: { message: 'deadlock' } }),
    })

    await expect(performReceiptStorageSweep(NOW)).rejects.toThrow('Failed to release an abandoned upload: deadlock')
    expect(storage.removed).toEqual([])
  })

  it('counts a file it could not remove, and carries on with the rest', async () => {
    const { storage } = arrange({
      intents: [intent(1), intent(2)],
      objects: { '2026/upload_1': 'a', '2026/upload_2': 'b' },
    })
    storage.failNext('remove', 'storage is down')

    const result = await performReceiptStorageSweep(NOW)

    expect(result).toMatchObject({ abandonedUploads: 2, removed: 1, removeFailed: 1 })
    expect(storage.removed).toEqual(['2026/upload_2'])
    // The one that stayed has no record now, so it is reported.
    expect(result.unreferencedSample).toEqual(['2026/upload_1'])
  })

  it('reports stored files that nothing refers to, and removes none of them', async () => {
    const { storage } = arrange({
      intents: [intent(1, { issued_at: AN_HOUR_AGO })],
      files: [{ id: 'f-1', storage_path: '2025/kept' }],
      objects: {
        '2025/kept': 'a',
        '2025/orphan': 'b',
        '2026/upload_1': 'c',
        '2026/orphan': 'd',
        '2026/too_new': 'e',
        'stray-at-the-top': 'f',
      },
      createdAt: {
        '2025/orphan': TWO_DAYS_AGO,
        '2026/orphan': TWO_DAYS_AGO,
        // A file just stored may not have its record yet.
        '2026/too_new': AN_HOUR_AGO,
        'stray-at-the-top': TWO_DAYS_AGO,
      },
    })

    const result = await performReceiptStorageSweep(NOW)

    expect(result.unreferencedObjects).toBe(3)
    expect([...result.unreferencedSample].sort()).toEqual(['2025/orphan', '2026/orphan', 'stray-at-the-top'])
    expect(storage.removed).toEqual([])
    expect(storage.objects.size).toBe(6)
  })

  it('names at most twenty of the files it reports', async () => {
    const objects: Record<string, string> = {}
    for (let index = 0; index < 35; index += 1) objects[`2026/orphan_${String(index).padStart(2, '0')}`] = 'x'
    arrange({ objects })

    const result = await performReceiptStorageSweep(NOW)

    expect(result.unreferencedObjects).toBe(35)
    expect(result.unreferencedSample).toHaveLength(20)
  })

  it('reads a folder that holds more than one page of files', async () => {
    const objects: Record<string, string> = {}
    const files: Row[] = []
    for (let index = 0; index < 1500; index += 1) {
      const path = `2026/file_${String(index).padStart(4, '0')}`
      objects[path] = 'x'
      if (index !== 1499) files.push({ id: `f-${String(index).padStart(4, '0')}`, storage_path: path })
    }
    arrange({ objects, files })

    const result = await performReceiptStorageSweep(NOW)

    // The one file with no record is the last, beyond both the first page of the listing and the
    // first thousand file rows.
    expect(result.unreferencedObjects).toBe(1)
    expect(result.unreferencedSample).toEqual(['2026/file_1499'])
  })

  it('reports payments completed with neither a receipt nor a reason', async () => {
    arrange({ bare: { data: 7, error: null } })

    await expect(performReceiptStorageSweep(NOW)).resolves.toMatchObject({ completedWithoutReceipt: 7 })
  })

  it('throws when the bucket cannot be listed or the count cannot be read', async () => {
    const first = arrange({ objects: { '2026/a': 'x' } })
    first.storage.failNext('list', 'storage is down')
    await expect(performReceiptStorageSweep(NOW)).rejects.toThrow('Failed to list stored receipts')

    arrange({ bare: { data: null, error: { message: 'timeout' } } })
    await expect(performReceiptStorageSweep(NOW)).rejects.toThrow('Failed to count completed payments without a receipt: timeout')
  })
})

describe('GET /api/cron/receipts-sweep', () => {
  const request = () => new Request('https://example.test/api/cron/receipts-sweep')

  it('refuses a caller without the cron secret, and sweeps nothing', async () => {
    mockedAuthorize.mockReturnValue({ authorized: false })
    const { rpc } = arrange({ intents: [intent(1)], objects: { '2026/upload_1': 'a' } })

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })

  it('answers 200 with what it did after a clean sweep', async () => {
    arrange({ intents: [intent(1)], objects: { '2026/upload_1': 'a' }, bare: { data: 2, error: null } })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, abandonedUploads: 1, removed: 1, completedWithoutReceipt: 2 })
  })

  it('answers 200 but says so loudly when stored files have no record', async () => {
    arrange({ objects: { '2026/orphan': 'x' } })

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, unreferencedObjects: 1, unreferencedSample: ['2026/orphan'] })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('1 stored file(s) have no record: 2026/orphan'))
  })

  it('answers 500, so the cron alert fires, when a file could not be removed', async () => {
    const { storage } = arrange({ intents: [intent(1)], objects: { '2026/upload_1': 'a' } })
    storage.failNext('remove', 'storage is down')

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: 'Some abandoned files could not be removed', removeFailed: 1 })
    expect(body.success).toBeUndefined()
  })

  it('answers 500 without the detail when the sweep itself fails', async () => {
    arrange({ intents: [intent(1)], release: () => ({ data: null, error: { message: 'relation "secret_table" does not exist' } }) })

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Receipts sweep failed' })
  })
})
