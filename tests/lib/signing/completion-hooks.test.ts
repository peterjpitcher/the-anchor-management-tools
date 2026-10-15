// @vitest-environment node
// Server code that writes with the service role: no browser globals wanted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * What happens to a booking, and to a new starter's checklist, once a document is fully signed.
 *
 * These hooks run after the signature is recorded, and can run again days later if the first
 * attempt failed part way. So each must leave a cancelled booking alone, must date the change by
 * when the document was signed and not by when the hook ran, and must never leave a change on the
 * booking with no audit row to say how it got there.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))

import { SIGNING_COMPLETION_HOOKS, runCompletionHook } from '@/lib/signing/completion-hooks'
import { quoteContentFingerprint, type QuoteContentForFingerprint } from '@/lib/signing/documents/quote-fingerprint'
import type { SigningDocumentRow } from '@/lib/signing/types'

const BOOKING = '11111111-1111-4111-8111-111111111111'
const OTHER_BOOKING = '22222222-2222-4222-8222-222222222222'
const EMPLOYEE = '55555555-5555-4555-8555-555555555555'
const CONTRACT_DOCUMENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WAIVER_DOCUMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** When the last signature landed. */
const SIGNED_AT = '2026-10-12T13:05:09.000Z'
/** When the hook runs in these tests: five days later, as a retry by the daily job would. */
const RUN_AT = '2026-10-17T06:00:00.000Z'

let db: FakeDb

function seed(tables: Record<string, Row[]>): void {
  db = createFakeDb(tables)
  state.client = db.client
}

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'confirmed',
    contract_version: 3,
    contract_accepted_at: null,
    contract_acceptance_method: null,
    waiver_status: 'sent',
    ...extra,
  }
}

function booking(id = BOOKING): Row {
  return db.rows('private_bookings').find((row) => row.id === id) as Row
}

function audit(): Row[] {
  return db.rows('private_booking_audit')
}

function signedDocument(overrides: Partial<SigningDocumentRow> = {}): SigningDocumentRow {
  return {
    id: CONTRACT_DOCUMENT,
    kind: 'private_booking_contract',
    mode: 'sign',
    brand: 'guest',
    title: 'Private booking contract',
    summary: null,
    subject_type: 'private_booking',
    subject_id: BOOKING,
    series_key: 'private_booking_contract',
    version: 1,
    template_id: null,
    template_version: null,
    context: { contract_version: 3 },
    status: 'completed',
    source_pdf_path: `private_booking/${BOOKING}/${CONTRACT_DOCUMENT}/document.pdf`,
    source_sha256: 'a'.repeat(64),
    final_pdf_path: `private_booking/${BOOKING}/${CONTRACT_DOCUMENT}/signed.pdf`,
    final_sha256: 'b'.repeat(64),
    supersedes_id: null,
    expires_at: '2026-11-11T12:00:00.000Z',
    sent_at: '2026-10-12T12:00:00.000Z',
    completed_at: SIGNED_AT,
    completion_applied_at: null,
    copies_sent_at: SIGNED_AT,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_by: '99999999-9999-4999-8999-999999999999',
    created_at: '2026-10-12T12:00:00.000Z',
    updated_at: SIGNED_AT,
    ...overrides,
  }
}

function contractDocument(overrides: Partial<SigningDocumentRow> = {}): SigningDocumentRow {
  return signedDocument(overrides)
}

function waiverDocument(overrides: Partial<SigningDocumentRow> = {}): SigningDocumentRow {
  return signedDocument({
    id: WAIVER_DOCUMENT,
    kind: 'private_booking_waiver',
    title: 'Self-catering and outside food agreement',
    series_key: 'private_booking_waiver',
    context: {},
    ...overrides,
  })
}

/**
 * Make the audit write fail and, with it, the write that would put the booking back: the
 * database going away between one statement and the next.
 */
