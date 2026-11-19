import { describe, it, expect, vi } from 'vitest'
import {
  EVENT_BOOKER_UPDATE_TEMPLATE_KEY,
  loadEventBookerAudience,
  personaliseBookerText,
  resolveBookerExclusion,
} from '@/lib/events/booker-texts'
import { PROMOTIONAL_SMS_TEMPLATE_KEYS } from '@/lib/sms/promo-template-keys'
import { resolveSmsSuspensionReason } from '@/lib/sms/suspension'
import { resolveNotificationRoute } from '@/lib/notifications/routing-matrix'

type Customer = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_e164: string | null
  mobile_number: string | null
  sms_opt_in: boolean | null
  sms_status: string | null
}

function customer(overrides: Partial<Customer> & { id: string }): Customer {
  return {
    first_name: 'Guest',
    last_name: null,
    mobile_e164: '+447700900001',
    mobile_number: '07700900001',
    sms_opt_in: true,
    sms_status: 'active',
    ...overrides,
  }
}

function mockDb(rows: unknown[], error: { message: string } | null = null) {
  const calls: { in?: [string, string[]] } = {}
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn((column: string, values: string[]) => {
      calls.in = [column, values]
      return builder
    }),
    or: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve({ data: error ? null : rows, error })),
  }
  const db = { from: vi.fn(() => builder) }
  return { db: db as never, calls }
}

describe('resolveBookerExclusion', () => {
  it('lets anyone who accepts texts through, marketing consent or not', () => {
    expect(resolveBookerExclusion(customer({ id: 'c1' }))).toBeNull()
  })

  it('never texts someone who has opted out', () => {
    expect(resolveBookerExclusion(customer({ id: 'c1', sms_opt_in: false }))).toBe('opted_out')
    expect(resolveBookerExclusion(customer({ id: 'c1', sms_status: 'opted_out' }))).toBe('opted_out')
  })

  it('skips a number that has stopped receiving texts', () => {
    expect(resolveBookerExclusion(customer({ id: 'c1', sms_status: 'sms_deactivated' }))).toBe('number_not_textable')
  })

  it('skips a booker with no mobile', () => {
    expect(resolveBookerExclusion(customer({ id: 'c1', mobile_e164: null, mobile_number: ' ' }))).toBe('no_mobile')
  })
})

describe('loadEventBookerAudience', () => {
  it('texts each customer once, adds up their seats and lists who is left out', async () => {
    const { db } = mockDb([
      { id: 'b1', customer_id: 'c1', seats: 2, status: 'confirmed', customer: customer({ id: 'c1', first_name: 'Helen', last_name: 'B' }) },
      { id: 'b2', customer_id: 'c1', seats: 1, status: 'confirmed', customer: customer({ id: 'c1', first_name: 'Helen', last_name: 'B' }) },
      { id: 'b3', customer_id: 'c2', seats: 6, status: 'confirmed', customer: customer({ id: 'c2', first_name: 'Katie', last_name: 'F', sms_opt_in: false, sms_status: 'opted_out' }) },
      { id: 'b4', customer_id: 'c3', seats: 1, status: 'confirmed', customer: customer({ id: 'c3', first_name: 'null', last_name: '' }) },
    ])

    const audience = await loadEventBookerAudience(db, 'evt-1', { includePendingPayment: false })

    expect(audience.recipients).toHaveLength(2)
    expect(audience.recipients[0]).toMatchObject({ customerId: 'c1', bookingIds: ['b1', 'b2'], seats: 3, firstName: 'Helen' })
    expect(audience.recipients[1]).toMatchObject({ customerId: 'c3', firstName: '' })
    expect(audience.excluded).toEqual([{ customerId: 'c2', name: 'Katie F', seats: 6, reason: 'opted_out' }])
  })

  it('reads confirmed bookings only unless staff include those waiting for payment', async () => {
    const off = mockDb([])
    await loadEventBookerAudience(off.db, 'evt-1', { includePendingPayment: false })
    expect(off.calls.in).toEqual(['status', ['confirmed']])

    const on = mockDb([])
    await loadEventBookerAudience(on.db, 'evt-1', { includePendingPayment: true })
    expect(on.calls.in).toEqual(['status', ['confirmed', 'pending_payment']])
  })

  it('marks a booker as awaiting payment only when none of their bookings is confirmed', async () => {
    const { db } = mockDb([
      { id: 'b1', customer_id: 'c1', seats: 1, status: 'pending_payment', customer: customer({ id: 'c1' }) },
      { id: 'b2', customer_id: 'c2', seats: 1, status: 'pending_payment', customer: customer({ id: 'c2' }) },
      { id: 'b3', customer_id: 'c2', seats: 1, status: 'confirmed', customer: customer({ id: 'c2' }) },
    ])
    const audience = await loadEventBookerAudience(db, 'evt-1', { includePendingPayment: true })
    expect(audience.recipients.map((r) => [r.customerId, r.pendingPayment])).toEqual([
      ['c1', true],
      ['c2', false],
    ])
  })

  it('throws when the bookings cannot be read, so nothing is sent on a partial list', async () => {
    const { db } = mockDb([], { message: 'boom' })
    await expect(loadEventBookerAudience(db, 'evt-1', { includePendingPayment: false })).rejects.toThrow('boom')
  })
})

describe('personaliseBookerText', () => {
  it('fills the first name, and greets a nameless booker as "there"', () => {
    expect(personaliseBookerText('Hi {{first_name}}, doors at 7', 'Leo')).toBe('Hi Leo, doors at 7')
    expect(personaliseBookerText('Hi {{ first_name }}!', '')).toBe('Hi there!')
  })
})

describe('the event_booker_update template key', () => {
  it('does not use up a guest\'s promotional allowance', () => {
    expect(PROMOTIONAL_SMS_TEMPLATE_KEYS as readonly string[]).not.toContain(EVENT_BOOKER_UPDATE_TEMPLATE_KEY)
  })

  it('is still stopped by SUSPEND_EVENT_SMS', () => {
    expect(
      resolveSmsSuspensionReason({
        suspendEventSms: 'true',
        metadata: { template_key: EVENT_BOOKER_UPDATE_TEMPLATE_KEY },
      })
    ).toBe('event_sms')
  })

  it('routes as SMS only', () => {
    expect(resolveNotificationRoute({ templateKey: EVENT_BOOKER_UPDATE_TEMPLATE_KEY, policy: 'email_first' }).channels).toEqual(['sms'])
  })
})
