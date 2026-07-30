// The canonical idempotency fingerprint for table-booking creation (review
// F18/T4): a retry with the same intent must replay, a retry with a changed
// accessibility request must NOT, and requests from an old website that omits
// requires_accessible_table must keep producing the pre-accessibility hash
// (review F37) so in-flight claims survive the deploy.

import { describe, it, expect } from 'vitest'
import { computeIdempotencyRequestHash } from '@/lib/api/idempotency'
import { consentHashPayload } from '@/lib/consent/validation'
import {
  computeTableBookingRequestHash,
  type TableBookingIdempotencyFields,
} from './booking-idempotency'

function makeFields(
  overrides: Partial<TableBookingIdempotencyFields> = {}
): TableBookingIdempotencyFields {
  return {
    phone: '+447700900123',
    first_name: 'Jo',
    last_name: 'Bloggs',
    email: 'jo@example.com',
    date: '2026-08-07',
    time: '19:00:00',
    party_size: 4,
    purpose: 'food',
    notes: null,
    dietary_requirements: ['vegetarian'],
    allergies: null,
    high_chair_count: 1,
    outside_seating: false,
    ...overrides,
  }
}

describe('computeTableBookingRequestHash', () => {
  it('produces the same hash for an identical retry, so it dedupes', () => {
    expect(computeTableBookingRequestHash(makeFields({ requires_accessible_table: true })))
      .toBe(computeTableBookingRequestHash(makeFields({ requires_accessible_table: true })))
    expect(computeTableBookingRequestHash(makeFields()))
      .toBe(computeTableBookingRequestHash(makeFields()))
  })

  it('produces a different hash when the accessibility request changes, so it does not dedupe', () => {
    const withoutStepFree = computeTableBookingRequestHash(makeFields())
    const withStepFree = computeTableBookingRequestHash(
      makeFields({ requires_accessible_table: true })
    )

    expect(withStepFree).not.toBe(withoutStepFree)
  })

  it('treats an omitted field and an explicit false as the same intent (old-website compatibility, F37)', () => {
    const omitted = computeTableBookingRequestHash(makeFields())
    const explicitFalse = computeTableBookingRequestHash(
      makeFields({ requires_accessible_table: false })
    )

    expect(explicitFalse).toBe(omitted)
  })

  it('matches the pre-accessibility hash byte for byte when the field is absent, so claims persisted before the deploy still replay', () => {
    const fields = makeFields()

    // The exact hash payload this route built before requires_accessible_table
    // was added to the fingerprint. If this assertion breaks, an AMS deploy
    // turns every in-flight old-website retry into a 409 conflict.
    const legacyHash = computeIdempotencyRequestHash({
      phone: fields.phone,
      first_name: fields.first_name || null,
      last_name: fields.last_name || null,
      email: fields.email || null,
      date: fields.date,
      time: fields.time,
      party_size: fields.party_size,
      purpose: fields.purpose,
      notes: fields.notes || null,
      dietary_requirements: fields.dietary_requirements ?? null,
      allergies: fields.allergies ?? null,
      high_chair_count: fields.high_chair_count ?? null,
      outside_seating: fields.outside_seating ?? null,
      communication_consent: consentHashPayload(undefined),
    })

    expect(computeTableBookingRequestHash(fields)).toBe(legacyHash)
  })

  it('still varies the hash on every other booking-changing field', () => {
    const base = computeTableBookingRequestHash(makeFields())

    expect(computeTableBookingRequestHash(makeFields({ party_size: 5 }))).not.toBe(base)
    expect(computeTableBookingRequestHash(makeFields({ time: '19:30:00' }))).not.toBe(base)
    expect(computeTableBookingRequestHash(makeFields({ high_chair_count: 2 }))).not.toBe(base)
    expect(computeTableBookingRequestHash(makeFields({ outside_seating: true }))).not.toBe(base)
    expect(computeTableBookingRequestHash(makeFields({ purpose: 'drinks' }))).not.toBe(base)
  })
})
