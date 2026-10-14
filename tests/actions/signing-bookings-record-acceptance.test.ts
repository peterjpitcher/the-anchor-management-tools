// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  canSend: vi.fn(),
  canView: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.logError } }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: vi.fn(), createPdfBrowser: vi.fn(), closePdfBrowser: vi.fn() }))
vi.mock('@/lib/signing/staff', () => ({
  getSigningStaffUser: mocks.user,
  canSendSigningKind: mocks.canSend,
  canViewSigningKind: mocks.canView,
}))

// The signing service is the real one, run against the fake rows, so a withdrawn request is
// seen as it would be stored: voided, with its reason and its event.
import {
  getBookingSigningState,
  recordContractAcceptedAnotherWay,
  type RecordContractAcceptanceInput,
} from '@/app/actions/signing-bookings'

const BOOKING = '33333333-3333-4333-8333-333333333333'
const OTHER_BOOKING = '44444444-4444-4444-8444-444444444444'
const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'billy@example.test', name: 'Billy Summers', position: 'General Manager' }
const NOTE = 'Signed copy is in the bookings folder in the office.'

let db: FakeDb

function bookingRow(extra: Row = {}): Row {
  return {
    id: BOOKING,
    status: 'confirmed',
    contact_email: 'sam@example.com',
    outside_food: false,
    waiver_status: 'not_required',
    contract_version: 2,
    contract_sent_at: '2026-10-01T09:00:00.000Z',
    contract_accepted_at: null,
    contract_acceptance_method: null,
    items: [],
    ...extra,
  }
}

function signingDocument(id: string, kind: string, status: string, subjectId: string = BOOKING): Row {
  return { id, kind, status, subject_type: 'private_booking', subject_id: subjectId, void_reason: null }
}

function seed(booking: Row, documents: Row[] = []): void {
  db = createFakeDb({ private_bookings: [booking], signing_documents: documents })
  mocks.client = db.client
}

function saved(): Row {
  return db.rows('private_bookings')[0]
}

function documentStatus(id: string): unknown {
  return db.rows('signing_documents').find((row) => row.id === id)?.status
}

function input(extra: Partial<RecordContractAcceptanceInput> = {}): RecordContractAcceptanceInput {
  return { bookingId: BOOKING, method: 'signed_paper', acceptedOn: '2026-10-09', note: NOTE, ...extra }
}

/** Only the date is frozen, so the promises the fake database returns still settle. */
function setNow(instant: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
}

function expectNothingWritten(): void {
  expect(db.writes).toHaveLength(0)
  expect(saved().contract_accepted_at).toBeNull()
  expect(saved().contract_acceptance_method).toBeNull()
  expect(mocks.audit).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  setNow('2026-10-13T10:00:00.000Z')
  mocks.user.mockResolvedValue(STAFF)
  mocks.canSend.mockResolvedValue(true)
  mocks.canView.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  seed(bookingRow())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('recording a contract accepted on paper or in writing', () => {
  it.each(['signed_paper', 'written_confirmation'] as const)('records %s on the booking, with who said so and where the evidence is', async (method) => {
    const result = await recordContractAcceptedAnotherWay(input({ method, note: `   ${NOTE}  ` }))

    expect(result).toEqual({ success: true, data: { acceptedAt: '2026-10-09T11:00:00.000Z', withdrawn: 0 } })
    expect(saved().contract_accepted_at).toBe('2026-10-09T11:00:00.000Z')
    expect(saved().contract_acceptance_method).toBe(method)
    expect(db.rows('private_booking_audit')).toEqual([
      expect.objectContaining({
        booking_id: BOOKING,
        action: 'contract_accepted',
        performed_by: STAFF.id,
        // The note is kept trimmed.
        metadata: { via: method, accepted_on: '2026-10-09', note: NOTE, contract_version: 2 },
      }),
    ])
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: STAFF.id,
        operation_type: 'update',
        resource_type: 'private_booking',
        resource_id: BOOKING,
        operation_status: 'success',
        additional_info: { action: 'contract_accepted', via: method, accepted_on: '2026-10-09', note: NOTE, contract_version: 2 },
      })
    )
    expect(mocks.revalidate).toHaveBeenCalledWith(`/private-bookings/${BOOKING}`)
    expect(mocks.canSend).toHaveBeenCalledWith('private_booking_contract', STAFF.id)
  })

  it('records it on a booking with no status at all', async () => {
    seed(bookingRow({ status: null }))

    expect((await recordContractAcceptedAnotherWay(input())).success).toBe(true)
    expect(saved().contract_acceptance_method).toBe('signed_paper')
  })

  it('counts a contract that was generated but never emailed (printed and handed over) as produced', async () => {
    seed(bookingRow({ contract_version: 1, contract_sent_at: null }))

    expect((await recordContractAcceptedAnotherWay(input())).success).toBe(true)
    expect(db.rows('private_booking_audit')[0].metadata).toMatchObject({ contract_version: 1 })
  })
})

