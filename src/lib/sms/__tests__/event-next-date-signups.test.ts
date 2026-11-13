import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

/**
 * sendCrossPromoForEvent and the "tell me when the next one is on" sign-ups (growth review of 13
 * November 2026). A visitor who asked to hear about the next night of a kind has never been to
 * one, so the audience function does not know them. The week-ahead invite adds them, under the
 * same limits and exclusions as a regular, and never twice.
 *
 * The real dateUtils run here. Every instant is written in UTC with the London time beside it.
 */

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/services/event-marketing', () => ({ EventMarketingService: { generateSingleLink: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/sms/bulk', () => ({ getSmartFirstName: vi.fn((name: string | null | undefined) => name || 'there') }))

import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'
import { sendCrossPromoForEvent } from '../cross-promo'
import { argsOf, createRecordingSupabase, inValues, type RecordedQuery } from '../../../../tests/mocks/recordingSupabase'

const mockCreateAdminClient = vi.mocked(createAdminClient)
const mockSendSMS = vi.mocked(sendSMS)

// Tuesday 24 November 2026, 10:00 GMT: outside quiet hours, so a text goes at once.
const NOW = new Date('2026-11-24T10:00:00.000Z')

const QUIZ_NIGHT = {
  id: 'event-quiz',
  name: 'Tinsel and Trivia Quiz Night',
  date: '2026-12-01',
  time: '19:00:00',
  price: 0,
  payment_mode: 'free',
  category_id: 'cat-quiz',
}

type Customer = {
  id: string
  first_name: string
  mobile_e164: string | null
  email?: string | null
  marketing_sms_opt_in?: boolean
  marketing_sms_opted_out_at?: string | null
}

type World = {
  /** What get_cross_promo_audience returns: guests who have been before. */
  regulars?: string[]
  /** Customers who signed up to hear about the next quiz, in order. */
  signedUp?: string[]
  customers: Customer[]
  /** Customers already booked for the event. */
  booked?: string[]
  /** Promotional texts in the messages log, by customer. */
  promoTexts?: Record<string, string[]>
  signUpReadFails?: boolean
}