function failTheAuditAndTheUndo(): void {
  state.client = {
    ...db.client,
    from: (table: string) => {
      const builder = db.client.from(table)
      if (table !== 'private_booking_audit') return builder
      return {
        ...builder,
        insert: (payload: Row | Row[]) => {
          db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })
          db.failNext({ table: 'private_bookings', operation: 'update', message: 'still unavailable', times: 1 })
          return builder.insert(payload)
        },
      }
    },
  }
}

beforeEach(() => {
  // Only the date is frozen, so the promises the fake database returns still settle.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(RUN_AT))
  seed({ private_bookings: [bookingRow()] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a signed booking contract', () => {
  it('marks the booking accepted and records how, with the version that was signed', async () => {
    await runCompletionHook(contractDocument(), [])

    expect(booking()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' })
    expect(audit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'contract_accepted',
        performed_by: null,
        metadata: { via: 'e_signature', signing_document_id: CONTRACT_DOCUMENT, contract_version: 3 },
      }),
    ])
    // The food agreement is a separate document with its own signature.
    expect(booking().waiver_status).toBe('sent')
  })

  it('dates the acceptance by when it was signed, not by when this ran', async () => {
    await runCompletionHook(contractDocument({ completed_at: SIGNED_AT }), [])

    expect(booking().contract_accepted_at).toBe(SIGNED_AT)
    expect(booking().contract_accepted_at).not.toBe(RUN_AT)
  })

  it('falls back to the time it ran for a document with no completion time recorded', async () => {
    await runCompletionHook(contractDocument({ completed_at: null }), [])

    expect(booking().contract_accepted_at).toBe(RUN_AT)
  })

  it('leaves a cancelled booking alone: no acceptance and no audit row', async () => {
    seed({ private_bookings: [bookingRow({ status: 'cancelled' })] })

    await runCompletionHook(contractDocument(), [])

    expect(booking()).toMatchObject({ status: 'cancelled', contract_accepted_at: null, contract_acceptance_method: null })
    expect(audit()).toHaveLength(0)
  })

  it('does not treat a booking with no status as cancelled', async () => {
    seed({ private_bookings: [bookingRow({ status: null })] })

    await runCompletionHook(contractDocument(), [])

    expect(booking()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' })
    expect(audit()).toHaveLength(1)
  })

  it.each(['draft', 'confirmed', 'completed'])('accepts a booking whose status is %s', async (status) => {
    seed({ private_bookings: [bookingRow({ status })] })

    await runCompletionHook(contractDocument(), [])

    expect(booking().contract_accepted_at).toBe(SIGNED_AT)
    expect(audit()).toHaveLength(1)
  })

  it('touches only its own booking', async () => {
    seed({ private_bookings: [bookingRow({ id: OTHER_BOOKING }), bookingRow()] })

    await runCompletionHook(contractDocument(), [])

    expect(booking(BOOKING).contract_accepted_at).toBe(SIGNED_AT)
    expect(booking(OTHER_BOOKING).contract_accepted_at).toBeNull()
    expect(audit().map((row) => row.booking_id)).toEqual([BOOKING])
  })

  it('changes nothing when run a second time', async () => {
    await runCompletionHook(contractDocument(), [])
    vi.setSystemTime(new Date('2026-10-20T06:00:00.000Z'))
    await runCompletionHook(contractDocument(), [])

    expect(booking().contract_accepted_at).toBe(SIGNED_AT)
    expect(audit()).toHaveLength(1)
  })

  it('puts the acceptance back and fails when the audit row cannot be written', async () => {
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })

    await expect(runCompletionHook(contractDocument(), [])).rejects.toThrow('Could not record the accepted contract: audit unavailable')

    // Neither half is left behind without the other.
    expect(booking()).toMatchObject({ contract_accepted_at: null, contract_acceptance_method: null })
    expect(audit()).toHaveLength(0)
  })

  it('ends with the acceptance and exactly one audit row when it is tried again after an audit failure', async () => {
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })
    await expect(runCompletionHook(contractDocument(), [])).rejects.toThrow('audit unavailable')

    // The daily job tries again the next morning.
    vi.setSystemTime(new Date('2026-10-18T06:00:00.000Z'))
    await runCompletionHook(contractDocument(), [])

    expect(booking()).toMatchObject({ contract_accepted_at: SIGNED_AT, contract_acceptance_method: 'e_signature' })
    expect(audit()).toEqual([expect.objectContaining({ booking_id: BOOKING, action: 'contract_accepted' })])
  })

  it('says both things when the audit row fails and the acceptance cannot be put back either', async () => {
    failTheAuditAndTheUndo()

    await expect(runCompletionHook(contractDocument(), [])).rejects.toThrow(
      'Could not record the accepted contract: audit unavailable (and the acceptance could not be put back: still unavailable)'
    )
  })

  it('does not undo an acceptance made another way when its own audit row fails', async () => {
    // The deposit was paid first, so there is nothing for this hook to change or to put back.
    seed({ private_bookings: [bookingRow({ contract_accepted_at: '2026-10-01T10:00:00.000Z', contract_acceptance_method: 'deposit_payment' })] })
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })

    await runCompletionHook(contractDocument(), [])

    expect(booking()).toMatchObject({ contract_accepted_at: '2026-10-01T10:00:00.000Z', contract_acceptance_method: 'deposit_payment' })
    expect(audit()).toHaveLength(0)
  })

  it('fails, and writes no audit row, when the booking cannot be updated', async () => {
    db.failNext({ table: 'private_bookings', operation: 'update', message: 'connection reset', times: 1 })

    await expect(runCompletionHook(contractDocument(), [])).rejects.toThrow('Could not mark the contract accepted: connection reset')

    expect(booking().contract_accepted_at).toBeNull()
    expect(audit()).toHaveLength(0)
  })
})