describe('the time written for the day staff give', () => {
  it.each([
    // Summer time: midday in London is 11:00 UTC.
    ['2026-10-24', '2026-10-24T11:00:00.000Z'],
    // The clocks went back at 02:00 that morning: midday is 12:00 UTC.
    ['2026-10-25', '2026-10-25T12:00:00.000Z'],
    ['2027-03-27', '2027-03-27T12:00:00.000Z'],
    // The clocks went forward at 01:00 that morning: midday is 11:00 UTC.
    ['2027-03-28', '2027-03-28T11:00:00.000Z'],
  ])('is midday on the London clock for %s', async (acceptedOn, expected) => {
    setNow('2027-04-02T09:00:00.000Z')

    const result = await recordContractAcceptedAnotherWay(input({ acceptedOn }))

    expect(result.data?.acceptedAt).toBe(expected)
    expect(saved().contract_accepted_at).toBe(expected)
    // Read back in London, it is the day staff gave, at 12:00.
    const london = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(expected))
    const [year, month, day] = acceptedOn.split('-')
    expect(london).toBe(`${day}/${month}/${year}, 12:00`)
  })

  it('takes today as the London date, not the UTC one, just after midnight in summer', async () => {
    // 23:30 UTC on the 13th is 00:30 on the 14th in London.
    setNow('2026-10-13T23:30:00.000Z')

    expect((await recordContractAcceptedAnotherWay(input({ acceptedOn: '2026-10-14' }))).success).toBe(true)

    seed(bookingRow())
    expect(await recordContractAcceptedAnotherWay(input({ acceptedOn: '2026-10-15' }))).toEqual({
      error: 'The date the contract was accepted cannot be in the future.',
    })
    expect(db.writes).toHaveLength(0)
    expect(saved().contract_accepted_at).toBeNull()
  })
})