function buildWorld(world: World) {
  const contexts: Array<{ customer_id: string; event_id: string; created_at: string }> = []
  const eqValue = (query: RecordedQuery, column: string) => argsOf(query, 'eq').find(([name]) => name === column)?.[1]

  const supabase = createRecordingSupabase({
    rpc: (fn, args) => {
      if (fn === 'get_event_capacity_snapshot_v05') {
        return { data: [{ event_id: (args.p_event_ids as string[])[0], capacity: 60, seats_remaining: 50, is_full: false }], error: null }
      }
      if (fn === 'get_cross_promo_audience') {
        const promoted = new Set(contexts.filter((row) => row.event_id === args.p_event_id).map((row) => row.customer_id))
        const rows = (world.regulars ?? [])
          .filter((id) => !promoted.has(id))
          .map((id) => {
            const customer = world.customers.find((row) => row.id === id)!
            return {
              customer_id: id,
              first_name: customer.first_name,
              last_name: null,
              phone_number: customer.mobile_e164,
              last_event_category: 'Quiz Night',
              times_attended: 3,
              audience_type: 'category_match',
              last_event_name: 'Quiz Night',
            }
          })
        return { data: rows.slice(0, args.p_max_recipients as number), error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
    tables: {
      customer_consents: (query: RecordedQuery) => {
        if (world.signUpReadFails) return { data: null, error: { message: 'database down' } }
        // Only the sign-up read for this category gets an answer.
        if (eqValue(query, 'source') !== 'public_event_waitlist' || eqValue(query, 'related_entity_id') !== 'cat-quiz') {
          return { data: [], error: null }
        }
        return { data: (world.signedUp ?? []).map((id) => ({ customer_id: id })), error: null }
      },
      customers: (query: RecordedQuery) => {
        const ids = inValues(query, 'id') as string[]
        return {
          data: world.customers
            .filter((row) => ids.includes(row.id))
            .map((row) => ({
              last_name: '',
              email: null,
              email_status: null,
              email_deactivated_at: null,
              marketing_email_opt_in: false,
              marketing_email_opted_out_at: null,
              sms_opt_in: true,
              sms_status: 'active',
              marketing_sms_opt_in: true,
              marketing_sms_opted_out_at: null,
              ...row,
            })),
          error: null,
        }
      },
      bookings: (query: RecordedQuery) => {
        const ids = inValues(query, 'customer_id') as string[]
        return { data: (world.booked ?? []).filter((id) => ids.includes(id)).map((id) => ({ customer_id: id })), error: null }
      },
      sms_promo_context: (query: RecordedQuery) => {
        const insert = argsOf(query, 'insert')[0]?.[0] as Record<string, unknown> | undefined
        if (insert) {
          contexts.push({ customer_id: insert.customer_id as string, event_id: insert.event_id as string, created_at: new Date().toISOString() })
          return { error: null }
        }
        const ids = inValues(query, 'customer_id') as string[]
        const eventId = eqValue(query, 'event_id')
        return {
          data: contexts.filter((row) => ids.includes(row.customer_id) && (!eventId || row.event_id === eventId)),
          error: null,
        }
      },
      messages: (query: RecordedQuery) => {
        const ids = inValues(query, 'customer_id') as string[]
        return {
          data: Object.entries(world.promoTexts ?? {}).flatMap(([customerId, texts]) =>
            ids.includes(customerId) ? texts.map((at) => ({ customer_id: customerId, template_key: 'event_cross_promo_7d', created_at: at })) : [],
          ),
          error: null,
        }
      },
      table_bookings: () => ({ data: [], error: null }),
      marketing_do_not_contact: () => ({ data: [], error: null }),
      email_suppressions: () => ({ data: [], error: null }),
      events: () => ({ data: { start_datetime: '2026-12-01T19:00:00Z', date: '2026-12-01', time: '19:00:00' }, error: null }),
      event_categories: () => ({ data: { name: 'Quiz Night' }, error: null }),
      promo_sequence: () => ({ error: null }),
    },
  })

  mockCreateAdminClient.mockReturnValue(supabase.client as never)
  return { supabase, contexts }
}

const textedCustomers = () => mockSendSMS.mock.calls.map(([, , options]) => options?.customerId)

const REGULAR: Customer = { id: 'regular', first_name: 'Rae', mobile_e164: '+447911100001' }
const NEWCOMER: Customer = { id: 'newcomer', first_name: 'Nia', mobile_e164: '+447911100002' }

let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  mockSendSMS.mockImplementation(async () => ({ success: true, sid: 'SM1', messageId: 'msg-1' }) as never)
})

afterEach(() => {
  warnSpy.mockRestore()
  vi.useRealTimers()
})

describe('the week-ahead invite and next-date sign-ups', () => {
  it('texts a visitor who signed up for this kind of night although they have never been', async () => {
    buildWorld({ regulars: ['regular'], signedUp: ['newcomer'], customers: [REGULAR, NEWCOMER] })

    const result = await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })

    expect(result).toMatchObject({ sent: 2, errors: 0 })
    // The sign-up goes first: they asked.
    expect(textedCustomers()).toEqual(['newcomer', 'regular'])
    const [to, body, options] = mockSendSMS.mock.calls[0]
    expect(to).toBe('+447911100002')
    expect(body).toContain('Nia, Tinsel and Trivia Quiz Night is on Tue 1 Dec, 7pm.')
    expect(body).toContain('Reply NOEVENTS to stop event texts.')
    expect(options?.metadata).toMatchObject({ marketing: true, event_id: 'event-quiz', template_key: 'event_cross_promo_7d' })
  })

  it('texts the sign-up when nobody has been to this kind of night before', async () => {
    buildWorld({ regulars: [], signedUp: ['newcomer'], customers: [NEWCOMER] })

    expect(await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })).toMatchObject({ sent: 1 })
  })

  it('sends nothing on a second run: the first text is on record for the event', async () => {
    buildWorld({ regulars: ['regular'], signedUp: ['newcomer'], customers: [REGULAR, NEWCOMER] })

    await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })
    mockSendSMS.mockClear()
    const second = await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })

    expect(second).toMatchObject({ sent: 0 })
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('does not text a sign-up twice when they are also a regular', async () => {
    buildWorld({ regulars: ['regular'], signedUp: ['regular'], customers: [REGULAR] })

    await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })

    expect(textedCustomers()).toEqual(['regular'])
  })

  it('leaves out a sign-up who has since opted out, has booked, or had a promotional text in the last two days', async () => {
    buildWorld({
      regulars: [],
      signedUp: ['opted-out', 'booked', 'texted', 'newcomer'],
      customers: [
        { id: 'opted-out', first_name: 'Olu', mobile_e164: '+447911100003', marketing_sms_opt_in: false, marketing_sms_opted_out_at: '2026-11-20T10:00:00Z' },
        { id: 'booked', first_name: 'Bea', mobile_e164: '+447911100004' },
        { id: 'texted', first_name: 'Tom', mobile_e164: '+447911100005' },
        NEWCOMER,
      ],
      booked: ['booked'],
      // Monday 23 November, 10:00 GMT: a day ago, inside the two-day gap.
      promoTexts: { texted: ['2026-11-23T10:00:00.000Z'] },
    })

    await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })

    expect(textedCustomers()).toEqual(['newcomer'])
  })

  it('leaves a sign-up the guest campaigns can email to the email, when texts are for guests without one', async () => {
    buildWorld({
      regulars: [],
      signedUp: ['emailable', 'newcomer'],
      customers: [{ id: 'emailable', first_name: 'Eve', mobile_e164: '+447911100006', email: 'eve@example.com', marketing_email_opt_in: true } as Customer, NEWCOMER],
    })

    await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars_no_email' })

    expect(textedCustomers()).toEqual(['newcomer'])
  })

  it('keeps within the recipient limit for the event', async () => {
    buildWorld({ regulars: ['regular'], signedUp: ['newcomer'], customers: [REGULAR, NEWCOMER] })

    const result = await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars', maxRecipients: 1 })

    expect(result).toMatchObject({ sent: 1 })
    expect(textedCustomers()).toEqual(['newcomer'])
  })

  it('still invites the regulars when the sign-ups cannot be read', async () => {
    buildWorld({ regulars: ['regular'], signedUp: ['newcomer'], customers: [REGULAR, NEWCOMER], signUpReadFails: true })

    await sendCrossPromoForEvent(QUIZ_NIGHT, { mode: 'regulars' })

    expect(textedCustomers()).toEqual(['regular'])
  })

  it('leaves sign-ups out of the older 7-day intro, whose only text limit is inside the audience function', async () => {
    const { supabase } = buildWorld({ regulars: ['regular'], signedUp: ['newcomer'], customers: [REGULAR, NEWCOMER] })

    await sendCrossPromoForEvent(QUIZ_NIGHT)

    expect(textedCustomers()).toEqual(['regular'])
    expect(supabase.queries.some((query) => query.table === 'customer_consents')).toBe(false)
  })
})
