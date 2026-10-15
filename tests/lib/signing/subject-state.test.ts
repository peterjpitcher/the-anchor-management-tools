// @vitest-environment node
// Server code that reads with the service role: no browser globals wanted.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))

import { findSubjectClosure } from '@/lib/signing/subject-state'

type SubjectDocument = Parameters<typeof findSubjectClosure>[0]

const BOOKING = '11111111-1111-4111-8111-111111111111'
const OTHER_BOOKING = '22222222-2222-4222-8222-222222222222'
const VENDOR = '33333333-3333-4333-8333-333333333333'
const QUOTE = '44444444-4444-4444-8444-444444444444'
const EMPLOYEE = '55555555-5555-4555-8555-555555555555'
const APPLICATION = '66666666-6666-4666-8666-666666666666'
const INVOICE_VENDOR = '77777777-7777-4777-8777-777777777777'

function useDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db = createFakeDb(seed)
  state.client = db.client
  return db
}

/** A database that fails the test if anything reads it. */
function forbidReads(): void {
  state.client = {
    from: (table: string) => {
      throw new Error(`Nothing should have read ${table}`)
    },
  }
}

function contract(overrides: Partial<SubjectDocument> = {}): SubjectDocument {
  return { kind: 'private_booking_contract', subject_type: 'private_booking', subject_id: BOOKING, context: {}, ...overrides }
}

function waiver(overrides: Partial<SubjectDocument> = {}): SubjectDocument {
  return { kind: 'private_booking_waiver', subject_type: 'private_booking', subject_id: BOOKING, context: {}, ...overrides }
}

function supplierConfirmation(context: Record<string, unknown> = { private_booking_id: BOOKING }): SubjectDocument {
  return { kind: 'supplier_confirmation', subject_type: 'vendor', subject_id: VENDOR, context }
}

function quoteAcceptance(): SubjectDocument {
  return { kind: 'quote_acceptance', subject_type: 'quote', subject_id: QUOTE, context: {} }
}

function workerAgreement(overrides: Partial<SubjectDocument> = {}): SubjectDocument {
  return { kind: 'employment_agreement', subject_type: 'employee', subject_id: EMPLOYEE, context: {}, ...overrides }
}

function jobOffer(): SubjectDocument {
  return { kind: 'job_offer', subject_type: 'recruitment_application', subject_id: APPLICATION, context: {} }
}

/** Only the date is frozen, so the promises the fake database returns still settle. */
function setNow(instant: string): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
}

afterEach(() => {
  vi.useRealTimers()
  state.client = null
})

