import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/** Opening and downloading a stored file, and the history shown for one transaction. */

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn().mockResolvedValue({ apiKey: null }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { queryReceiptSignedUrl, queryReceiptTransactionHistory } from '@/services/receipts/receiptQueries'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

const mockedCreateAdminClient = createAdminClient as unknown as Mock

const TX = '55555555-5555-4555-8555-555555555555'
const FILE = '99999999-9999-4999-8999-999999999999'
const PETER = '22222222-2222-4222-8222-222222222222'
const GONE = '33333333-3333-4333-8333-333333333333'

function arrange(seed: Record<string, Row[]> = {}): { db: FakeDb; createSignedUrl: Mock } {
  const db = createFakeDb({
    receipt_files: [{ id: FILE, storage_path: '2026/tesco_1790000000000', file_name: 'Tesco till receipt.pdf' }],
    receipt_transaction_logs: [],
    profiles: [{ id: PETER, full_name: 'Peter Pitcher' }],
    ...seed,
  })
  const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://storage.test/signed' }, error: null }))
  ;(db.client as unknown as { storage: unknown }).storage = { from: () => ({ createSignedUrl }) }
  mockedCreateAdminClient.mockReturnValue(db.client)
  return { db, createSignedUrl }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('queryReceiptSignedUrl', () => {
  it('makes a link that lasts five minutes and opens in the browser', async () => {
    const { createSignedUrl } = arrange()

    await expect(queryReceiptSignedUrl(FILE)).resolves.toEqual({ success: true, url: 'https://storage.test/signed' })
    expect(createSignedUrl).toHaveBeenCalledWith('2026/tesco_1790000000000', 300, undefined)
  })

  it('gives a download the name the file was uploaded with, not its stored name', async () => {
    const { createSignedUrl } = arrange()

    await queryReceiptSignedUrl(FILE, { download: true })

    expect(createSignedUrl).toHaveBeenCalledWith('2026/tesco_1790000000000', 300, { download: 'Tesco till receipt.pdf' })
  })

  it('still downloads a file that has no name recorded', async () => {
    const { createSignedUrl } = arrange({ receipt_files: [{ id: FILE, storage_path: '2026/x_1790000000000', file_name: '' }] })

    await queryReceiptSignedUrl(FILE, { download: true })

    expect(createSignedUrl).toHaveBeenCalledWith('2026/x_1790000000000', 300, { download: true })
  })

  it('says the file is not there, and asks storage for nothing', async () => {
    const { createSignedUrl } = arrange({ receipt_files: [] })

    await expect(queryReceiptSignedUrl(FILE)).resolves.toEqual({ error: 'Receipt not found' })
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('says the file could not be opened when storage refuses, and does not hand back an empty link', async () => {
    const { createSignedUrl } = arrange()
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'Object not found' } } as any)
    await expect(queryReceiptSignedUrl(FILE)).resolves.toEqual({
      error: 'The file could not be opened. It may have been removed from storage.',
    })

    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: '' }, error: null })
    const result = await queryReceiptSignedUrl(FILE)
    expect(result.success).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})

describe('queryReceiptTransactionHistory', () => {
  const log = (n: number, overrides: Row = {}): Row => ({
    id: `log-${n}`,
    transaction_id: TX,
    performed_at: `2026-09-0${n}T10:00:00Z`,
    action_type: 'manual_update',
    note: null,
    previous_status: 'pending',
    new_status: 'completed',
    performed_by: PETER,
    ...overrides,
  })

  it('lists what happened to one transaction, newest first, with who did it', async () => {
    arrange({
      receipt_transaction_logs: [
        log(1, { action_type: 'import', performed_by: null, previous_status: null, new_status: 'pending' }),
        log(3, { action_type: 'receipt_upload', note: 'Receipt added: till.pdf' }),
        log(2, { action_type: 'rule_auto_mark', performed_by: null }),
        log(4, { transaction_id: 'another-transaction' }),
      ],
    })

    const entries = await queryReceiptTransactionHistory(TX)

    expect(entries).toEqual([
      { id: 'log-3', at: '2026-09-03T10:00:00Z', action: 'receipt_upload', note: 'Receipt added: till.pdf', previousStatus: 'pending', newStatus: 'completed', by: 'Peter Pitcher' },
      { id: 'log-2', at: '2026-09-02T10:00:00Z', action: 'rule_auto_mark', note: null, previousStatus: 'pending', newStatus: 'completed', by: null },
      { id: 'log-1', at: '2026-09-01T10:00:00Z', action: 'import', note: null, previousStatus: null, newStatus: 'pending', by: null },
    ])
  })

  it('does not print a reference where a name should be: someone who has left is "A member of staff"', async () => {
    arrange({ receipt_transaction_logs: [log(1, { performed_by: GONE })] })

    const [entry] = await queryReceiptTransactionHistory(TX)

    expect(entry.by).toBe('A member of staff')
    expect(JSON.stringify(entry)).not.toContain(GONE)
  })

  it('still shows the history when the names cannot be read', async () => {
    const { db } = arrange({ receipt_transaction_logs: [log(1)] })
    db.failNext({ table: 'profiles', operation: 'select', message: 'timeout' })

    const entries = await queryReceiptTransactionHistory(TX)

    expect(entries).toHaveLength(1)
    expect(entries[0].by).toBe('A member of staff')
  })

  it('shows at most the two hundred most recent entries', async () => {
    const logs = Array.from({ length: 230 }, (_, index) =>
      log(1, { id: `log-${String(index).padStart(3, '0')}`, performed_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() })
    )
    arrange({ receipt_transaction_logs: logs })

    const entries = await queryReceiptTransactionHistory(TX)

    expect(entries).toHaveLength(200)
    expect(entries[0].id).toBe('log-229')
    expect(entries[199].id).toBe('log-030')
  })

  it('throws when the history cannot be read, so the screen can say so', async () => {
    const { db } = arrange()
    db.failNext({ table: 'receipt_transaction_logs', operation: 'select', message: 'timeout' })

    await expect(queryReceiptTransactionHistory(TX)).rejects.toThrow('Failed to load the history of a transaction: timeout')
  })

  it('answers with an empty list for a transaction with no history', async () => {
    arrange()

    await expect(queryReceiptTransactionHistory(TX)).resolves.toEqual([])
  })
})