describe('refusing to record an acceptance', () => {
  it('is refused to someone who is not signed in, or who may not send the contract', async () => {
    mocks.user.mockResolvedValueOnce(null)
    expect(await recordContractAcceptedAnotherWay(input())).toEqual({ error: 'Unauthorized' })

    mocks.canSend.mockResolvedValueOnce(false)
    expect(await recordContractAcceptedAnotherWay(input())).toEqual({ error: 'Insufficient permissions' })
    expect(mocks.canSend).toHaveBeenCalledWith('private_booking_contract', STAFF.id)
    expectNothingWritten()
  })

  it.each([
    ['an id that is not a booking id', { bookingId: 'not-a-booking' }, 'Unknown booking.'],
    ['a method staff may not record', { method: 'deposit_payment' as never }, 'Choose how the contract was accepted: signed on paper, or confirmed in writing.'],
    ['the online method', { method: 'e_signature' as never }, 'Choose how the contract was accepted: signed on paper, or confirmed in writing.'],
    ['a date that is not a date', { acceptedOn: '2026-02-30' }, 'Enter the date the contract was accepted.'],
    ['a date in another format', { acceptedOn: '09/10/2026' }, 'Enter the date the contract was accepted.'],
    ['a note that is too short', { note: '  in office ' }, 'Say where the signed copy or the written confirmation is kept (at least 10 characters).'],
    ['a note that is too long', { note: 'x'.repeat(501) }, 'Keep the note to 500 characters or fewer.'],
    ['a date in the future', { acceptedOn: '2026-10-14' }, 'The date the contract was accepted cannot be in the future.'],
  ])('refuses %s', async (_label, extra, message) => {
    expect(await recordContractAcceptedAnotherWay(input(extra))).toEqual({ error: message })
    expectNothingWritten()
  })

  it('accepts a note of exactly 10 and of exactly 500 characters, and a date of today', async () => {
    expect((await recordContractAcceptedAnotherWay(input({ note: '1234567890', acceptedOn: '2026-10-13' }))).success).toBe(true)
    seed(bookingRow())
    expect((await recordContractAcceptedAnotherWay(input({ note: 'x'.repeat(500) }))).success).toBe(true)
  })

  it('refuses a booking that does not exist', async () => {
    expect(await recordContractAcceptedAnotherWay(input({ bookingId: OTHER_BOOKING }))).toEqual({ error: 'Booking not found.' })
    expectNothingWritten()
  })

  it('refuses a cancelled booking', async () => {
    seed(bookingRow({ status: 'cancelled' }))

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({
      error: 'This booking is cancelled, so its contract cannot be recorded as accepted.',
    })
    expectNothingWritten()
  })

  it.each([
    ['version 0', 0],
    ['no version', null],
  ])('refuses a booking no contract was ever produced for (%s, never sent)', async (_label, version) => {
    seed(bookingRow({ contract_version: version, contract_sent_at: null }))

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({
      error: 'No contract has been produced for this booking yet. Generate or email the contract first.',
    })
    expectNothingWritten()
  })

  it.each([
    ['e_signature', '2026-10-12T14:03:00.000Z', 'This contract is already accepted: signed online on 12 October 2026.'],
    ['deposit_payment', '2026-10-02T08:00:00.000Z', 'This contract is already accepted: accepted by paying the deposit on 2 October 2026.'],
    ['signed_paper', '2026-10-05T11:00:00.000Z', 'This contract is already accepted: signed on paper on 5 October 2026.'],
    ['written_confirmation', '2026-10-06T11:00:00.000Z', 'This contract is already accepted: confirmed in writing on 6 October 2026.'],
  ])('refuses a contract already accepted by %s, and says how and when', async (method, acceptedAt, message) => {
    seed(bookingRow({ contract_accepted_at: acceptedAt, contract_acceptance_method: method }))

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({ error: message })
    expect(db.writes).toHaveLength(0)
    expect(saved().contract_acceptance_method).toBe(method)
    expect(saved().contract_accepted_at).toBe(acceptedAt)
  })

  it('reports a booking that could not be read, and writes nothing', async () => {
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'connection reset' })

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({ error: 'Could not read the booking: connection reset' })
    expectNothingWritten()
  })

  it('reports a write the database refused', async () => {
    db.failNext({ table: 'private_bookings', operation: 'update', message: 'deadlock detected' })

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({ error: 'Could not record the acceptance: deadlock detected' })
    expect(db.rows('private_booking_audit')).toHaveLength(0)
    expect(mocks.audit).not.toHaveBeenCalled()
  })
})

describe('something else happening between the read and the write', () => {
  /** Runs once, just before the first write to the booking. */
  function beforeTheWrite(change: (booking: Row) => void): void {
    let done = false
    db.beforeUpdate((table) => {
      if (done || table !== 'private_bookings') return
      done = true
      change(db.rows('private_bookings')[0])
    })
  }

  it('leaves a deposit payment that landed first as the acceptance, and says so', async () => {
    seed(bookingRow(), [signingDocument('doc-contract', 'private_booking_contract', 'sent')])
    beforeTheWrite((booking) => {
      booking.contract_accepted_at = '2026-10-13T09:59:59.000Z'
      booking.contract_acceptance_method = 'deposit_payment'
    })

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({
      error: 'This contract is already accepted: accepted by paying the deposit on 13 October 2026.',
    })
    expect(saved().contract_acceptance_method).toBe('deposit_payment')
    expect(saved().contract_accepted_at).toBe('2026-10-13T09:59:59.000Z')
    expect(db.rows('private_booking_audit')).toHaveLength(0)
    expect(mocks.audit).not.toHaveBeenCalled()
    // A customer who paid may still sign, so their link is left working.
    expect(documentStatus('doc-contract')).toBe('sent')
  })

  it('does not write to a booking cancelled in that moment', async () => {
    beforeTheWrite((booking) => {
      booking.status = 'cancelled'
    })

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({
      error: 'This booking is cancelled, so its contract cannot be recorded as accepted.',
    })
    expect(saved().contract_accepted_at).toBeNull()
    expect(saved().contract_acceptance_method).toBeNull()
    expect(db.rows('private_booking_audit')).toHaveLength(0)
  })

  it('reports a booking deleted in that moment', async () => {
    beforeTheWrite(() => {
      db.rows('private_bookings').splice(0, 1)
    })

    expect(await recordContractAcceptedAnotherWay(input())).toEqual({ error: 'Booking not found.' })
    expect(db.rows('private_booking_audit')).toHaveLength(0)
  })
})

