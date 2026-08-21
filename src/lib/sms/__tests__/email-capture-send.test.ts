import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/twilio', () => ({ sendSMS: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/sms/bulk', () => ({
  getSmartFirstName: (name: string | null | undefined) =>
    !name || /^(guest|unknown|customer|client|user|admin)$/i.test(name.trim()) ? 'there' : name.trim(),
}))

import { sendEmailCaptureSms } from '@/lib/sms/email-capture'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSMS } from '@/lib/twilio'

/**
 * These tests exist because of a real bug that would have permanently written off roughly
 * 300 of 423 real customers.
 *
 * The audience query excludes anyone holding an email_capture token, so being asked once is
 * permanent. The send originally WROTE THAT TOKEN BEFORE sending. The dominant failure is not
 * a dead number, it is the global 120-per-hour SMS safety guard, which refuses every send once
 * the hour's budget is gone. Writing the token first therefore marked hundreds of people as
 * asked who never received anything, and no later run would ever reach them.
 *
 * The invariant these tests pin: a token row exists if and only if a message went out.
 */

type TokenInsert = { customer_id: string; action_type: string }

function mockDb(audience: Array<{ customer_id: string; first_name: string | null; phone_number: string }>) {
  const inserted: TokenInsert[] = []

  const db = {
    rpc: vi.fn().mockResolvedValue({ data: audience, error: null }),
    from: vi.fn().mockImplementation((table: string) => {
      if (table !== 'guest_tokens') throw new Error(`unexpected table ${table}`)
      return {
        insert: vi.fn().mockImplementation((row: TokenInsert) => {
          inserted.push(row)
          return Promise.resolve({ error: null })
        }),
      }
    }),
  }

  ;(createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db)
  return { inserted }
}

const AUDIENCE = [
  { customer_id: 'c1', first_name: 'Sam', phone_number: '+447700900001' },
  { customer_id: 'c2', first_name: 'Jo', phone_number: '+447700900002' },
  { customer_id: 'c3', first_name: 'Ash', phone_number: '+447700900003' },
]

beforeEach(() => {
  // resetAllMocks, not clearAllMocks. clearAllMocks empties the recorded calls but leaves any
  // unconsumed mockResolvedValueOnce values queued, and the rate-limit test deliberately
  // stops the loop early with one value still in the queue. That leftover then answered the
  // first call of the next test and made its assertions nonsense.
  vi.resetAllMocks()
})

describe('a token is written only when a message actually went out', () => {
  it('writes one token per successful send', async () => {
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true })

    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: false })

    expect(result.sent).toBe(3)
    expect(inserted.map((r) => r.customer_id)).toEqual(['c1', 'c2', 'c3'])
    expect(inserted.every((r) => r.action_type === 'email_capture')).toBe(true)
  })

  it('writes NO token when the send fails, so the guest stays eligible', async () => {
    // The whole point. A failed send must leave no trace, or the person is written off
    // forever having received nothing.
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'Unknown destination',
    })

    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: false })

    expect(result.sent).toBe(0)
    expect(result.errors).toBe(3)
    expect(inserted).toEqual([])
  })

  it('writes a token for the ones that worked and none for the ones that did not', async () => {
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Invalid To number' })
      .mockResolvedValueOnce({ success: true })

    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: false })

    expect(result.sent).toBe(2)
    expect(result.errors).toBe(1)
    expect(inserted.map((r) => r.customer_id)).toEqual(['c1', 'c3'])
  })
})

describe('the hourly SMS safety guard stops the run instead of burning through it', () => {
  it('stops at the first global rate limit and leaves everyone else untouched', async () => {
    // Before this, a rate-limited run would keep calling sendSMS for every remaining
    // recipient, fail every time, and (with the old ordering) write off all of them.
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, code: 'global_rate_limit', error: 'SMS sending paused by safety guard' })
      .mockResolvedValueOnce({ success: true })

    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: false })

    expect(result.stoppedBy).toBe('global_rate_limit')
    expect(result.sent).toBe(1)
    // c3 was never attempted, so it never even reached sendSMS.
    expect(sendSMS).toHaveBeenCalledTimes(2)
    expect(inserted.map((r) => r.customer_id)).toEqual(['c1'])
  })

  it('carries on past a per-recipient limit, even though it carries the same message text', async () => {
    // The regression that cost a whole run on 2026-08-21: twilio.ts returns the identical
    // 'SMS sending paused by safety guard' string for every safety outcome, and the detector
    // matched on that text, so one person's own limit aborted everyone else's send.
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: false, code: 'recipient_hourly_limit', error: 'SMS sending paused by safety guard' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })

    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: false })

    expect(result.stoppedBy).toBeUndefined()
    expect(result.failureCodes).toEqual({ recipient_hourly_limit: 1 })
    expect(result.sent).toBe(2)
    expect(inserted.map((r) => r.customer_id)).toEqual(['c2', 'c3'])
  })
})

describe('a dry run touches nothing', () => {
  it('sends no messages and writes no tokens', async () => {
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true })

    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: true })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(inserted).toEqual([])
    expect(result.preview).toHaveLength(3)
    expect(result.sent).toBe(0)
  })

  it('defaults to a dry run when the caller forgets to say', async () => {
    // Nothing here should send because an argument was omitted.
    const { inserted } = mockDb(AUDIENCE)
    ;(sendSMS as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true })

    await sendEmailCaptureSms({ maxRecipients: 10 })

    expect(sendSMS).not.toHaveBeenCalled()
    expect(inserted).toEqual([])
  })

  it('previews the shortened link, which is what the guest actually receives', async () => {
    mockDb(AUDIENCE)
    const result = await sendEmailCaptureSms({ maxRecipients: 10, dryRun: true })

    // Previously showed the raw 95-character token URL, so staff approved a message far
    // longer than the one that goes out and could not see the short link at all.
    expect(result.preview[0]).toContain('https://l.the-anchor.pub/')
    expect(result.preview[0]).not.toContain('/email-capture')
  })
})