describe('a booking contract', () => {
  it('still stands while the booking is going ahead', async () => {
    for (const status of ['draft', 'confirmed', 'completed']) {
      useDb({ private_bookings: [{ id: BOOKING, status, waiver_status: 'not_required' }] })
      expect(await findSubjectClosure(contract()), status).toBeNull()
    }
  })

  it('is withdrawn when the booking was cancelled', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'cancelled', waiver_status: 'not_required' }] })

    expect(await findSubjectClosure(contract())).toBe('The booking was cancelled')
  })

  it('is withdrawn when the booking no longer exists', async () => {
    useDb({ private_bookings: [{ id: OTHER_BOOKING, status: 'confirmed', waiver_status: 'not_required' }] })

    expect(await findSubjectClosure(contract())).toBe('The booking no longer exists')
  })

  it('is not withdrawn because the food agreement was signed, which is a different document', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'signed' }] })

    expect(await findSubjectClosure(contract())).toBeNull()
  })

  it('is not withdrawn because the booking has no outside food: that rule is for the food agreement alone', async () => {
    for (const outsideFood of [false, null, undefined]) {
      useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: outsideFood, waiver_status: 'not_required' }] })
      expect(await findSubjectClosure(contract()), String(outsideFood)).toBeNull()
      // The same booking, asked about its food agreement, is closed.
      expect(await findSubjectClosure(waiver()), String(outsideFood)).toBe('The booking no longer has outside food')
    }
  })

  it.each(['signed_paper', 'written_confirmation'])(
    'is withdrawn once staff have recorded it as accepted another way (%s)',
    async (method) => {
      useDb({
        private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'not_required', contract_acceptance_method: method }],
      })

      expect(await findSubjectClosure(contract())).toBe('The contract was accepted another way')
    }
  )

  it('still stands after the deposit is paid: a customer who has paid may still sign', async () => {
    useDb({
      private_bookings: [
        {
          id: BOOKING,
          status: 'confirmed',
          waiver_status: 'not_required',
          contract_accepted_at: '2026-10-02T08:00:00.000Z',
          contract_acceptance_method: 'deposit_payment',
        },
      ],
    })

    expect(await findSubjectClosure(contract())).toBeNull()
  })

  it('still stands for any other recorded method, and for none', async () => {
    for (const method of ['e_signature', 'something_else', null, undefined]) {
      useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'not_required', contract_acceptance_method: method }] })
      expect(await findSubjectClosure(contract()), String(method)).toBeNull()
    }
  })

  it('gives the cancellation as the reason when the booking is cancelled as well', async () => {
    useDb({
      private_bookings: [{ id: BOOKING, status: 'cancelled', waiver_status: 'not_required', contract_acceptance_method: 'signed_paper' }],
    })

    expect(await findSubjectClosure(contract())).toBe('The booking was cancelled')
  })

  it('does not withdraw the food agreement or a supplier confirmation because the contract was accepted on paper', async () => {
    for (const method of ['signed_paper', 'written_confirmation']) {
      useDb({
        private_bookings: [
          { id: BOOKING, status: 'confirmed', outside_food: true, waiver_status: 'sent', contract_acceptance_method: method },
        ],
      })
      expect(await findSubjectClosure(waiver()), method).toBeNull()
      expect(await findSubjectClosure(supplierConfirmation()), method).toBeNull()
    }
  })

  it('looks at its own booking, not at another one', async () => {
    useDb({
      private_bookings: [
        { id: OTHER_BOOKING, status: 'cancelled', waiver_status: 'not_required' },
        { id: BOOKING, status: 'confirmed', waiver_status: 'not_required' },
      ],
    })

    expect(await findSubjectClosure(contract())).toBeNull()
    expect(await findSubjectClosure(contract({ subject_id: OTHER_BOOKING }))).toBe('The booking was cancelled')
  })
})

describe('a self-catering and outside food agreement', () => {
  it('is withdrawn when staff have already recorded it as signed', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'signed' }] })

    expect(await findSubjectClosure(waiver())).toBe('The waiver was recorded as signed by staff')
  })

  it('still stands while it is owed', async () => {
    for (const waiverStatus of ['required', 'sent', 'overdue']) {
      useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: true, waiver_status: waiverStatus }] })
      expect(await findSubjectClosure(waiver()), waiverStatus).toBeNull()
    }
  })

  it('still stands while the stored status says it is owed, even if the tick is off or was never read', async () => {
    // Saving the booking returns such a status to not required. Until that has happened, the status is what counts.
    for (const waiverStatus of ['required', 'sent', 'overdue']) {
      for (const outsideFood of [false, null, undefined]) {
        useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: outsideFood, waiver_status: waiverStatus }] })
        expect(await findSubjectClosure(waiver()), `${waiverStatus}, tick ${String(outsideFood)}`).toBeNull()
      }
    }
  })

  it('still stands for a booking stored as not required with "Outside food" ticked', async () => {
    // A tick made before the tick counted (13 October 2026): the stored status is out of date, and the agreement is owed.
    for (const waiverStatus of ['not_required', null]) {
      useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: true, waiver_status: waiverStatus }] })
      expect(await findSubjectClosure(waiver()), String(waiverStatus)).toBeNull()
    }
  })

  it('is withdrawn when the booking is stored as not required and "Outside food" is not ticked', async () => {
    // Staff unticked "Outside food" after the agreement went out: there is nothing left to sign.
    for (const waiverStatus of ['not_required', null]) {
      for (const outsideFood of [false, null, undefined]) {
        useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: outsideFood, waiver_status: waiverStatus }] })
        expect(await findSubjectClosure(waiver()), `${String(waiverStatus)}, tick ${String(outsideFood)}`).toBe(
          'The booking no longer has outside food'
        )
      }
    }
  })

  it('gives the signature staff recorded as the reason, even once the tick is off', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: false, waiver_status: 'signed' }] })

    expect(await findSubjectClosure(waiver())).toBe('The waiver was recorded as signed by staff')
  })

  it('gives the cancellation as the reason for a cancelled booking that also has no outside food', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'cancelled', outside_food: false, waiver_status: 'not_required' }] })

    expect(await findSubjectClosure(waiver())).toBe('The booking was cancelled')
  })

  it('is withdrawn when the booking was cancelled, whatever the waiver status says', async () => {
    for (const waiverStatus of ['sent', 'signed']) {
      useDb({ private_bookings: [{ id: BOOKING, status: 'cancelled', waiver_status: waiverStatus }] })
      expect(await findSubjectClosure(waiver()), waiverStatus).toBe('The booking was cancelled')
    }
  })

  it('is withdrawn when the booking no longer exists', async () => {
    useDb({ private_bookings: [] })

    expect(await findSubjectClosure(waiver())).toBe('The booking no longer exists')
  })
})