describe('a signed booking contract sent in the older form, with the food agreement on its last page', () => {
  const combined = () => contractDocument({ context: { contract_version: 3, includes_waiver: true } })

  it('accepts the contract and signs the food agreement, with an audit row for each', async () => {
    await runCompletionHook(combined(), [])

    expect(booking()).toMatchObject({ contract_accepted_at: SIGNED_AT, waiver_status: 'signed' })
    expect(audit()).toEqual([
      expect.objectContaining({ booking_id: BOOKING, field_name: 'waiver_status', new_value: 'signed' }),
      expect.objectContaining({ booking_id: BOOKING, action: 'contract_accepted' }),
    ])
  })

  it('still signs the food agreement when the deposit accepted the contract first', async () => {
    seed({ private_bookings: [bookingRow({ contract_accepted_at: '2026-10-11T09:00:00.000Z', contract_acceptance_method: 'deposit' })] })

    await runCompletionHook(combined(), [])

    expect(booking()).toMatchObject({ contract_acceptance_method: 'deposit', waiver_status: 'signed' })
    expect(audit()).toHaveLength(1)
  })

  it('changes nothing when run a second time', async () => {
    await runCompletionHook(combined(), [])
    await runCompletionHook(combined(), [])

    expect(audit()).toHaveLength(2)
  })
})