describe('the acceptance and its audit row belong together', () => {
  it('puts the acceptance back, and reports an error, when the audit row cannot be written', async () => {
    seed(bookingRow(), [signingDocument('doc-contract', 'private_booking_contract', 'sent')])
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'violates check constraint', times: 1 })

    const result = await recordContractAcceptedAnotherWay(input())

    expect(result).toEqual({ error: 'The acceptance could not be recorded, so nothing was changed. Please try again.' })
    expect(saved().contract_accepted_at).toBeNull()
    expect(saved().contract_acceptance_method).toBeNull()
    expect(db.rows('private_booking_audit')).toHaveLength(0)
    // Nothing that follows a recorded acceptance happened.
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(documentStatus('doc-contract')).toBe('sent')
    expect(mocks.logError).toHaveBeenCalledTimes(1)

    // And it can be recorded on the next attempt.
    expect((await recordContractAcceptedAnotherWay(input())).success).toBe(true)
    expect(saved().contract_acceptance_method).toBe('signed_paper')
  })

  it('only puts back the acceptance it wrote itself', async () => {
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'violates check constraint', times: 1 })
    let updates = 0
    db.beforeUpdate((table) => {
      updates += table === 'private_bookings' ? 1 : 0
      // Just before the undo: the online signature has replaced what this action wrote.
      if (updates === 2) {
        db.rows('private_bookings')[0].contract_acceptance_method = 'e_signature'
        db.rows('private_bookings')[0].contract_accepted_at = '2026-10-13T10:00:01.000Z'
      }
    })

    expect((await recordContractAcceptedAnotherWay(input())).error).toBeTruthy()
    expect(saved().contract_acceptance_method).toBe('e_signature')
    expect(saved().contract_accepted_at).toBe('2026-10-13T10:00:01.000Z')
  })

  it('says plainly when the acceptance could not be put back either', async () => {
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'violates check constraint', times: 1 })
    let armed = false
    db.beforeUpdate((table) => {
      if (armed || table !== 'private_bookings') return
      armed = true
      // The next write to the booking is the undo.
      db.failNext({ table: 'private_bookings', operation: 'update', message: 'connection reset', times: 1 })
    })

    const result = await recordContractAcceptedAnotherWay(input())

    expect(result.success).toBeUndefined()
    expect(result.error).toContain('could not be undone')
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ undone: false, undoError: 'connection reset' }) })
    )
  })

  it('still records the acceptance when the wider audit log cannot be written', async () => {
    mocks.audit.mockRejectedValue(new Error('audit service down'))

    const result = await recordContractAcceptedAnotherWay(input())

    expect(result.success).toBe(true)
    expect(saved().contract_acceptance_method).toBe('signed_paper')
    expect(db.rows('private_booking_audit')).toHaveLength(1)
    expect(mocks.logError).toHaveBeenCalledTimes(1)
  })
})

