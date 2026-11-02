import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The subject tag of a table deposit alert. [PAYPAL ACTION NEEDED] is kept for real PayPal
 * faults; cash to hand back at the bar says so instead (owner, 2 November 2026).
 */

vi.mock('@/lib/money-alerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/money-alerts')>()),
  alertMoneyNeedsAPerson: vi.fn(async () => ({ sent: true, duplicate: false })),
}))

import { alertMoneyNeedsAPerson } from '@/lib/money-alerts'
import { alertTableDepositNeedsAPerson } from '@/lib/table-bookings/deposit-alerts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('alertTableDepositNeedsAPerson subject tags', () => {
  it('labels cash owed back at the bar as refunds to hand back', async () => {
    await alertTableDepositNeedsAPerson({} as never, { bookingId: 'booking-1', kind: 'cash_refund_due', amountGbp: 60, source: 'test' })

    expect(vi.mocked(alertMoneyNeedsAPerson).mock.calls[0][1]).toMatchObject({ kind: 'cash_refund_due', subjectTag: 'REFUNDS TO HAND BACK' })
  })

  it('leaves a PayPal fault on the default PayPal tag', async () => {
    await alertTableDepositNeedsAPerson({} as never, { bookingId: 'booking-1', kind: 'refund_failed', amountGbp: 60, source: 'test' })

    expect(vi.mocked(alertMoneyNeedsAPerson).mock.calls[0][1].subjectTag).toBeUndefined()
  })
})