describe('a supplier confirmation', () => {
  it('still stands while the booking it is for is going ahead', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'not_required' }] })

    expect(await findSubjectClosure(supplierConfirmation())).toBeNull()
  })

  it('is withdrawn when the booking it is for was cancelled', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'cancelled', waiver_status: 'not_required' }] })

    expect(await findSubjectClosure(supplierConfirmation())).toBe('The booking was cancelled')
  })

  it('is withdrawn when the booking it is for no longer exists', async () => {
    useDb({ private_bookings: [] })

    expect(await findSubjectClosure(supplierConfirmation())).toBe('The booking no longer exists')
  })

  it('is not withdrawn because the food agreement on that booking was signed', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'signed' }] })

    expect(await findSubjectClosure(supplierConfirmation())).toBeNull()
  })

  it('is not withdrawn because that booking has no outside food', async () => {
    useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', outside_food: false, waiver_status: 'not_required' }] })

    expect(await findSubjectClosure(supplierConfirmation())).toBeNull()
  })

  it('finds its booking in the context, not by the supplier id', async () => {
    useDb({
      private_bookings: [
        { id: VENDOR, status: 'cancelled', waiver_status: 'not_required' },
        { id: BOOKING, status: 'confirmed', waiver_status: 'not_required' },
      ],
    })

    expect(await findSubjectClosure(supplierConfirmation())).toBeNull()
  })

  it('still stands, without reading anything, when it names no booking', async () => {
    forbidReads()

    expect(await findSubjectClosure(supplierConfirmation({}))).toBeNull()
    expect(await findSubjectClosure(supplierConfirmation({ private_booking_id: null }))).toBeNull()
    expect(await findSubjectClosure(supplierConfirmation({ private_booking_id: 42 }))).toBeNull()
  })
})

