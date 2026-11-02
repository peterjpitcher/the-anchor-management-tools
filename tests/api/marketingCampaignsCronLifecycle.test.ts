import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The marketing cron's return-visit path: the voucher is issued only for an email about to go,
// its number lands in the email, a long kitchen closure holds the campaign without issuing
// anything, and a guest whose email fails for good gives the voucher back.

vi.mock('@/lib/cron-auth', () => ({
  authorizeCronRequest: vi.fn(() => ({ authorized: true })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/email/unsubscribe', () => ({
  getOrCreateUnsubscribeUrl: vi.fn(async () => 'https://management.example.test/api/unsubscribe?t=tok'),
  getOrCreateContactUnsubscribeUrl: vi.fn(async () => 'https://management.example.test/api/unsubscribe?t=tok'),
}))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: vi.fn(async () => true) }))
vi.mock('@/lib/business-hours/day-hours', () => ({ loadDayHours: vi.fn() }))

import { GET } from '@/app/api/cron/marketing-campaigns/route'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { reportCronFailure } from '@/lib/cron/alerting'
import { loadDayHours } from '@/lib/business-hours/day-hours'
import { shiftIsoDate, getTodayIsoDate } from '@/lib/dateUtils'

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111'
const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const VOUCHER_ID = '44444444-4444-4444-8444-444444444444'

const CONTENT = {
  title: 'Come back soon',
  preheader: 'Your voucher is inside',
  blocks: [
    {
      type: 'voucher_card',
      data: {
        kicker: 'Your voucher',
        headline: '{{voucher_percent}}% off your food',
        first_name: '{{first_name|}}',
        number: '{{voucher_number}}',
        expiry_date: '{{voucher_expires_on}}',
        how_to_use: 'Book a table, then show this email at the bar.',
        conditions: [
          '{{voucher_percent}}% off food for the booked table, in one visit.',
          'Drinks are not included.',
          'Not valid with the Christmas menu or special occasion menus.',
          'Advance booking is required.',
          'One voucher per table.',
          'Cannot be used with any other offer.',
        ],
      },
    },
    { type: 'cta_outline', data: { label: 'Book a table', url: 'https://www.the-anchor.pub/book-table?source=return_visit_email' } },
  ],
}

type Call = { kind: 'rpc' | 'from'; name: string; args?: unknown; op?: string; values?: unknown }

interface FakeState {
  recipientStatus: string
  voucherId: string | null
  voucherStatus: string
  issueResult: Record<string, unknown>
  calls: Call[]
}

function dayHours(closedEvery: (index: number) => boolean) {
  const today = getTodayIsoDate()
  const map = new Map()
  for (let i = 0; i < 30; i++) {
    const date = shiftIsoDate(today, i) as string
    map.set(date, { date, known: true, closed: false, kitchenClosed: closedEvery(i) })
  }
  return map
}

