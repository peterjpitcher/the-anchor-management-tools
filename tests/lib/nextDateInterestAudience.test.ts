import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { loadCategoryInterestAudience } from '@/lib/events/next-date-interest'

/**
 * Who the event invite adds from the "tell me when the next one is on" sign-ups. The sign-up row
 * in the consent history outlives a later opt-out, so the customer's current state decides.
 */

const QUIZ = 'cat-quiz'
const EVENT = 'event-quiz-december'

function signUp(customerId: string, extra: Record<string, unknown> = {}) {
  return {
    customer_id: customerId,
    channel: 'sms',
    purpose: 'marketing',
    status: 'opted_in',
    source: 'public_event_waitlist',
    related_entity_type: 'event_waitlist',
    related_entity_id: QUIZ,
    captured_at: '2026-11-14T10:00:00Z',
    ...extra,
  }
}

function customer(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    first_name: id,
    last_name: '',
    mobile_e164: `+4479111${String(id.length).padStart(5, '0')}`,
    sms_opt_in: true,
    sms_status: 'active',
    marketing_sms_opt_in: true,
    marketing_sms_opted_out_at: null,
    ...extra,
  }
}

let db: FakeDb
const load = (exclude: string[] = []) =>
  loadCategoryInterestAudience(db.client as never, { categoryId: QUIZ, eventId: EVENT, excludeCustomerIds: exclude })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadCategoryInterestAudience', () => {
  it('returns a customer who signed up for this kind of night, once, in sign-up order', async () => {
    db = createFakeDb({
      customer_consents: [signUp('bo', { captured_at: '2026-11-15T10:00:00Z' }), signUp('al'), signUp('al', { captured_at: '2026-11-16T10:00:00Z' })],
      customers: [customer('al'), customer('bo')],
      bookings: [],
      sms_promo_context: [],
    })

    expect(await load()).toEqual([
      { customer_id: 'al', first_name: 'al', last_name: '', phone_number: '+447911100002' },
      { customer_id: 'bo', first_name: 'bo', last_name: '', phone_number: '+447911100002' },
    ])
  })

  it.each([
    ['signed up for another kind of night', signUp('al', { related_entity_id: 'cat-bingo' }), customer('al')],
    ['signed up by email only', signUp('al', { channel: 'email' }), customer('al')],
    ['is an ordinary booking consent, not a sign-up', signUp('al', { source: 'public_event_booking', related_entity_type: 'event_booking' }), customer('al')],
    ['opted out of marketing texts afterwards', signUp('al'), customer('al', { marketing_sms_opt_in: false, marketing_sms_opted_out_at: '2026-11-20T10:00:00Z' })],
    ['sent STOP afterwards', signUp('al'), customer('al', { sms_opt_in: false, sms_status: 'opted_out', marketing_sms_opt_in: false })],
    ['has a number texts cannot reach', signUp('al'), customer('al', { sms_status: 'sms_deactivated' })],
    ['has no mobile on record', signUp('al'), customer('al', { mobile_e164: null })],
  ])('leaves out a customer who %s', async (_label, consent, row) => {
    db = createFakeDb({ customer_consents: [consent], customers: [row], bookings: [], sms_promo_context: [] })

    expect(await load()).toEqual([])
  })

  it('leaves out a customer already booked for this event, already texted about it, or already in the audience', async () => {
    db = createFakeDb({
      customer_consents: [signUp('booked'), signUp('texted'), signUp('regular'), signUp('held'), signUp('new')],
      customers: [customer('booked'), customer('texted'), customer('regular'), customer('held'), customer('new')],
      bookings: [
        { customer_id: 'booked', event_id: EVENT, status: 'confirmed', is_reminder_only: false },
        { customer_id: 'held', event_id: EVENT, status: 'pending_payment', is_reminder_only: false },
        // A cancelled booking, a reminder-only row and a booking for another event do not count.
        { customer_id: 'new', event_id: EVENT, status: 'cancelled', is_reminder_only: false },
        { customer_id: 'new', event_id: EVENT, status: 'confirmed', is_reminder_only: true },
        { customer_id: 'new', event_id: 'another-event', status: 'confirmed', is_reminder_only: false },
      ],
      sms_promo_context: [
        { customer_id: 'texted', event_id: EVENT },
        { customer_id: 'new', event_id: 'another-event' },
      ],
    })

    expect((await load(['regular']))?.map((row) => row.customer_id)).toEqual(['new'])
  })

  it.each(['customer_consents', 'customers', 'bookings', 'sms_promo_context'])(
    'returns null, not an empty or partial list, when %s cannot be read',
    async (table) => {
      db = createFakeDb({ customer_consents: [signUp('al')], customers: [customer('al')], bookings: [], sms_promo_context: [] })
      db.failNext({ table, operation: 'select', message: 'database down' })

      expect(await load()).toBeNull()
    },
  )
})