describe('a quote sent for acceptance', () => {
  // 13 October 2026, midday in London.
  const MIDDAY = '2026-10-13T11:00:00Z'

  it('still stands while the quote is open and in date', async () => {
    setNow(MIDDAY)
    for (const status of ['sent', 'draft']) {
      useDb({ quotes: [{ id: QUOTE, status, valid_until: '2026-11-01' }] })
      expect(await findSubjectClosure(quoteAcceptance()), status).toBeNull()
    }
  })

  it('is withdrawn when staff have already marked the quote accepted', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [{ id: QUOTE, status: 'accepted', valid_until: '2026-11-01' }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBe('Staff marked the quote as accepted')
  })

  it('is withdrawn when the quote was rejected', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [{ id: QUOTE, status: 'rejected', valid_until: '2026-11-01' }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote was marked as rejected')
  })

  it('is withdrawn when the quote is marked expired', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [{ id: QUOTE, status: 'expired', valid_until: '2026-11-01' }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote has expired')
  })

  it('is withdrawn when the quote no longer exists', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [] })

    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote no longer exists')
  })

  it('is withdrawn the day after the valid-until date', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-12' }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote has passed its valid-until date')
  })

  it('still stands on the valid-until date itself, and before it', async () => {
    setNow(MIDDAY)
    for (const validUntil of ['2026-10-13', '2026-10-14']) {
      useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: validUntil }] })
      expect(await findSubjectClosure(quoteAcceptance()), validUntil).toBeNull()
    }
  })

  it('still stands until the very end of the valid-until date in London', async () => {
    // 23:59 BST on 13 October.
    setNow('2026-10-13T22:59:00Z')
    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-13' }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBeNull()
  })

  it('counts the day by the London calendar in summer time, when UTC is still on the day before', async () => {
    // 00:30 BST on 25 October in London, still 24 October in UTC.
    setNow('2026-10-24T23:30:00Z')

    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-24' }] })
    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote has passed its valid-until date')

    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-25' }] })
    expect(await findSubjectClosure(quoteAcceptance())).toBeNull()
  })

  it('counts the day by the London calendar once the clocks have gone back', async () => {
    // 23:30 GMT on 25 October: the same day in London and in UTC.
    setNow('2026-10-25T23:30:00Z')

    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-25' }] })
    expect(await findSubjectClosure(quoteAcceptance())).toBeNull()

    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-24' }] })
    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote has passed its valid-until date')
  })

  it('reads only the date from a valid-until value that carries a time', async () => {
    setNow(MIDDAY)

    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-13T00:00:00+00:00' }] })
    expect(await findSubjectClosure(quoteAcceptance())).toBeNull()

    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: '2026-10-12T23:59:59+00:00' }] })
    expect(await findSubjectClosure(quoteAcceptance())).toBe('The quote has passed its valid-until date')
  })

  it('still stands when the quote has no valid-until date', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [{ id: QUOTE, status: 'sent', valid_until: null }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBeNull()
  })

  it('gives the status as the reason when the quote is both settled and out of date', async () => {
    setNow(MIDDAY)
    useDb({ quotes: [{ id: QUOTE, status: 'accepted', valid_until: '2026-01-01' }] })

    expect(await findSubjectClosure(quoteAcceptance())).toBe('Staff marked the quote as accepted')
  })
})

describe('a document for a member of staff', () => {
  it('still stands while they work here', async () => {
    for (const status of ['Active', 'Onboarding', 'Started Separation']) {
      useDb({ employees: [{ employee_id: EMPLOYEE, status }] })
      expect(await findSubjectClosure(workerAgreement()), status).toBeNull()
    }
  })

  it('is withdrawn once they have left', async () => {
    useDb({ employees: [{ employee_id: EMPLOYEE, status: 'Former' }] })

    expect(await findSubjectClosure(workerAgreement())).toBe('They no longer work here')
  })

  it('is withdrawn when the employee record no longer exists', async () => {
    useDb({ employees: [] })

    expect(await findSubjectClosure(workerAgreement())).toBe('The employee record no longer exists')
  })

  it('applies to every kind of staff document, not only the worker agreement', async () => {
    useDb({ employees: [{ employee_id: EMPLOYEE, status: 'Former' }] })

    for (const kind of ['terms_variation', 'policy_acknowledgement', 'deduction_consent', 'working_time_opt_out', 'guardian_consent'] as const) {
      expect(await findSubjectClosure(workerAgreement({ kind })), kind).toBe('They no longer work here')
    }
  })

  it('looks the employee up by their employee id', async () => {
    useDb({
      employees: [
        { employee_id: 'someone-else', id: EMPLOYEE, status: 'Former' },
        { employee_id: EMPLOYEE, id: 'row-2', status: 'Active' },
      ],
    })

    expect(await findSubjectClosure(workerAgreement())).toBeNull()
  })
})

