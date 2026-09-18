import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/private-bookings/payment-ledger', () => ({ readBookingPaymentLedger: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))
import { storeContractSnapshot } from '@/lib/private-bookings/contract-lifecycle'
import type { createAdminClient } from '@/lib/supabase/admin'

describe('immutable receipt snapshots', () => {
  function database(uploadError: string | null, insertError: string | null) {
    const upload = vi.fn().mockResolvedValue({ error: uploadError ? { message: uploadError } : null })
    const insert = vi.fn().mockResolvedValue({ error: insertError ? { message: insertError } : null })
    return { client: { storage: { from: () => ({ upload }) }, from: () => ({ insert }) } as unknown as ReturnType<typeof createAdminClient>, upload, insert }
  }
  const input = { bookingId: 'booking', version: 1, fileName: 'receipt-v1.pdf', content: Buffer.from('exact PDF bytes'), mimeType: 'application/pdf', documentType: 'receipt' as const, strict: true }
  it('refuses storage overwrites and retains the exact bytes', async () => {
    const db = database(null, null)
    await storeContractSnapshot(db.client, input)
    expect(db.upload).toHaveBeenCalledWith('booking/receipt-v1.pdf', input.content, { contentType: 'application/pdf', upsert: false })
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ document_type: 'receipt', version: 1 }))
  })
  it('fails closed on upload errors without a document row', async () => {
    const db = database('storage unavailable', null)
    await expect(storeContractSnapshot(db.client, input)).rejects.toThrow('storage unavailable')
    expect(db.insert).not.toHaveBeenCalled()
  })
  it('fails closed if snapshot metadata cannot be stored', async () => {
    const db = database(null, 'database unavailable')
    await expect(storeContractSnapshot(db.client, input)).rejects.toThrow('database unavailable')
  })
  it('preserves existing non-strict contract behaviour', async () => {
    const db = database('storage unavailable', null)
    await expect(storeContractSnapshot(db.client, { ...input, strict: false, documentType: 'contract' })).resolves.toBeUndefined()
  })
})
