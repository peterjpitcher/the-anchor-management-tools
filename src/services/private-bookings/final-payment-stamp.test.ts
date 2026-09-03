/**
 * Regression guard: private_bookings.final_payment_date is owned by the database.
 *
 * Two live bookings (2026-08-27) read "paid in full" while the payments behind
 * them were missing from the ledger. Both came from code that decided
 * settlement outside the RPCs:
 *   - a legacy helper that stamped the column from a payment method alone,
 *     recording no money at all;
 *   - apply_balance_payment_status comparing payments against the NET total
 *     before totals became VAT-aware.
 *
 * Only record_balance_payment and apply_balance_payment_status may set or
 * clear the column, and both derive it from the gross total against
 * private_booking_payments rows. The returnable booking and damage deposit
 * never counts towards the event balance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: { queueAndSend: vi.fn().mockResolvedValue({ sent: true }) },
}))
vi.mock('@/lib/google-calendar', () => ({
  isCalendarConfigured: vi.fn(() => false),
  syncCalendarEvent: vi.fn(),
}))
vi.mock('@/lib/analytics/events', () => ({ recordAnalyticsEvent: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/email/private-booking-emails', () => ({
  sendDepositReceivedEmail: vi.fn().mockResolvedValue(undefined),
  sendBalancePaidEmail: vi.fn().mockResolvedValue(undefined),
  sendBookingConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendBookingCalendarInvite: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordBalancePayment } from './payments'

const BOOKING = {
  id: 'booking-id',
  customer_first_name: 'Millie',
  customer_last_name: 'Prynn',
  customer_name: 'Millie Prynn',
  event_date: '2026-06-20',
  start_time: '18:00',
  end_time: '23:00',
  contact_phone: '+447700900123',
  contact_email: null,
  customer_id: 'customer-id',
  calendar_event_id: null,
  status: 'confirmed',
  guest_count: 50,
  event_type: 'Birthday Party',
  deposit_paid_date: '2026-04-23T09:54:25Z',
  deposit_amount: 100,
  total_amount: 75,
  date_tbd: false,
  internal_notes: null,
}

type RpcResult = { total_paid: number; remaining_balance: number; is_fully_paid: boolean }

function mockServerClient(rpcResult: RpcResult) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null })
  // Every .update() anywhere in the flow lands here, tagged with its table.
  const updates: { table: string; payload: Record<string, unknown> }[] = []

  const client = {
    rpc,
    from: vi.fn((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: BOOKING, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { calculated_total: 75, gross_total: 90 },
        error: null,
      }),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        return {
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'booking-id' }, error: null }),
            }),
          }),
        }
      }),
    })),
  }

  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client)

  // The RPC itself runs on the service role client: `authenticated` no longer
  // holds EXECUTE on record_balance_payment, so a signed-in user cannot POST to
  // it directly and skip the permission check in recordFinalPayment. The same
  // `rpc` spy backs both clients, so the assertions below still describe the
  // one call that matters.
  ;(createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ ...client, rpc })

  return { rpc, updates }
}

describe('recordBalancePayment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records the payment through record_balance_payment rather than stamping the column', async () => {
    const { rpc, updates } = mockServerClient({
      total_paid: 75,
      remaining_balance: 15,
      is_fully_paid: false,
    })

    await recordBalancePayment('booking-id', 75, 'cash', 'user-id')

    expect(rpc).toHaveBeenCalledWith('record_balance_payment', {
      p_booking_id: 'booking-id',
      p_amount: 75,
      p_method: 'cash',
      p_recorded_by: 'user-id',
    })
    expect(updates).toEqual([])
  })

  it('never writes final_payment_date itself, even when the RPC reports fully paid', async () => {
    const { updates } = mockServerClient({
      total_paid: 90,
      remaining_balance: 0,
      is_fully_paid: true,
    })

    await recordBalancePayment('booking-id', 15, 'cash', 'user-id')

    const stampWrites = updates.filter(u => 'final_payment_date' in u.payload)
    expect(stampWrites).toEqual([])
  })
})

describe('final_payment_date write paths', () => {
  const SRC = resolve(__dirname, '../..')

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) sourceFiles(full, acc)
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full)
    }
    return acc
  }

  it('has no direct write to final_payment_date anywhere in src/', () => {
    // Matches a Supabase write payload, e.g. .update({ final_payment_date: ... }).
    // The column may only change via record_balance_payment or
    // apply_balance_payment_status, which weigh payments against the gross total.
    const writePattern = /\.(update|insert|upsert)\(\s*\{[^}]*final_payment_date/

    const offenders = sourceFiles(SRC)
      .filter(file => {
        const text = readFileSync(file, 'utf8')
        return text.includes('final_payment_date') && writePattern.test(text)
      })
      .map(file => file.slice(SRC.length + 1))

    expect(offenders).toEqual([])
  })
})
