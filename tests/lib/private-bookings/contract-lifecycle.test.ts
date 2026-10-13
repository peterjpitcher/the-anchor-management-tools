// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/private-bookings/payment-ledger', () => ({
  readBookingPaymentLedger: async () => ({ payments: [], appliedDepositAmount: 0 }),
}))

import { logger } from '@/lib/logger'
import { generateContractDocument, markWaiverSent, renderContractPreview } from '@/lib/private-bookings/contract-lifecycle'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const USER = '99999999-9999-4999-8999-999999999999'
const SLOT_MARKER = '<!--signing-slot:'
const INITIALS_MARKER = '<!--signing-initials-->'
const WAIVER_SHEET = '<section class="sheet" data-doc="waiver">'

let db: FakeDb
let uploads: Array<{ bucket: string; path: string; content: Buffer }>
let rpcCalls: string[]

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'draft',
    customer_id: 'cust-1',
    customer_first_name: 'Sam',
    customer_last_name: 'Example',
    customer_name: 'Sam Example',
    customer_full_name: 'Sam Example',
    contact_phone: '+447700900123',
    contact_email: 'sam@example.com',
    event_date: '2026-12-05',
    start_time: '18:00',
    end_time: '23:00',
    end_time_next_day: false,
    event_type: 'Birthday party',
    guest_count: 40,
    deposit_amount: 250,
    deposit_paid_date: null,
    balance_due_date: null,
    final_payment_date: null,
    discount_amount: 0,
    discount_type: null,
    date_tbd: false,
    internal_notes: null,
    contract_version: 2,
    outside_food: false,
    waiver_status: 'not_required',
    // The contract reads these as embedded relations; the fake hands the row back whole.
    customer: null,
    items: [],
    payments: [],
    ...extra,
  }
}

const WAIVER_PACKAGE_ITEM: Row = {
  item_type: 'catering',
  quantity: 40,
  unit_price: 0,
  line_total: 0,
  discount_value: 0,
  discount_type: null,
  description: 'Catering',
  package: { id: 'pkg-own-food', name: 'Guests bring food', requires_waiver: true },
}

function seed(booking: Row): void {
  db = createFakeDb({ private_bookings: [booking] })
  uploads = []
  rpcCalls = []
  db.onRpc((name, args) => {
    rpcCalls.push(name)
    if (name !== 'increment_private_booking_contract_version') throw new Error(`Unexpected rpc ${name}`)
    const row = db.rows('private_bookings').find((candidate) => candidate.id === args.p_booking_id) as Row
    row.contract_version = Number(row.contract_version ?? 0) + 1
    return { data: row.contract_version, error: null }
  })
  state.client = {
    from: db.client.from,
    rpc: db.client.rpc,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, content: Buffer) => {
          uploads.push({ bucket, path, content: Buffer.from(content) })
          return { error: null }
        },
      }),
    },
  }
}

function saved(): Row {
  return db.rows('private_bookings')[0]
}

function waiverAudit(): Row[] {
  return db.rows('private_booking_audit').filter((row) => row.field_name === 'waiver_status')
}

function occurrences(text: string, phrase: string): number {
  return text.split(phrase).length - 1
}

beforeEach(() => {
  vi.clearAllMocks()
  seed(bookingRow())
})