describe('a signed self-catering and outside food agreement', () => {
  it.each(['required', 'sent', 'overdue', 'not_required'])(
    'marks the agreement signed and records that it was %s before',
    async (before) => {
      seed({ private_bookings: [bookingRow({ waiver_status: before })] })

      await runCompletionHook(waiverDocument(), [])

      expect(booking().waiver_status).toBe('signed')
      expect(audit()).toEqual([
        expect.objectContaining({
          booking_id: BOOKING,
          action: 'field_updated',
          field_name: 'waiver_status',
          old_value: before,
          new_value: 'signed',
          performed_by: null,
          metadata: { via: 'e_signature', signing_document_id: WAIVER_DOCUMENT },
        }),
      ])
      // Signing the food agreement is not accepting the contract.
      expect(booking()).toMatchObject({ contract_accepted_at: null, contract_acceptance_method: null })
    }
  )

  it('leaves a cancelled booking alone: the status stays and nothing is written', async () => {
    seed({ private_bookings: [bookingRow({ status: 'cancelled', waiver_status: 'sent' })] })

    await runCompletionHook(waiverDocument(), [])

    expect(booking()).toMatchObject({ status: 'cancelled', waiver_status: 'sent' })
    expect(audit()).toHaveLength(0)
    expect(db.writes).toHaveLength(0)
  })

  it('leaves alone a booking that is cancelled in the moment between the read and the write', async () => {
    db.beforeUpdate((table, matched) => {
      if (table === 'private_bookings') for (const row of matched) row.status = 'cancelled'
    })

    await runCompletionHook(waiverDocument(), [])

    expect(booking()).toMatchObject({ status: 'cancelled', waiver_status: 'sent' })
    expect(audit()).toHaveLength(0)
  })

  it('does not treat a booking with no status as cancelled', async () => {
    seed({ private_bookings: [bookingRow({ status: null, waiver_status: 'sent' })] })

    await runCompletionHook(waiverDocument(), [])

    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toHaveLength(1)
  })

  it('writes nothing when the agreement is already marked signed', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'signed' })] })

    await runCompletionHook(waiverDocument(), [])

    expect(booking().waiver_status).toBe('signed')
    expect(db.writes).toHaveLength(0)
  })

  it('writes nothing when the booking no longer exists', async () => {
    seed({ private_bookings: [bookingRow({ id: OTHER_BOOKING })] })

    await runCompletionHook(waiverDocument(), [])

    expect(booking(OTHER_BOOKING).waiver_status).toBe('sent')
    expect(db.writes).toHaveLength(0)
  })

  it('writes no audit row when the status changed in the moment between the read and the write', async () => {
    // A member of staff recorded a paper copy as signed just as the online signature landed.
    db.beforeUpdate((table, matched) => {
      if (table === 'private_bookings') for (const row of matched) row.waiver_status = 'signed'
    })

    await runCompletionHook(waiverDocument(), [])

    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toHaveLength(0)
  })

  // A contract send or a booking save can move the status in the moment between this hook reading
  // it and writing it. The signature still has to land: matching only the status that was read
  // would miss, report success, and never be tried again.
  it.each([
    ['required', 'sent'],
    ['sent', 'overdue'],
    ['sent', 'not_required'],
    ['not_required', 'required'],
  ])('still marks the agreement signed when the status moves from %s to %s between the read and the write', async (read, movedTo) => {
    seed({ private_bookings: [bookingRow({ waiver_status: read })] })
    let moved = false
    db.beforeUpdate((table, matched) => {
      if (table !== 'private_bookings' || moved) return
      moved = true
      for (const row of matched) row.waiver_status = movedTo
    })

    await runCompletionHook(waiverDocument(), [])

    expect(moved).toBe(true)
    expect(booking().waiver_status).toBe('signed')
    // The audit row names the status that was really overwritten, not the one first read.
    expect(audit()).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        field_name: 'waiver_status',
        old_value: movedTo,
        new_value: 'signed',
        metadata: { via: 'e_signature', signing_document_id: WAIVER_DOCUMENT },
      }),
    ])
  })

  /** Another writer moves the status, once for each value given, each time this hook goes to write. */
  function statusKeepsMoving(to: string[]): { moves: () => number } {
    let moves = 0
    db.beforeUpdate((table, matched) => {
      if (table !== 'private_bookings' || moves >= to.length) return
      for (const row of matched) row.waiver_status = to[moves]
      moves += 1
    })
    return { moves: () => moves }
  }

  it('reads again and still signs when the status moves twice running', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'required' })] })
    const other = statusKeepsMoving(['sent', 'overdue'])

    await runCompletionHook(waiverDocument(), [])

    expect(other.moves()).toBe(2)
    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toEqual([expect.objectContaining({ old_value: 'overdue', new_value: 'signed' })])
  })

  it('fails, so that it is run again, when the status moves three times running', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'required' })] })
    const other = statusKeepsMoving(['sent', 'overdue', 'required'])

    await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow('Could not mark the waiver signed: its status kept changing')

    // Nothing half done: not signed, and no audit row for a change that did not happen.
    expect(other.moves()).toBe(3)
    expect(booking().waiver_status).toBe('required')
    expect(audit()).toHaveLength(0)

    // Run again once things are quiet, it signs, and says what it overwrote.
    await runCompletionHook(waiverDocument(), [])
    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toEqual([expect.objectContaining({ old_value: 'required', new_value: 'signed' })])
  })

  it('puts back the status it really overwrote, not the one it first read, when the audit row cannot be written', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'required' })] })
    statusKeepsMoving(['sent'])
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })

    await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow('Could not record the signed waiver: audit unavailable')

    expect(booking().waiver_status).toBe('sent')
    expect(audit()).toHaveLength(0)

    await runCompletionHook(waiverDocument(), [])
    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toEqual([expect.objectContaining({ old_value: 'sent', new_value: 'signed' })])
  })

  it('stands aside quietly when someone else marks it signed while it is reading again', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'required' })] })
    // Moved once, then recorded as signed on paper by staff before the second attempt lands.
    statusKeepsMoving(['sent', 'signed'])

    await expect(runCompletionHook(waiverDocument(), [])).resolves.toBeUndefined()

    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toHaveLength(0)
  })

  it('stops, and leaves the booking alone, when it is cancelled while it is reading again', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'required' })] })
    let moves = 0
    db.beforeUpdate((table, matched) => {
      if (table !== 'private_bookings') return
      moves += 1
      for (const row of matched) Object.assign(row, moves === 1 ? { waiver_status: 'sent' } : { status: 'cancelled' })
    })

    await expect(runCompletionHook(waiverDocument(), [])).resolves.toBeUndefined()

    expect(booking()).toMatchObject({ status: 'cancelled', waiver_status: 'sent' })
    expect(audit()).toHaveLength(0)
  })

  it('changes nothing when run a second time', async () => {
    await runCompletionHook(waiverDocument(), [])
    await runCompletionHook(waiverDocument(), [])

    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toHaveLength(1)
  })

  it.each(['required', 'sent', 'overdue', 'not_required'])(
    'returns the status to %s and fails when the audit row cannot be written',
    async (before) => {
      seed({ private_bookings: [bookingRow({ waiver_status: before })] })
      db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })

      await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow('Could not record the signed waiver: audit unavailable')

      expect(booking().waiver_status).toBe(before)
      expect(audit()).toHaveLength(0)
    }
  )

  it('ends signed, with exactly one audit row saying what it was before, when tried again after an audit failure', async () => {
    seed({ private_bookings: [bookingRow({ waiver_status: 'overdue' })] })
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })
    await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow('audit unavailable')

    await runCompletionHook(waiverDocument(), [])

    expect(booking().waiver_status).toBe('signed')
    expect(audit()).toEqual([expect.objectContaining({ field_name: 'waiver_status', old_value: 'overdue', new_value: 'signed' })])
  })

  it('says both things when the audit row fails and the status cannot be put back either', async () => {
    failTheAuditAndTheUndo()

    await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow(
      'Could not record the signed waiver: audit unavailable (and the change could not be put back: still unavailable)'
    )
  })

  it('fails when the booking cannot be read, and when it cannot be updated', async () => {
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'connection reset', times: 1 })
    await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow('Could not read the booking: connection reset')

    db.failNext({ table: 'private_bookings', operation: 'update', message: 'connection reset', times: 1 })
    await expect(runCompletionHook(waiverDocument(), [])).rejects.toThrow('Could not mark the waiver signed: connection reset')

    expect(booking().waiver_status).toBe('sent')
    expect(audit()).toHaveLength(0)
  })
})

