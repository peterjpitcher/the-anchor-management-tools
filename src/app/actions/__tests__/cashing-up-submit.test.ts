import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/services/permission', () => ({
  PermissionService: { checkUserPermission: vi.fn() },
}))
vi.mock('@/services/cashing-up.service', () => ({
  CashingUpService: {
    getSessionByDateAndSite: vi.fn(),
    upsertSession: vi.fn(),
  },
}))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { PermissionService } from '@/services/permission'
import { CashingUpService } from '@/services/cashing-up.service'
import type { CashupSession, UpsertCashupSessionDTO } from '@/types/cashing-up'
import { upsertAndSubmitSessionAction } from '../cashing-up'

const input: UpsertCashupSessionDTO = {
  siteId: 'site-1',
  sessionDate: '2026-08-22',
  notes: null,
  paymentBreakdowns: [
    { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 10, countedAmount: 10 },
  ],
  cashCounts: [{ denomination: 10, totalAmount: 10 }],
  salesBreakdowns: [{ salesCategory: 'drinks_sales', amount: 10 }],
}

const storedSession = {
  id: 'session-1',
  site_id: 'site-1',
  session_date: '2026-08-22',
  status: 'submitted',
  prepared_by_user_id: 'user-1',
  approved_by_user_id: null,
  total_expected_amount: 10,
  total_counted_amount: 10,
  total_variance_amount: 0,
  notes: null,
  created_at: '2026-08-25T08:15:15Z',
  created_by_user_id: 'user-1',
  updated_at: '2026-08-25T08:15:15Z',
  updated_by_user_id: 'user-1',
  cashup_payment_breakdowns: [
    { id: 'p1', cashup_session_id: 'session-1', payment_type_code: 'CASH', payment_type_label: 'Cash', expected_amount: 10, counted_amount: 10, variance_amount: 0 },
  ],
  cashup_cash_counts: [
    { id: 'c1', cashup_session_id: 'session-1', denomination: 10, quantity: 1, total_amount: 10 },
  ],
  cashup_sales_breakdowns: [
    { id: 's1', cashup_session_id: 'session-1', sales_category: 'drinks_sales', amount: 10 },
    { id: 's2', cashup_session_id: 'session-1', sales_category: 'food_sales', amount: 0 },
    { id: 's3', cashup_session_id: 'session-1', sales_category: 'other_sales', amount: 0 },
  ],
} satisfies CashupSession

describe('upsertAndSubmitSessionAction duplicate recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)
    vi.mocked(PermissionService.checkUserPermission).mockResolvedValue(true)
  })

  it('returns the existing submission for an exact retry', async () => {
    vi.mocked(CashingUpService.getSessionByDateAndSite).mockResolvedValue(storedSession as never)

    const result = await upsertAndSubmitSessionAction(input)

    expect(result).toMatchObject({ success: true, data: storedSession, recovered: true })
    expect(CashingUpService.upsertSession).not.toHaveBeenCalled()
  })

  it('does not hide a conflicting cash-up', async () => {
    vi.mocked(CashingUpService.getSessionByDateAndSite).mockResolvedValue({
      ...storedSession,
      created_by_user_id: 'user-2',
    } as never)

    const result = await upsertAndSubmitSessionAction(input)

    expect(result).toEqual({
      success: false,
      error: 'A cash-up for this site and date already exists. Refresh the page to view it.',
    })
  })

  it('recovers when another request creates the same session during submission', async () => {
    vi.mocked(CashingUpService.getSessionByDateAndSite)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedSession as never)
    vi.mocked(CashingUpService.upsertSession).mockRejectedValue({
      code: 'P0001',
      details: null,
      hint: null,
      message: 'A session for this site and date already exists.',
    })

    const result = await upsertAndSubmitSessionAction(input)

    expect(result).toMatchObject({ success: true, data: storedSession, recovered: true })
  })
})