describe.each([
  ['generating a contract', (id: string) => generateContractDocument(id, { performedBy: USER })],
  ['previewing a contract', (id: string) => renderContractPreview(id)],
])('%s: the printed contract and the one for signing', (_label, produce) => {
  it('marks where each signature goes in the signing copy, and leaves the printed copy without marks', async () => {
    const contract = await produce(BOOKING)

    expect(contract.signingHtml).toContain(`${SLOT_MARKER}contract:host-->`)
    expect(contract.signingHtml).toContain(`${SLOT_MARKER}contract:anchor-->`)
    expect(contract.signingHtml).not.toContain(`${SLOT_MARKER}waiver:organiser-->`)
    expect(contract.html).not.toContain(SLOT_MARKER)
  })

  it('keeps the lines to sign by hand, and the initials boxes, on the printed copy only', async () => {
    const contract = await produce(BOOKING)

    expect(contract.html).toContain('Host name')
    expect(contract.html).toContain('class="init-box"')
    expect(contract.html).not.toContain(INITIALS_MARKER)

    expect(contract.signingHtml).toContain(INITIALS_MARKER)
    expect(contract.signingHtml).not.toContain('class="init-box"')
  })

  it('adds the food agreement, with its own place to sign, when "Outside food" is ticked', async () => {
    seed(bookingRow({ outside_food: true }))

    const contract = await produce(BOOKING)

    // The same sheets in both copies: only the signature places differ.
    expect(occurrences(contract.html, WAIVER_SHEET)).toBe(1)
    expect(occurrences(contract.signingHtml, WAIVER_SHEET)).toBe(1)
    expect(contract.signingHtml).toContain(`${SLOT_MARKER}waiver:organiser-->`)
    expect(occurrences(contract.signingHtml, SLOT_MARKER)).toBe(3)
    expect(contract.html).not.toContain(SLOT_MARKER)
  })

  it('prints no broken values in either copy', async () => {
    seed(bookingRow({ outside_food: true }))

    const contract = await produce(BOOKING)

    for (const copy of [contract.html, contract.signingHtml]) {
      expect(copy).not.toMatch(/\bundefined\b|Invalid Date|\bNaN\b|\[object Object\]/)
      expect(copy).toContain('Saturday, 5 December 2026')
    }
  })
})

describe('previewing a contract', () => {
  it('changes nothing: no version, no stored copy, and no food agreement stamp', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }))

    const contract = await renderContractPreview(BOOKING)

    expect(contract.version).toBe(2)
    expect(db.writes).toHaveLength(0)
    expect(uploads).toHaveLength(0)
    expect(rpcCalls).toHaveLength(0)
    expect(saved()).toMatchObject({ waiver_status: 'required', contract_version: 2 })
  })

  it('reports a booking that does not exist', async () => {
    await expect(renderContractPreview('44444444-4444-4444-8444-444444444444')).rejects.toThrow('Booking not found')
  })
})

describe('generating a contract', () => {
  it('mints the next version and stores the printed copy, not the signing copy', async () => {
    const contract = await generateContractDocument(BOOKING, { performedBy: USER })

    expect(contract.version).toBe(3)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ bucket: 'private-booking-documents', path: `${BOOKING}/contract-v3.html` })
    // The stored snapshot is what a person would print: it carries no signing marks.
    expect(uploads[0].content.toString('utf-8')).toBe(contract.html)
    expect(uploads[0].content.toString('utf-8')).not.toContain(SLOT_MARKER)
    expect(db.rows('private_booking_audit').find((row) => row.action === 'contract_generated')).toMatchObject({
      booking_id: BOOKING,
      performed_by: USER,
      metadata: { contract_version: 3 },
    })
  })
})

describe('generating a contract and the food agreement status', () => {
  // Generating is not sending. A failed contract email used to leave the booking saying the
  // agreement had been sent, because the stamp was made here, before anything went out.
  it.each([
    ['not_required', { outside_food: true }],
    ['required', { outside_food: true }],
    ['sent', { outside_food: true }],
    ['overdue', { outside_food: true }],
    ['signed', { outside_food: true }],
    ['required', { items: [WAIVER_PACKAGE_ITEM] }],
    ['not_required', { outside_food: false }],
  ])('leaves a status of %s exactly as it was', async (status, extra) => {
    seed(bookingRow({ ...extra, waiver_status: status }))

    await generateContractDocument(BOOKING, { performedBy: USER })

    expect(saved().waiver_status).toBe(status)
    expect(waiverAudit()).toHaveLength(0)
    // The only thing generation writes to the booking is its version, through the database function.
    expect(db.writes.filter((write) => write.table === 'private_bookings')).toHaveLength(0)
  })
})