describe('a signed worker agreement', () => {
  function workerAgreement(overrides: Partial<SigningDocumentRow> = {}): SigningDocumentRow {
    return signedDocument({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      kind: 'employment_agreement',
      brand: 'staff',
      title: 'Worker agreement',
      subject_type: 'employee',
      subject_id: EMPLOYEE,
      series_key: 'employment_agreement',
      context: {},
      ...overrides,
    })
  }

  function checklist(): Row[] {
    return db.rows('employee_onboarding_checklist')
  }

  it('ticks the agreement on the new starter checklist, dated when it was signed', async () => {
    seed({})

    await runCompletionHook(workerAgreement(), [])

    expect(checklist()).toEqual([
      expect.objectContaining({ employee_id: EMPLOYEE, employee_agreement_accepted: true, employee_agreement_accepted_date: SIGNED_AT }),
    ])
  })

  it('does not move the date when it runs again later', async () => {
    seed({})
    await runCompletionHook(workerAgreement(), [])
    vi.setSystemTime(new Date('2026-10-25T06:00:00.000Z'))

    await runCompletionHook(workerAgreement(), [])

    expect(checklist()).toHaveLength(1)
    expect(checklist()[0].employee_agreement_accepted_date).toBe(SIGNED_AT)
  })

  it('ticks a checklist that is already there, leaving its other ticks as they were', async () => {
    seed({ employee_onboarding_checklist: [{ id: 'row-1', employee_id: EMPLOYEE, uniform_issued: true, employee_agreement_accepted: false }] })

    await runCompletionHook(workerAgreement(), [])

    expect(checklist()).toEqual([
      expect.objectContaining({
        id: 'row-1',
        uniform_issued: true,
        employee_agreement_accepted: true,
        employee_agreement_accepted_date: SIGNED_AT,
      }),
    ])
  })

  it('falls back to the time it ran for a document with no completion time recorded', async () => {
    seed({})

    await runCompletionHook(workerAgreement({ completed_at: null }), [])

    expect(checklist()[0].employee_agreement_accepted_date).toBe(RUN_AT)
  })

  it('fails when the checklist cannot be written', async () => {
    seed({})
    db.failNext({ table: 'employee_onboarding_checklist', operation: 'insert', message: 'connection reset', times: 1 })

    await expect(runCompletionHook(workerAgreement(), [])).rejects.toThrow('Could not tick the onboarding checklist: connection reset')
  })
})

