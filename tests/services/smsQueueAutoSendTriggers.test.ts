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