function fakeDb(state: FakeState) {
  let claimed = false

  const builder = (table: string) => {
    const call: Call = { kind: 'from', name: table, op: 'select' }
    state.calls.push(call)
    const resolve = () => {
      if (table === 'marketing_settings') return { data: { batch_size: 25 }, error: null }
      if (table === 'marketing_campaigns') {
        return {
          data: {
            id: CAMPAIGN_ID,
            subject: 'We have saved you a table',
            content: CONTENT,
            link_map: {},
            utm_campaign: 'return-visit-1',
            kind: 'lifecycle',
          },
          error: null,
        }
      }
      if (table === 'marketing_campaign_recipients') {
        if (call.op === 'update') {
          state.recipientStatus = (call.values as { status: string }).status
          return { data: { id: RECIPIENT_ID }, error: null }
        }
        if (call.op === 'count') return { data: null, count: 0, error: null }
        return { data: { status: state.recipientStatus, voucher_id: state.voucherId }, error: null }
      }
      if (table === 'vouchers') {
        return { data: { voucher_number: 'AN-2611-0007', status: state.voucherStatus }, error: null }
      }
      return { data: null, error: null }
    }
    const chain: Record<string, unknown> = {}
    for (const method of ['eq', 'in', 'gte', 'limit', 'order']) chain[method] = () => chain
    chain.select = (_cols?: string, options?: { head?: boolean }) => {
      if (options?.head) call.op = 'count'
      return chain
    }
    chain.update = (values: unknown) => {
      call.op = 'update'
      call.values = values
      return chain
    }
    chain.maybeSingle = async () => resolve()
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected)
    return chain
  }

  const rpc = async (name: string, args?: Record<string, unknown>) => {
    state.calls.push({ kind: 'rpc', name, args })
    switch (name) {
      case 'recover_stale_marketing_claims':
        return { data: [{ recovered: 0, quarantined: 0 }], error: null }
      case 'promote_due_marketing_campaigns':
        return { data: [], error: null }
      case 'claim_marketing_recipients':
        if (claimed) return { data: [], error: null }
        claimed = true
        state.recipientStatus = 'sending'
        return {
          data: [
            {
              id: RECIPIENT_ID,
              campaign_id: CAMPAIGN_ID,
              contact_id: null,
              customer_id: CUSTOMER_ID,
              email: 'guest@example.test',
              merge_fields: { first_name: 'Sam', party_size: 4 },
            },
          ],
          error: null,
        }
      case 'issue_lifecycle_voucher':
        state.voucherId = VOUCHER_ID
        return { data: state.issueResult, error: null }
      case 'release_marketing_claim':
        state.recipientStatus = args?.p_failure_class === 'terminal' ? 'failed' : 'pending'
        return { data: null, error: null }
      case 'voucher_cancel':
        state.voucherStatus = 'cancelled'
        return { data: { success: true }, error: null }
      case 'finalise_marketing_send':
        state.recipientStatus = 'sent'
        return { data: null, error: null }
      case 'complete_finished_marketing_campaigns':
        return { data: 0, error: null }
      default:
        return { data: null, error: { message: `unexpected rpc ${name}` } }
    }
  }

  return { from: builder, rpc }
}

const MANAGED_ENV = ['SUSPEND_ALL_EMAIL', 'SUSPEND_ALL_COMMS', 'MARKETING_SEND_ENABLED', 'MARKETING_EMAIL_FROM_ADDRESS', 'RESEND_API_KEY'] as const

