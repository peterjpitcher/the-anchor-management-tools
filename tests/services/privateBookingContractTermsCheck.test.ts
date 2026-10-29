// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * BK-154, D25: when a booking changes after its contract went out, any request to sign the old
 * terms that is still open is withdrawn, so nobody signs a contract that is no longer the booking.
 */

type Row = Record<string, unknown>
const state = vi.hoisted(() => ({ client: null as unknown, voided: [] as Array<{ documentId: string; userId: string; reason: string }> }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/signing/service', () => ({
  voidSigningDocument: vi.fn(async (input: { documentId: string; userId: string; reason: string }) => {
    state.voided.push(input)
  }),
}))

import { withdrawOutOfDateContractRequests } from '@/services/private-bookings/contract-terms-check'
import { logger } from '@/lib/logger'

const BOOKING = '11111111-1111-4111-8111-111111111111'
const TERMS = {
  v: 1, event_date: '2026-12-05', start_time: '18:00', end_time: '23:00', end_time_next_day: false,
  guest_count: 40, space_ids: ['room-a'], total: 120,
}

let db: FakeDb

function seed(booking: Row, documents: Row[] = []): void {
  db = createFakeDb({
    private_bookings: [{
      id: BOOKING,
      status: 'confirmed',
      contract_version: 2,
      contract_sent_at: '2026-10-20T10:00:00.000Z',
      contract_accepted_at: null,
      contract_terms: TERMS,
      event_date: '2026-12-05',
      date_tbd: false,
      start_time: '18:00:00',
      end_time: '23:00:00',
      end_time_next_day: false,
      guest_count: 40,
      discount_type: null,
      discount_amount: 0,
      items: [{ space_id: 'room-a', quantity: 1, unit_price: 100, line_total: 100, vat_rate: 20 }],
      ...booking,
    }],
    signing_documents: documents,
    private_booking_audit: [],
  })
  state.client = db.client
}

const open = (id: string, kind: string, status = 'sent'): Row => ({ id, kind, status, subject_type: 'private_booking', subject_id: BOOKING })

beforeEach(() => {
  vi.clearAllMocks()
  state.voided = []
})

describe('withdrawing out-of-date contract requests', () => {
  it('does nothing while the booking still matches its contract', async () => {
    seed({}, [open('doc-1', 'private_booking_contract')])
    expect(await withdrawOutOfDateContractRequests(BOOKING, 'user-1')).toBeNull()
    expect(state.voided).toEqual([])
  })

  it('withdraws the open contract and food agreement requests, leaves signed ones, and audits it', async () => {
    seed({ event_date: '2026-12-06' }, [
      open('doc-1', 'private_booking_contract', 'part_signed'),
      open('doc-2', 'private_booking_waiver'),
      open('doc-3', 'private_booking_contract', 'completed'),
      open('doc-4', 'supplier_confirmation'),
    ])

    const result = await withdrawOutOfDateContractRequests(BOOKING, 'user-1')

    expect(result?.withdrawn).toEqual(['doc-1', 'doc-2'])
    expect(state.voided.map((entry) => entry.documentId)).toEqual(['doc-1', 'doc-2'])
    expect(state.voided[0]).toMatchObject({ userId: 'user-1', reason: 'The booking changed after this was sent (the date). A new version is needed.' })
    expect(db.rows('private_booking_audit')).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'contract_out_of_date',
        performed_by: 'user-1',
        metadata: { changes: ['date'], contract_version: 2, withdrawn_signing_document_ids: ['doc-1', 'doc-2'] },
      }),
    ])
  })

  it('reports the change with nothing to withdraw, and writes no audit row', async () => {
    seed({ guest_count: 50 })
    const result = await withdrawOutOfDateContractRequests(BOOKING)
    expect(result).toMatchObject({ outOfDate: { changes: ['guest numbers'], nextVersion: 3 }, withdrawn: [] })
    expect(db.rows('private_booking_audit')).toHaveLength(0)
  })

  it('never throws: a read failure is logged and the edit stands', async () => {
    seed({ guest_count: 50 })
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'connection reset', times: 1 })
    expect(await withdrawOutOfDateContractRequests(BOOKING)).toBeNull()
    expect(logger.error).toHaveBeenCalled()
  })
})
