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

// Seasonal pre-orders (Christmas 2026). What each seat is eating changes what is
// booked, so it has to vary the fingerprint: a booker who corrects a dish and
// resubmits under the same key must get a conflict, not a silent replay of the
// response that recorded the dish they just changed.
describe('computeTableBookingRequestHash with a pre-order', () => {
  const seat = (main: string) => ({ main_menu_item_id: main })

  it('replays an identical pre-order', () => {
    const fields = makeFields({ preorder: [seat('aaa'), seat('bbb')] })
    expect(computeTableBookingRequestHash(fields)).toBe(computeTableBookingRequestHash(fields))
  })

  it('does not replay when a dish changes', () => {
    const before = computeTableBookingRequestHash(makeFields({ preorder: [seat('aaa')] }))
    const after = computeTableBookingRequestHash(makeFields({ preorder: [seat('bbb')] }))
    expect(after).not.toBe(before)
  })

  it('does not replay when the same dishes move to different seats', () => {
    // Position is the seat, so this is a genuinely different order: the guest
    // who needed the vegan main is now someone else.
    const original = computeTableBookingRequestHash(makeFields({ preorder: [seat('aaa'), seat('bbb')] }))
    const swapped = computeTableBookingRequestHash(makeFields({ preorder: [seat('bbb'), seat('aaa')] }))
    expect(swapped).not.toBe(original)
  })

  it('does not replay when a seat is added or a course is dropped', () => {
    const base = computeTableBookingRequestHash(makeFields({ preorder: [seat('aaa')] }))

    expect(computeTableBookingRequestHash(makeFields({ preorder: [seat('aaa'), seat('bbb')] }))).not.toBe(base)
    expect(
      computeTableBookingRequestHash(
        makeFields({ preorder: [{ main_menu_item_id: 'aaa', dessert_menu_item_id: 'ccc' }] })
      )
    ).not.toBe(base)
  })

  it('treats add-on ticking order as the same order', () => {
    const oneWay = computeTableBookingRequestHash(
      makeFields({ preorder: [{ ...seat('aaa'), addon_menu_item_ids: ['x', 'y'] }] })
    )
    const otherWay = computeTableBookingRequestHash(
      makeFields({ preorder: [{ ...seat('aaa'), addon_menu_item_ids: ['y', 'x'] }] })
    )
    expect(otherWay).toBe(oneWay)
  })

  it('does not replay when an add-on is added or removed', () => {
    const withAddon = computeTableBookingRequestHash(
      makeFields({ preorder: [{ ...seat('aaa'), addon_menu_item_ids: ['x'] }] })
    )
    const without = computeTableBookingRequestHash(makeFields({ preorder: [seat('aaa')] }))
    expect(withAddon).not.toBe(without)
  })

  it('hashes exactly as before for a client that sends no pre-order', () => {
    // The website deployed today sends nothing, and claims already in flight at
    // deploy time must replay rather than 409.
    const base = makeFields()
    expect(computeTableBookingRequestHash({ ...base, preorder: undefined })).toBe(
      computeTableBookingRequestHash(base)
    )
    expect(computeTableBookingRequestHash({ ...base, preorder: null })).toBe(
      computeTableBookingRequestHash(base)
    )
    expect(computeTableBookingRequestHash({ ...base, preorder: [] })).toBe(
      computeTableBookingRequestHash(base)
    )
  })
})

describe('fixture booking intent', () => {
  const fixture_id = '10000000-0000-4000-8000-000000000001'
  const notes = `Nations Championship: Italy v South Africa [${fixture_id}]\nNear the screen`
  const original = makeFields({ fixture_id, notes })
  it('keeps the same hash after a trusted fixture label refresh', () => {
    expect(computeTableBookingRequestHash({ ...original, notes: `Nations Championship: Updated teams [${fixture_id}]\nNear the screen` })).toBe(computeTableBookingRequestHash(original))
    expect(computeTableBookingRequestHash({ ...original, notes: `Nations Championship: [${fixture_id}]\nNear the screen` })).toBe(computeTableBookingRequestHash(original))
  })
  it.each([{ date: '2026-11-08' }, { time: '13:00:00' }, { party_size: 5 }, { phone: '+447700900222' }, { first_name: 'Different' }, { notes: notes + ' please' }])('keeps changed customer intent conflicting: %p', changes => {
    expect(computeTableBookingRequestHash({ ...original, ...changes })).not.toBe(computeTableBookingRequestHash(original))
  })
  it('does not normalise fixture labels without an explicit ID', () => {
    expect(computeTableBookingRequestHash(makeFields({ notes }))).not.toBe(computeTableBookingRequestHash(makeFields({ notes: notes.replace('Italy', 'France') })))
  })
})
