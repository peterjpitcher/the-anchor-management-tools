import { describe, it, expect, vi } from 'vitest'

// sms-queue pulls in the Supabase clients at module scope; stub them so the
// pure trigger predicate can be exercised in isolation.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { shouldAutoSendPrivateBookingSms } from '@/services/sms-queue'

describe('private booking SMS auto-send triggers', () => {
  it('auto-sends the corrective balance-due-date change SMS', () => {
    // Regression (discovery 2026-07-08): a corrective notification that sits in
    // the queue awaiting approval reproduces the very bug it exists to prevent —
    // the customer never hears that their deadline moved.
    expect(shouldAutoSendPrivateBookingSms('balance_due_date_changed')).toBe(true)
  })

  it('auto-sends the sibling date-change SMS it is modelled on', () => {
    expect(shouldAutoSendPrivateBookingSms('date_changed')).toBe(true)
  })

  it('does not auto-send an unknown trigger type', () => {
    expect(shouldAutoSendPrivateBookingSms('not_a_real_trigger')).toBe(false)
  })
})

// BK-064 (customer bookings review, 24 October 2026): the reminders were renamed in July and the new
// names never reached the auto-send list, so the 3-day deposit reminder, the balance reminders and
// three cancellation texts waited 120 days for an approval nobody gave. Owner decision D16: they
// all send automatically again. Every trigger the app sends must be listed.
describe('every private booking text the app sends is on the auto-send list', () => {
  it('each deposit and balance reminder the monitor can pick', async () => {
    const { classifyBalanceReminderWindow, classifyDepositReminderWindow } = await import('@/services/private-bookings/scheduled-sms')
    const triggers = new Set<string>()
    for (let days = -2; days <= 30; days += 1) {
      const deposit = classifyDepositReminderWindow(days)
      const balance = classifyBalanceReminderWindow(days)
      if (deposit) triggers.add(deposit)
      if (balance) triggers.add(balance)
    }
    expect([...triggers].sort()).toEqual([
      'balance_reminder_15day',
      'balance_reminder_16day',
      'balance_reminder_21day',
      'balance_reminder_due',
      'deposit_reminder_1day',
      'deposit_reminder_3day',
      'deposit_reminder_7day',
    ])
    for (const trigger of triggers) expect(shouldAutoSendPrivateBookingSms(trigger), trigger).toBe(true)
  })

  it('each cancellation text chooseCancellationVariant can choose', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'src/lib/private-bookings/cancellation-variant.ts'), 'utf8')
    const start = source.indexOf('export function chooseCancellationVariant(')
    const body = source.slice(start)
    const triggers = [...new Set([...body.matchAll(/triggerType: '([a-z_]+)'/g)].map((match) => match[1]))].sort()
    expect(triggers).toEqual([
      'booking_cancelled_hold',
      'booking_cancelled_manual_review',
      'booking_cancelled_partial_refund',
      'booking_cancelled_refundable',
      'booking_cancelled_retention',
      'booking_cancelled_review_pending',
    ])
    for (const trigger of triggers) expect(shouldAutoSendPrivateBookingSms(trigger), trigger).toBe(true)
  })

  it.each([
    'deposit_request', 'deposit_received', 'final_payment_received', 'booking_confirmed', 'booking_completed',
    'booking_expired', 'hold_extended', 'event_reminder_1d', 'setup_reminder', 'review_request',
  ])('%s', (trigger) => {
    expect(shouldAutoSendPrivateBookingSms(trigger)).toBe(true)
  })

  it.each(['balance_reminder_14day', 'balance_reminder_7day', 'balance_reminder_1day', 'booking_cancelled'])(
    'no longer lists the retired name %s',
    (trigger) => {
      expect(shouldAutoSendPrivateBookingSms(trigger)).toBe(false)
    },
  )
})
