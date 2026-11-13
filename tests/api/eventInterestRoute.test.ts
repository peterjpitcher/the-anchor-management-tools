import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * "Tell me when the next one is on" (growth review of 13 November 2026): a visitor on an event
 * type's page with no date on sale leaves a first name and a mobile or an email. The sign-up is a
 * marketing consent tied to the event category. Nothing is sent, a repeat writes nothing, an
 * opt-out is never reversed, and anything that cannot be kept is an error the page can show.
 */

const { limited, sendSMS, sendEmail } = vi.hoisted(() => ({
  limited: vi.fn(async (_request: unknown, _options: { prefix: string; subject?: string }) => null as Response | null),
  sendSMS: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    async (handler: (request: Request, apiKey: { id: string }) => Promise<Response>, permissions: string[], request: Request) => {
      if (!permissions.includes('create:bookings')) throw new Error('wrong scope')
      return handler(request, { id: 'website-key' })
    },
  ),
  createApiResponse: (payload: unknown, status = 200) => Response.json(payload, { status }),
  createErrorResponse: (message: string, code: string, status = 400, details?: unknown) =>
    Response.json({ success: false, error: { message, code, details } }, { status }),
}))
vi.mock('@/lib/api/booking-rate-limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/booking-rate-limits')>()),
  limitBookingAttempt: limited,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// The real one reads the phone-matching helpers and the opt-out holding queue; here it finds a
// customer by number or makes one, the way it does for a new guest.
vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(async (client: FakeDb['client'], phone: string, fallback: { firstName?: string; email?: string | null }) => {
    const { data: found, error } = await client.from('customers').select('id').eq('mobile_e164', phone).limit(1)
    if (error) return { customerId: null, standardizedPhone: phone, resolutionError: 'lookup_failed' }
    const existing = ((found ?? []) as Array<{ id: string }>)[0]
    if (existing) return { customerId: existing.id, standardizedPhone: phone }
    const { data: created } = await client
      .from('customers')
      .insert({
        first_name: fallback.firstName ?? 'Unknown',
        last_name: '',
        mobile_e164: phone,
        mobile_number: phone,
        email: fallback.email ?? null,
        sms_opt_in: true,
        sms_status: 'active',
        marketing_sms_opt_in: false,
        marketing_sms_opted_out_at: null,
        marketing_email_opt_in: false,
        marketing_email_opted_out_at: null,
      })
      .select()
      .single()
    return { customerId: (created as { id: string }).id, standardizedPhone: phone }
  }),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { POST } from '@/app/api/event-interest/route'

const QUIZ = { id: '11111111-1111-4111-8111-111111111111', slug: 'quiz-night', name: 'Quiz Night', is_active: true }
const RETIRED = { id: '22222222-2222-4222-8222-222222222222', slug: 'live-music', name: 'Live Music', is_active: false }

let db: FakeDb
let consentFails = false

function post(body: unknown): NextRequest {
  return new NextRequest('https://management.example/api/event-interest', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
  })
}

function seed(customers: Array<Record<string, unknown>> = []) {
  db = createFakeDb({ event_categories: [QUIZ, RETIRED], customers, customer_consents: [] })
  // What record_customer_consent does: one history row, and the customer's marketing flag.
  db.onRpc(async (name, args) => {
    if (name !== 'record_customer_consent') return { data: null, error: { message: `unexpected rpc ${name}` } }
    if (consentFails) return { data: null, error: { message: 'database down' } }
    await db.client.from('customer_consents').insert({
      customer_id: args.p_customer_id,
      channel: args.p_channel,
      purpose: args.p_purpose,
      status: args.p_status,
      legal_basis: args.p_legal_basis,
      source: args.p_source,
      capture_method: args.p_capture_method,
      consent_text: args.p_consent_text,
      consent_text_version: args.p_consent_text_version,
      related_entity_type: args.p_related_entity_type,
      related_entity_id: args.p_related_entity_id,
      metadata: args.p_metadata,
    })
    const flag = args.p_channel === 'sms' ? 'marketing_sms_opt_in' : 'marketing_email_opt_in'
    await db.client.from('customers').update({ [flag]: true }).eq('id', args.p_customer_id)
    return { data: 'consent-id', error: null }
  })
  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db.client)
}