describe('a job offer', () => {
  it('still stands while the application is at the offer stage', async () => {
    useDb({ recruitment_applications: [{ id: APPLICATION, status: 'offered' }] })

    expect(await findSubjectClosure(jobOffer())).toBeNull()
  })

  it('is withdrawn when the candidate has already been hired', async () => {
    useDb({ recruitment_applications: [{ id: APPLICATION, status: 'hired' }] })

    expect(await findSubjectClosure(jobOffer())).toBe('The candidate has been hired')
  })

  it('is withdrawn when the application has moved to any other stage', async () => {
    for (const status of ['rejected', 'withdrawn', 'on_hold', 'talent_pool', 'trial_completed', 'interviewed', 'new']) {
      useDb({ recruitment_applications: [{ id: APPLICATION, status }] })
      expect(await findSubjectClosure(jobOffer()), status).toBe('The application is no longer at the offer stage')
    }
  })

  it('is withdrawn when the application no longer exists', async () => {
    useDb({ recruitment_applications: [] })

    expect(await findSubjectClosure(jobOffer())).toBe('The application no longer exists')
  })
})

describe('a document for an invoice client', () => {
  it('always stands, and reads nothing to decide', async () => {
    forbidReads()

    expect(
      await findSubjectClosure({ kind: 'client_agreement', subject_type: 'invoice_vendor', subject_id: INVOICE_VENDOR, context: {} })
    ).toBeNull()
  })
})

describe('when the record cannot be read', () => {
  it('fails for a booking, and does not guess that it is open or closed', async () => {
    for (const status of ['confirmed', 'cancelled']) {
      const db = useDb({ private_bookings: [{ id: BOOKING, status, waiver_status: 'signed' }] })
      // With no count given, every read of the table fails.
      db.failNext({ table: 'private_bookings', operation: 'select', message: 'connection reset' })

      await expect(findSubjectClosure(contract()), status).rejects.toThrow('Could not read the booking: connection reset')
      await expect(findSubjectClosure(waiver()), status).rejects.toThrow('Could not read the booking: connection reset')
    }
  })

  it('fails for a supplier confirmation whose booking cannot be read', async () => {
    const db = useDb({ private_bookings: [{ id: BOOKING, status: 'confirmed', waiver_status: 'not_required' }] })
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'timeout' })

    await expect(findSubjectClosure(supplierConfirmation())).rejects.toThrow('Could not read the booking: timeout')
  })

  it('fails for a quote', async () => {
    for (const status of ['sent', 'accepted']) {
      const db = useDb({ quotes: [{ id: QUOTE, status, valid_until: '2099-01-01' }] })
      db.failNext({ table: 'quotes', operation: 'select', message: 'permission denied' })
      await expect(findSubjectClosure(quoteAcceptance()), status).rejects.toThrow('Could not read the quote: permission denied')
    }
  })

  it('fails for a member of staff', async () => {
    for (const status of ['Active', 'Former']) {
      const db = useDb({ employees: [{ employee_id: EMPLOYEE, status }] })
      db.failNext({ table: 'employees', operation: 'select', message: 'timeout' })
      await expect(findSubjectClosure(workerAgreement()), status).rejects.toThrow('Could not read the employee: timeout')
    }
  })

  it('fails for a job offer', async () => {
    for (const status of ['offered', 'rejected']) {
      const db = useDb({ recruitment_applications: [{ id: APPLICATION, status }] })
      db.failNext({ table: 'recruitment_applications', operation: 'select', message: 'timeout' })
      await expect(findSubjectClosure(jobOffer()), status).rejects.toThrow('Could not read the application: timeout')
    }
  })

  it('reads properly again once the database is back', async () => {
    const db = useDb({ private_bookings: [{ id: BOOKING, status: 'cancelled', waiver_status: 'not_required' }] })
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'connection reset', times: 1 })

    await expect(findSubjectClosure(contract())).rejects.toThrow('Could not read the booking')
    expect(await findSubjectClosure(contract())).toBe('The booking was cancelled')
  })
})
