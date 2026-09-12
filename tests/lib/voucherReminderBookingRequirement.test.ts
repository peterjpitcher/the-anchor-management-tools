/**
 * Where the sender gets `requires_booking` from.
 *
 * The claim RPC only returns it from the 20260912 migration onwards, which is drafted and not
 * yet applied. Until it is, the sender resolves the flag itself, so the copy is correct
 * either way and there is no window in which booking-only holders are told to turn up.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const sendEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/email/emailService', () => ({ sendEmail }))

const sendSMS = vi.hoisted(() => vi.fn())
vi.mock('@/lib/twilio', () => ({ sendSMS }))

type ClaimRow = Record<string, unknown>

function buildClient(options: {
  claimed: ClaimRow[]
  voucherRows?: Array<Record<string, unknown>>
  voucherLookupError?: boolean
}) {
  const voucherSelectIn = vi.fn().mockResolvedValue(
    options.voucherLookupError
      ? { data: null, error: { message: 'boom' } }
      : { data: options.voucherRows ?? [], error: null }
  )

  let claimCalls = 0
  const rpc = vi.fn(async (name: string) => {
    if (name === 'voucher_reminders_claim_due') {
      claimCalls += 1
      return {
        data: { success: true, claimed: claimCalls === 1 ? options.claimed : [] },
        error: null,
      }
    }
    return { data: { success: true }, error: null }
  })

  createAdminClient.mockReturnValue({
    rpc,
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: (options.claimed as Array<{ customer_id?: string }>).map((row) => ({
                id: row.customer_id,
                email_status: 'valid',
                email_deactivated_at: null,
              })),
              error: null,
            }),
          }),
        }
      }
      if (table === 'email_suppressions') {
        return {
          select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
        }
      }
      if (table === 'vouchers') {
        return { select: vi.fn().mockReturnValue({ in: voucherSelectIn }) }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })

  return { voucherSelectIn }
}

function claimRow(extra: ClaimRow = {}): ClaimRow {
  return {
    reminder_id: 'reminder-1',
    voucher_id: 'voucher-1',
    voucher_number: 'V-0001',
    reminder_kind: 'pre_expiry_7',
    scheduled_for: '2026-10-03',
    customer_id: 'customer-1',
    first_name: 'Sam',
    last_name: 'Patel',
    email: 'sam@example.com',
    mobile_e164: '+447700900001',
    sms_opt_in: true,
    marketing_email_opt_in: true,
    expiry_date: '2026-10-10',
    won_at_label: 'the quiz',
    prize_label: 'Sunday roast for two',
    ...extra,
  }
}

async function run() {
  const { sendDueVoucherReminders } = await import('@/lib/vouchers/reminders')
  return sendDueVoucherReminders({ londonToday: '2026-10-03' })
}

function sentEmailText(): string {
  return String(sendEmail.mock.calls[0][0].text)
}

describe('voucher reminder booking requirement', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
    sendSMS.mockResolvedValue({ success: true, sid: 'sid-1' })
  })

  it('uses the flag the claim query returns, and asks for nothing more', async () => {
    const client = buildClient({ claimed: [claimRow({ requires_booking: true })] })

    await run()

    expect(client.voucherSelectIn).not.toHaveBeenCalled()
    expect(sentEmailText()).toContain('to book')
  })

  it('respects a false flag from the claim query', async () => {
    const client = buildClient({ claimed: [claimRow({ requires_booking: false })] })

    await run()

    expect(client.voucherSelectIn).not.toHaveBeenCalled()
    expect(sentEmailText()).toContain('show the card at the bar')
  })

  it('resolves the flag itself when the claim query does not carry it', async () => {
    const client = buildClient({
      claimed: [claimRow()],
      voucherRows: [
        {
          id: 'voucher-1',
          type_id: 'drink-one',
          voucher_batches: { type_definitions: {} },
          voucher_types: { requires_booking: false },
        },
      ],
    })

    await run()

    expect(client.voucherSelectIn).toHaveBeenCalledWith('id', ['voucher-1'])
    expect(sentEmailText()).toContain('show the card at the bar')
  })

  it('lets the batch snapshot override the live type, as redemption does', async () => {
    buildClient({
      claimed: [claimRow()],
      voucherRows: [
        {
          id: 'voucher-1',
          type_id: 'drink-one',
          voucher_batches: { type_definitions: { 'drink-one': { requires_booking: true } } },
          voucher_types: { requires_booking: false },
        },
      ],
    })

    await run()

    expect(sentEmailText()).toContain('to book')
  })

  it('assumes a booking is needed when the requirement cannot be read', async () => {
    // Safe direction: asking a walk-up holder to ring first is a small inconvenience, while
    // telling a booking-only holder to turn up is a guest we cannot serve.
    buildClient({ claimed: [claimRow()], voucherLookupError: true })

    await run()

    expect(sentEmailText()).toContain('to book')
  })

  it('assumes a booking is needed when the voucher row is missing', async () => {
    buildClient({ claimed: [claimRow()], voucherRows: [] })

    await run()

    expect(sentEmailText()).toContain('to book')
  })
})