const mobileSignUp = { event_category_slug: 'quiz-night', first_name: 'Sam', phone: '07911 123456', marketing_sms_opt_in: true }
const emailSignUp = { event_category_id: QUIZ.id, first_name: 'Alex', email: 'Alex@Example.com', marketing_email_opt_in: true }

beforeEach(() => {
  vi.clearAllMocks()
  consentFails = false
  limited.mockResolvedValue(null)
  seed()
})

describe('POST /api/event-interest', () => {
  it('registers a mobile sign-up as a marketing consent for the event category, and sends nothing', async () => {
    const response = await POST(post(mobileSignUp))

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        registered: true,
        already_registered: false,
        channels: ['sms'],
        event_category: { id: QUIZ.id, slug: 'quiz-night', name: 'Quiz Night' },
      },
    })
    expect(db.rows('customers')).toHaveLength(1)
    expect(db.rows('customers')[0]).toMatchObject({ first_name: 'Sam', mobile_e164: '+447911123456', marketing_sms_opt_in: true })
    expect(db.rows('customer_consents')).toHaveLength(1)
    expect(db.rows('customer_consents')[0]).toMatchObject({
      channel: 'sms',
      purpose: 'marketing',
      status: 'opted_in',
      legal_basis: 'consent',
      capture_method: 'checkbox',
      source: 'public_event_waitlist',
      related_entity_type: 'event_waitlist',
      related_entity_id: QUIZ.id,
      consent_text: 'Text me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes.',
      metadata: { kind: 'next_date_interest', event_category_id: QUIZ.id, event_category_slug: 'quiz-night' },
    })
    expect(sendSMS).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('writes nothing more for a repeat sign-up and says it was already registered', async () => {
    await POST(post(mobileSignUp))
    const again = await POST(post({ ...mobileSignUp, first_name: 'Sammy' }))

    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ success: true, data: { registered: true, already_registered: true, channels: ['sms'] } })
    expect(db.rows('customers')).toHaveLength(1)
    expect(db.rows('customer_consents')).toHaveLength(1)
  })

  it('registers the same customer separately for another kind of event', async () => {
    db.rows('event_categories').push({ id: '33333333-3333-4333-8333-333333333333', slug: 'cash-bingo', name: 'Cash Bingo', is_active: true })
    await POST(post(mobileSignUp))
    const other = await POST(post({ ...mobileSignUp, event_category_slug: 'cash-bingo' }))

    expect(other.status).toBe(201)
    expect(db.rows('customer_consents').map((row) => row.related_entity_id)).toEqual([QUIZ.id, '33333333-3333-4333-8333-333333333333'])
  })

  it('registers an email-only sign-up, creating a customer with no phone', async () => {
    const response = await POST(post(emailSignUp))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: { channels: ['email'], already_registered: false } })
    expect(db.rows('customers')[0]).toMatchObject({ first_name: 'Alex', email: 'alex@example.com', marketing_email_opt_in: true, sms_opt_in: false })
    expect(db.rows('customers')[0].mobile_e164 ?? null).toBeNull()
    expect(db.rows('customer_consents')[0]).toMatchObject({
      channel: 'email',
      source: 'public_event_waitlist',
      related_entity_id: QUIZ.id,
      consent_text: 'Email me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes.',
    })

    const again = await POST(post(emailSignUp))
    expect(again.status).toBe(200)
    expect(db.rows('customers')).toHaveLength(1)
    expect(db.rows('customer_consents')).toHaveLength(1)
  })

  it('registers both channels when a new visitor gives and ticks both', async () => {
    const response = await POST(post({ ...mobileSignUp, email: 'sam@example.com', marketing_email_opt_in: true }))

    expect(await response.json()).toMatchObject({ data: { channels: ['sms', 'email'] } })
    expect(db.rows('customer_consents').map((row) => row.channel)).toEqual(['sms', 'email'])
  })

  it('does not put a typed email on another customer: a matched mobile is registered for texts only', async () => {
    seed([{ id: 'regular', first_name: 'Sam', mobile_e164: '+447911123456', email: 'old@example.com', sms_opt_in: true, sms_status: 'active', marketing_sms_opt_in: false, marketing_sms_opted_out_at: null, marketing_email_opt_in: false, marketing_email_opted_out_at: null }])

    const response = await POST(post({ ...mobileSignUp, email: 'new@example.com', marketing_email_opt_in: true }))

    expect(await response.json()).toMatchObject({ data: { channels: ['sms'] } })
    expect(db.rows('customers')[0].email).toBe('old@example.com')
    expect(db.rows('customer_consents').map((row) => row.channel)).toEqual(['sms'])
  })

  it.each([
    ['marketing texts opted out', { marketing_sms_opted_out_at: '2026-09-01T10:00:00Z' }],
    ['texts stopped altogether', { sms_opt_in: false, sms_status: 'opted_out' }],
    ['a number texts cannot reach', { sms_status: 'sms_deactivated' }],
  ])('never opts back in a customer with %s, and says so', async (_label, state) => {
    seed([{ id: 'regular', first_name: 'Sam', mobile_e164: '+447911123456', email: null, sms_opt_in: true, sms_status: 'active', marketing_sms_opt_in: false, marketing_sms_opted_out_at: null, marketing_email_opt_in: false, marketing_email_opted_out_at: null, ...state }])

    const response = await POST(post(mobileSignUp))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({ success: false, error: { code: 'CONTACT_OPTED_OUT' } })
    expect(body.error.message).toContain('01753 682707')
    expect(db.rows('customer_consents')).toHaveLength(0)
    expect(db.rows('customers')[0].marketing_sms_opt_in).toBe(false)
  })

  it('never opts back in an unsubscribed email address', async () => {
    seed([{ id: 'reader', first_name: 'Alex', email: 'alex@example.com', marketing_email_opt_in: false, marketing_email_opted_out_at: '2026-09-01T10:00:00Z', sms_opt_in: false, sms_status: 'active', marketing_sms_opt_in: false, marketing_sms_opted_out_at: null }])

    const response = await POST(post(emailSignUp))

    expect(response.status).toBe(409)
    expect(db.rows('customer_consents')).toHaveLength(0)
  })

  it.each([
    ['no contact at all', { event_category_slug: 'quiz-night', first_name: 'Sam' }, 'CONTACT_REQUIRED'],
    ['a mobile without its tick', { ...mobileSignUp, marketing_sms_opt_in: false }, 'CONSENT_REQUIRED'],
    ['an email without its tick', { event_category_slug: 'quiz-night', first_name: 'Alex', email: 'alex@example.com' }, 'CONSENT_REQUIRED'],
    ['a mobile ticked but an email given unticked', { ...mobileSignUp, email: 'sam@example.com' }, 'CONSENT_REQUIRED'],
    ['a number that is not a phone number', { ...mobileSignUp, phone: 'not a number' }, 'INVALID_PHONE'],
    ['an address that is not an email', { ...emailSignUp, email: 'alex-at-example' }, 'INVALID_EMAIL'],
    ['a landline and no email', { ...mobileSignUp, phone: '01753 682707' }, 'EMAIL_REQUIRED_FOR_NON_MOBILE'],
    ['no first name', { ...mobileSignUp, first_name: ' ' }, 'VALIDATION_ERROR'],
    ['no event category', { first_name: 'Sam', phone: '07911 123456', marketing_sms_opt_in: true }, 'VALIDATION_ERROR'],
    ['a field it does not know', { ...mobileSignUp, last_name: 'Guest' }, 'VALIDATION_ERROR'],
    ['free text in place of consent wording', { ...mobileSignUp, consent_text: 'Anything I like' }, 'VALIDATION_ERROR'],
  ])('refuses %s and keeps nothing', async (_label, body, code) => {
    const response = await POST(post(body))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ success: false, error: { code } })
    expect(db.rows('customers')).toHaveLength(0)
    expect(db.rows('customer_consents')).toHaveLength(0)
  })

  it('treats a landline with an email as an email sign-up', async () => {
    const response = await POST(post({ ...emailSignUp, phone: '01753 682707', marketing_sms_opt_in: true }))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ data: { channels: ['email'] } })
    expect(db.rows('customers')[0].mobile_e164 ?? null).toBeNull()
  })

  it.each([
    ['a category that does not exist', { ...mobileSignUp, event_category_slug: 'line-dancing' }],
    ['a category that is switched off', { ...mobileSignUp, event_category_slug: 'live-music' }],
    ['an id and a slug that disagree', { ...mobileSignUp, event_category_id: RETIRED.id }],
  ])('answers 404 for %s', async (_label, body) => {
    const response = await POST(post(body))

    expect(response.status).toBe(404)
    expect(db.rows('customer_consents')).toHaveLength(0)
  })

  it('refuses a body that is not JSON', async () => {
    expect((await POST(post('not json'))).status).toBe(400)
  })

  it('answers 429 past the hourly limit, counted on the contact given', async () => {
    limited.mockResolvedValueOnce(new Response(null, { status: 429 }))

    const response = await POST(post(mobileSignUp))

    expect(response.status).toBe(429)
    expect(limited.mock.calls[0][1]).toMatchObject({ prefix: 'event-interest-guest', subject: '+447911123456' })
    expect(db.rows('customer_consents')).toHaveLength(0)
  })

  describe('fails closed', () => {
    it('says so when the consent cannot be written, and a retry then succeeds', async () => {
      consentFails = true
      const failed = await POST(post(mobileSignUp))
      const body = await failed.json()

      expect(failed.status).toBe(503)
      expect(body).toMatchObject({ success: false, error: { code: 'DATABASE_ERROR' } })
      expect(body.error.message).toContain('01753 682707')
      expect(db.rows('customer_consents')).toHaveLength(0)

      consentFails = false
      const retried = await POST(post(mobileSignUp))
      expect(retried.status).toBe(201)
      expect(db.rows('customer_consents')).toHaveLength(1)
    })

    it('says so when the second channel cannot be written, and the retry finishes the job without a duplicate', async () => {
      const both = { ...mobileSignUp, email: 'sam@example.com', marketing_email_opt_in: true }
      const realRpc = db.client.rpc
      let calls = 0
      db.client.rpc = async (name, args) => {
        calls += 1
        return calls === 2 ? { data: null, error: { message: 'database down' } } : realRpc(name, args)
      }

      const failed = await POST(post(both))
      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({ success: false })

      const retried = await POST(post(both))
      expect(retried.status).toBe(201)
      expect(db.rows('customer_consents').map((row) => row.channel)).toEqual(['sms', 'email'])
    })

    it('says so when the customer cannot be found or made', async () => {
      db.failNext({ table: 'customers', operation: 'select', message: 'database down', times: 1 })

      const response = await POST(post(mobileSignUp))

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ success: false, error: { code: 'CUSTOMER_RESOLUTION_FAILED' } })
      expect(db.rows('customer_consents')).toHaveLength(0)
    })

    it('says so when an email-only customer cannot be created', async () => {
      db.failNext({ table: 'customers', operation: 'insert', message: 'database down', times: 1 })

      const response = await POST(post(emailSignUp))

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ success: false, error: { code: 'CUSTOMER_RESOLUTION_FAILED' } })
    })

    it('says so when the event category cannot be read', async () => {
      db.failNext({ table: 'event_categories', operation: 'select', message: 'database down', times: 1 })

      const response = await POST(post(mobileSignUp))

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ success: false, error: { code: 'DATABASE_ERROR' } })
      expect(db.rows('customers')).toHaveLength(0)
    })

    it('says so when earlier sign-ups cannot be read', async () => {
      await POST(post(mobileSignUp))
      db.failNext({ table: 'customer_consents', operation: 'select', message: 'database down', times: 1 })

      const response = await POST(post(mobileSignUp))

      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ success: false })
    })
  })
})