describe('marking the food agreement as sent, once it has gone to the customer', () => {
  /** The client exactly as the callers hand it over. */
  function admin(): Parameters<typeof markWaiverSent>[0] {
    return state.client as Parameters<typeof markWaiverSent>[0]
  }

  it.each([
    ['required', 'contract_sent', 4],
    // Ticked before the tick counted (13 October 2026): stored as not required, yet the agreement went out.
    ['not_required', 'contract_sent', 4],
    ['required', 'food_agreement_sent', null],
    ['not_required', 'food_agreement_sent', null],
  ] as const)('moves a status of %s to sent and records how it was sent (%s)', async (before, via, contractVersion) => {
    seed(bookingRow({ outside_food: true, waiver_status: before }))

    await markWaiverSent(admin(), { bookingId: BOOKING, via, contractVersion, performedBy: USER })

    expect(saved().waiver_status).toBe('sent')
    expect(waiverAudit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'field_updated',
        field_name: 'waiver_status',
        old_value: before,
        new_value: 'sent',
        performed_by: USER,
        metadata: { via, contract_version: contractVersion },
      }),
    ])
  })

  it.each(['sent', 'overdue', 'signed'])('never touches a status of %s, and writes nothing', async (status) => {
    seed(bookingRow({ outside_food: true, waiver_status: status }))

    await markWaiverSent(admin(), { bookingId: BOOKING, via: 'contract_sent', contractVersion: 4, performedBy: USER })

    expect(saved().waiver_status).toBe(status)
    expect(db.writes).toHaveLength(0)
  })

  it('records no person and no contract version when neither is given', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }))

    await markWaiverSent(admin(), { bookingId: BOOKING, via: 'food_agreement_sent' })

    expect(waiverAudit()[0]).toMatchObject({
      new_value: 'sent',
      performed_by: null,
      metadata: { via: 'food_agreement_sent', contract_version: null },
    })
  })

  it('does not overwrite a signature that lands between the read and the stamp', async () => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }))
    db.beforeUpdate((table, matched) => {
      if (table === 'private_bookings') for (const row of matched) row.waiver_status = 'signed'
    })

    await markWaiverSent(admin(), { bookingId: BOOKING, via: 'contract_sent', contractVersion: 4, performedBy: USER })

    expect(saved().waiver_status).toBe('signed')
    expect(waiverAudit()).toHaveLength(0)
  })

  it('does nothing for a booking that does not exist', async () => {
    await expect(
      markWaiverSent(admin(), { bookingId: '44444444-4444-4444-8444-444444444444', via: 'contract_sent', performedBy: USER })
    ).resolves.toBeUndefined()

    expect(db.rows('private_booking_audit')).toHaveLength(0)
    expect(saved().waiver_status).toBe('not_required')
  })

  it.each([
    ['the status cannot be read', 'private_bookings', 'select', 'required'],
    ['the status cannot be saved', 'private_bookings', 'update', 'required'],
    // The status did change; only its audit row is missing, and that is logged.
    ['the audit row cannot be written', 'private_booking_audit', 'insert', 'sent'],
  ] as const)('logs the failure and does not throw when %s', async (_label, table, operation, statusAfter) => {
    seed(bookingRow({ outside_food: true, waiver_status: 'required' }))
    db.failNext({ table, operation, message: 'connection reset' })

    // The email has already gone: a failure here must not undo or fail the send.
    await expect(
      markWaiverSent(admin(), { bookingId: BOOKING, via: 'contract_sent', contractVersion: 4, performedBy: USER })
    ).resolves.toBeUndefined()

    expect(saved().waiver_status).toBe(statusAfter)
    expect(waiverAudit()).toHaveLength(0)
    expect(logger.error).toHaveBeenCalledWith(
      'Waiver sent stamp failed (non-blocking)',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'connection reset' }),
        metadata: { bookingId: BOOKING, via: 'contract_sent' },
      })
    )
  })
})