describe('marketing cron, return-visit campaigns', () => {
  const saved: Record<string, string | undefined> = {}
  let state: FakeState

  beforeEach(() => {
    vi.clearAllMocks()
    for (const name of MANAGED_ENV) {
      saved[name] = process.env[name]
      delete process.env[name]
    }
    process.env.MARKETING_EMAIL_FROM_ADDRESS = 'The Anchor <noreply@auth.orangejelly.co.uk>'
    process.env.RESEND_API_KEY = 're_test'
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    state = {
      recipientStatus: 'pending',
      voucherId: null,
      voucherStatus: 'issued',
      issueResult: {
        success: true,
        voucher_id: VOUCHER_ID,
        voucher_number: 'AN-2611-0007',
        voucher_status: 'issued',
        merge_fields: {
          first_name: 'Sam',
          party_size: 4,
          voucher_number: 'AN-2611-0007',
          voucher_percent: 10,
          voucher_expires_on: '2026-12-11',
        },
      },
      calls: [],
    }
    vi.mocked(createAdminClient).mockReturnValue(fakeDb(state) as never)
    // Mondays only: four or five closed days in thirty, an ordinary month.
    vi.mocked(loadDayHours).mockResolvedValue(dayHours((i) => i % 7 === 0))
  })

  afterEach(() => {
    for (const name of MANAGED_ENV) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
    vi.restoreAllMocks()
  })

  const rpcCalls = (name: string) => state.calls.filter((call) => call.kind === 'rpc' && call.name === name)

  it('issues the voucher and sends it in the email, with the party size on the booking link', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailMessageId: 'em-1', messageId: 'pm-1' } as never)

    const response = await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))
    const body = await response.json()

    expect(rpcCalls('promote_due_marketing_campaigns')[0].args).toEqual({ p_include_lifecycle: true })
    expect(rpcCalls('issue_lifecycle_voucher')).toHaveLength(1)
    expect(rpcCalls('release_marketing_claim')).toEqual([])
    expect(body.sent).toBe(1)
    expect(body.vouchersIssued).toBe(1)

    const sent = vi.mocked(sendEmail).mock.calls[0][0]
    for (const output of [sent.html, sent.text]) {
      expect(output).toContain('AN-2611-0007')
      expect(output).toContain('Friday 11 December 2026')
      expect(output).not.toMatch(/\{\{|\}\}|undefined|Invalid Date|NaN/)
    }
    expect(sent.html).toContain('party_size=4')
    expect(sent.idempotencyKey).toBe(`marketing:${CAMPAIGN_ID}:${CUSTOMER_ID}:${RECIPIENT_ID}`)
    expect(rpcCalls('voucher_cancel')).toHaveLength(0)
  })

  it('holds the campaign through a long closure: nothing promoted, nothing issued, nothing sent', async () => {
    // Closed for two weeks: fourteen days plus the Mondays after.
    vi.mocked(loadDayHours).mockResolvedValue(dayHours((i) => i < 14 || i % 7 === 0))

    const response = await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))
    const body = await response.json()

    expect(rpcCalls('promote_due_marketing_campaigns')[0].args).toEqual({ p_include_lifecycle: false })
    expect(rpcCalls('issue_lifecycle_voucher')).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(state.recipientStatus).toBe('skipped')
    expect(body.closureSkipped).toBe(1)
    expect(body.lifecycleGate.open).toBe(false)
  })

  it('fails closed and alerts when the hours cannot be read', async () => {
    vi.mocked(loadDayHours).mockRejectedValue(new Error('business_hours read failed'))

    await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))

    expect(rpcCalls('promote_due_marketing_campaigns')[0].args).toEqual({ p_include_lifecycle: false })
    expect(rpcCalls('issue_lifecycle_voucher')).toHaveLength(0)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(reportCronFailure).toHaveBeenCalledWith(
      'marketing-campaigns',
      expect.any(Error),
      expect.objectContaining({ stage: 'return_visit_closure_gate' }),
    )
  })

  it('cancels the voucher when the email fails for good', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Invalid email address', code: 'validation_error' } as never)

    await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))

    expect(state.recipientStatus).toBe('failed')
    expect(rpcCalls('voucher_cancel')).toHaveLength(1)
    expect(rpcCalls('voucher_cancel')[0].args).toMatchObject({
      p_voucher_number: 'AN-2611-0007',
      p_reason: 'email_failed',
      p_source: 'system',
    })
  })

  it('keeps the voucher for a retry when the failure may clear', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'Rate limit exceeded', code: 'rate_limit_exceeded' } as never)

    await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))

    expect(state.recipientStatus).toBe('pending')
    expect(rpcCalls('voucher_cancel')).toHaveLength(0)
  })

  it('never sends a voucher that has since been cancelled', async () => {
    state.issueResult = { ...state.issueResult, idempotent_replay: true, voucher_status: 'cancelled' }

    await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))

    expect(sendEmail).not.toHaveBeenCalled()
    expect(state.recipientStatus).toBe('failed')
  })

  it('issues no voucher while email is suspended', async () => {
    process.env.SUSPEND_ALL_EMAIL = 'true'

    const response = await GET(new NextRequest('http://localhost/api/cron/marketing-campaigns'))

    expect((await response.json()).skipped).toBe('email_suspended')
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