describe('a signed quote acceptance', () => {
  const QUOTE = '44444444-4444-4444-8444-444444444444'
  const QUOTE_DOCUMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const WINE = { description: 'House wine, case of six', quantity: 3, unit_price: 25.5, discount_percentage: 10, vat_rate: 20, total_amount: 82.62 }
  const SNACKS = { description: 'Bar snacks', quantity: 1, unit_price: 40, discount_percentage: 0, vat_rate: 20, total_amount: 48 }

  function quoteRow(extra: Row = {}): Row {
    return {
      id: QUOTE,
      quote_number: 'QT-2026-0001',
      vendor_id: 'vendor-1',
      quote_date: '2026-10-01',
      valid_until: '2026-10-31',
      reference: 'Enquiry 88',
      status: 'sent',
      quote_discount_percentage: 0,
      subtotal_amount: 116.5,
      discount_amount: 7.65,
      vat_amount: 21.77,
      total_amount: 130.62,
      notes: 'Delivery to the cellar door.',
      internal_notes: 'Margin is thin on the wine.',
      line_items: [WINE, SNACKS],
      ...extra,
    }
  }

  /** The fingerprint taken when the quote was sent for acceptance, of the quote as it was then. */
  const WHEN_SENT = quoteContentFingerprint(quoteRow() as QuoteContentForFingerprint)

  function acceptance(context: Record<string, unknown> = { quote_fingerprint: WHEN_SENT, total_amount: 130.62 }): SigningDocumentRow {
    return signedDocument({
      id: QUOTE_DOCUMENT,
      kind: 'quote_acceptance',
      brand: 'staff',
      title: 'Quote QT-2026-0001',
      subject_type: 'quote',
      subject_id: QUOTE,
      series_key: 'quote_acceptance',
      context,
    })
  }

  function storedQuote(): Row {
    return db.rows('quotes').find((row) => row.id === QUOTE) as Row
  }

  it('marks the quote accepted when it still says what the client was shown', async () => {
    seed({ quotes: [quoteRow()] })

    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe('accepted')
  })

  it('leaves the quote alone when a line was reworded and the total stayed the same', async () => {
    seed({ quotes: [quoteRow({ line_items: [{ ...WINE, description: 'House wine, case of twelve' }, SNACKS] })] })

    await runCompletionHook(acceptance(), [])

    // Same total, so the old check alone would have accepted it.
    expect(storedQuote()).toMatchObject({ status: 'sent', total_amount: 130.62 })
    expect(db.writes).toHaveLength(0)
  })

  it.each([
    ['its notes', { notes: 'Delivery to the front door.' }],
    ['its valid-until date', { valid_until: '2026-12-31' }],
    ['its reference', { reference: 'Enquiry 89' }],
    ['a line added at no charge', { line_items: [WINE, SNACKS, { description: 'Glass hire', quantity: 50, unit_price: 0, discount_percentage: 0, vat_rate: 20, total_amount: 0 }] }],
    ['two lines traded off against each other', { line_items: [{ ...WINE, total_amount: 80.62 }, { ...SNACKS, total_amount: 50 }] }],
  ] as Array<[string, Row]>)('leaves the quote alone when %s changed after it was sent', async (_what, change) => {
    seed({ quotes: [quoteRow(change)] })

    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe('sent')
  })

  it('accepts the quote however the database orders its lines and writes its numbers', async () => {
    seed({
      quotes: [
        quoteRow({
          quote_discount_percentage: '0.00',
          line_items: [
            { ...SNACKS, quantity: '1.000', unit_price: '40.00', discount_percentage: '0.00', vat_rate: '20.00', total_amount: '48.00' },
            { ...WINE, quantity: '3', unit_price: '25.50', discount_percentage: '10.00', vat_rate: '20', total_amount: '82.62' },
          ],
        }),
      ],
    })

    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe('accepted')
  })

  it('accepts a draft that was moved to Sent when it was sent for acceptance: that is not a change to the quote', async () => {
    const whenDraft = quoteContentFingerprint(quoteRow({ status: 'draft' }) as QuoteContentForFingerprint)
    seed({ quotes: [quoteRow({ status: 'sent' })] })

    await runCompletionHook(acceptance({ quote_fingerprint: whenDraft, total_amount: 130.62 }), [])

    expect(storedQuote().status).toBe('accepted')
  })

  it('accepts a quote stored with an empty amount, which reads as nought when it is sent', async () => {
    // Read for sending, the empty discount is 0. The stored row still has it empty.
    const whenSent = quoteContentFingerprint(quoteRow({ discount_amount: 0, quote_discount_percentage: 0 }) as QuoteContentForFingerprint)
    seed({ quotes: [quoteRow({ discount_amount: null, quote_discount_percentage: null })] })

    await runCompletionHook(acceptance({ quote_fingerprint: whenSent, total_amount: 130.62 }), [])

    expect(storedQuote().status).toBe('accepted')
  })

  it('accepts the quote when only what staff see has changed', async () => {
    seed({ quotes: [quoteRow({ internal_notes: 'Changed our minds about the margin.' })] })

    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe('accepted')
  })

  it.each(['accepted', 'rejected', 'expired'])('still leaves a quote that staff have marked %s, though it says the same', async (status) => {
    seed({ quotes: [quoteRow({ status })] })

    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe(status)
  })

  it('still checks the total recorded when it was sent', async () => {
    seed({ quotes: [quoteRow()] })

    // The wording matches, but the total on record for this request is not the one on the quote.
    await runCompletionHook(acceptance({ quote_fingerprint: WHEN_SENT, total_amount: 999 }), [])

    expect(storedQuote().status).toBe('sent')
  })

  it('behaves as it did before for a request sent with no fingerprint: only the status and the total are checked', async () => {
    seed({ quotes: [quoteRow({ line_items: [{ ...WINE, description: 'House wine, case of twelve' }, SNACKS] })] })
    await runCompletionHook(acceptance({ total_amount: 130.62 }), [])
    expect(storedQuote().status).toBe('accepted')

    seed({ quotes: [quoteRow({ total_amount: 140 })] })
    await runCompletionHook(acceptance({ total_amount: 130.62 }), [])
    expect(storedQuote().status).toBe('sent')

    seed({ quotes: [quoteRow()] })
    await runCompletionHook(acceptance({}), [])
    expect(storedQuote().status).toBe('accepted')
  })

  it('treats a fingerprint that is not text as no fingerprint', async () => {
    for (const notText of [null, 12345, true, { sha: WHEN_SENT }]) {
      seed({ quotes: [quoteRow({ notes: 'Reworded since.' })] })

      await runCompletionHook(acceptance({ quote_fingerprint: notText, total_amount: 130.62 }), [])

      expect(storedQuote().status, JSON.stringify(notText)).toBe('accepted')
    }
  })

  it('does nothing for a quote that no longer exists', async () => {
    seed({ quotes: [] })

    await expect(runCompletionHook(acceptance(), [])).resolves.toBeUndefined()

    expect(db.writes).toHaveLength(0)
  })

  it('touches only its own quote', async () => {
    const other = '99999999-9999-4999-8999-999999999999'
    seed({ quotes: [quoteRow({ id: other }), quoteRow()] })

    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe('accepted')
    expect(db.rows('quotes').find((row) => row.id === other)?.status).toBe('sent')
  })

  it('fails, and accepts nothing, when the quote cannot be read to check it', async () => {
    seed({ quotes: [quoteRow()] })
    db.failNext({ table: 'quotes', operation: 'select', message: 'connection reset', times: 1 })

    await expect(runCompletionHook(acceptance(), [])).rejects.toThrow('Could not read the quote: connection reset')

    expect(storedQuote().status).toBe('sent')
  })

  it('fails when the quote cannot be marked accepted', async () => {
    seed({ quotes: [quoteRow()] })
    db.failNext({ table: 'quotes', operation: 'update', message: 'connection reset', times: 1 })

    await expect(runCompletionHook(acceptance(), [])).rejects.toThrow('Could not mark the quote accepted: connection reset')

    expect(storedQuote().status).toBe('sent')
  })

  it('changes nothing when run a second time', async () => {
    seed({ quotes: [quoteRow()] })

    await runCompletionHook(acceptance(), [])
    await runCompletionHook(acceptance(), [])

    expect(storedQuote().status).toBe('accepted')
  })
})

describe('which hook runs for which document', () => {
  it('runs the food agreement hook for the food agreement and the contract hook for the contract', async () => {
    await SIGNING_COMPLETION_HOOKS.private_booking_waiver(waiverDocument(), [])
    expect(booking()).toMatchObject({ waiver_status: 'signed', contract_accepted_at: null })

    await SIGNING_COMPLETION_HOOKS.private_booking_contract(contractDocument(), [])
    expect(booking()).toMatchObject({ waiver_status: 'signed', contract_accepted_at: SIGNED_AT })
    expect(audit().map((row) => row.action)).toEqual(['field_updated', 'contract_accepted'])
  })
})