describe('withdrawing the request to sign the contract online', () => {
  function seedWithRequests(): void {
    seed(bookingRow({ outside_food: true, waiver_status: 'sent' }), [
      signingDocument('doc-contract-open', 'private_booking_contract', 'sent'),
      signingDocument('doc-contract-part', 'private_booking_contract', 'part_signed'),
      signingDocument('doc-contract-old', 'private_booking_contract', 'voided'),
      signingDocument('doc-waiver-open', 'private_booking_waiver', 'sent'),
      signingDocument('doc-other-booking', 'private_booking_contract', 'sent', OTHER_BOOKING),
    ])
  }

  it.each([
    ['signed_paper', 'The contract was signed on paper'],
    ['written_confirmation', 'The contract was confirmed in writing'],
  ] as const)('withdraws every open contract request with the reason for %s, and nothing else', async (method, reason) => {
    seedWithRequests()

    const result = await recordContractAcceptedAnotherWay(input({ method }))

    expect(result).toEqual({ success: true, data: { acceptedAt: '2026-10-09T11:00:00.000Z', withdrawn: 2 } })
    for (const id of ['doc-contract-open', 'doc-contract-part']) {
      expect(db.rows('signing_documents').find((row) => row.id === id)).toMatchObject({
        status: 'voided',
        voided_by: STAFF.id,
        void_reason: reason,
      })
    }
    // The food agreement has its own signature and is still owed.
    expect(documentStatus('doc-waiver-open')).toBe('sent')
    expect(saved().waiver_status).toBe('sent')
    // Another booking's contract is not this one's.
    expect(documentStatus('doc-other-booking')).toBe('sent')
    expect(db.rows('signing_documents').find((row) => row.id === 'doc-contract-old')?.void_reason).toBeNull()
    // The evidence trail records each withdrawal.
    expect(db.rows('signing_events').map((row) => [row.document_id, row.event, row.actor_user_id]).sort()).toEqual([
      ['doc-contract-open', 'voided', STAFF.id],
      ['doc-contract-part', 'voided', STAFF.id],
    ])
  })

  it('still records the acceptance, with a warning, when the request cannot be withdrawn', async () => {
    seedWithRequests()
    db.failNext({ table: 'signing_documents', operation: 'update', message: 'connection reset' })

    const result = await recordContractAcceptedAnotherWay(input())

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({
      acceptedAt: '2026-10-09T11:00:00.000Z',
      withdrawn: 0,
      warning:
        'The acceptance was recorded, but the request to sign the contract online could not be withdrawn. Withdraw it from the Signatures panel.',
    })
    expect(saved().contract_acceptance_method).toBe('signed_paper')
    expect(db.rows('private_booking_audit')).toHaveLength(1)
    expect(documentStatus('doc-contract-open')).toBe('sent')
    expect(mocks.logError).toHaveBeenCalledWith(
      'Could not withdraw the open contract signing request after a recorded acceptance',
      expect.objectContaining({ metadata: { bookingId: BOOKING, method: 'signed_paper' } })
    )
    expect(mocks.revalidate).toHaveBeenCalledWith(`/private-bookings/${BOOKING}`)
  })

  it('still records the acceptance, with a warning, when the open requests cannot be read', async () => {
    seedWithRequests()
    db.failNext({ table: 'signing_documents', operation: 'select', message: 'connection reset' })

    const result = await recordContractAcceptedAnotherWay(input())

    expect(result.success).toBe(true)
    expect(result.data?.warning).toContain('could not be withdrawn')
    expect(saved().contract_acceptance_method).toBe('signed_paper')
  })
})

describe('what the panel is told about the contract', () => {
  it('says a produced, unaccepted contract can have its acceptance recorded', async () => {
    const result = await getBookingSigningState(BOOKING)

    expect(result.data).toMatchObject({
      contractIssued: true,
      contractAcceptedAt: null,
      contractAcceptanceMethod: null,
      canRecordAcceptance: true,
    })
    expect(mocks.canSend).toHaveBeenCalledWith('private_booking_contract', STAFF.id)
  })

  it.each([
    ['e_signature', '2026-10-12T14:03:00.000Z'],
    ['deposit_payment', '2026-10-02T08:00:00.000Z'],
    ['signed_paper', '2026-10-05T11:00:00.000Z'],
    ['written_confirmation', '2026-10-06T11:00:00.000Z'],
  ])('says how and when a contract accepted by %s was accepted, and offers nothing more', async (method, acceptedAt) => {
    seed(bookingRow({ contract_accepted_at: acceptedAt, contract_acceptance_method: method }))

    expect((await getBookingSigningState(BOOKING)).data).toMatchObject({
      contractAcceptedAt: acceptedAt,
      contractAcceptanceMethod: method,
      canRecordAcceptance: false,
    })
  })

  it('does not offer it before a contract exists, or on a cancelled booking', async () => {
    seed(bookingRow({ contract_version: 0, contract_sent_at: null }))
    expect((await getBookingSigningState(BOOKING)).data).toMatchObject({ contractIssued: false, canRecordAcceptance: false })

    seed(bookingRow({ status: 'cancelled' }))
    expect((await getBookingSigningState(BOOKING)).data).toMatchObject({ contractIssued: true, canRecordAcceptance: false })
  })

  it('does not offer it to someone who may send the food agreement but not the contract', async () => {
    mocks.canSend.mockImplementation(async (kind: string) => kind === 'private_booking_waiver')

    expect((await getBookingSigningState(BOOKING)).data).toMatchObject({ canSend: true, canRecordAcceptance: false })
  })
})
