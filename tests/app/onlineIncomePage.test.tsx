// BK-117 (owner decision D33): the Online Income page under Cashing Up shows what was taken online,
// refunded and kept, the P&L line, PayPal fees and a CSV link, and says so when it cannot load.
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ fail: false }))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/cashing-up/online-income',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => true) }))
vi.mock('@/lib/finance/online-income', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance/online-income')>()
  return {
    ...actual,
    loadOnlineIncome: vi.fn(async () => {
      if (state.fail) throw new Error('view unreadable')
      return [
        {
          source: 'table_deposit', sourceId: 'a', moneyDate: '2026-10-05', reference: 'TB-APPLIED', visitDate: '2026-10-10',
          gross: 160, refunded: 0, net: 160, method: 'paypal', captureId: 'CAP-1', paypalFee: 5.42, status: 'applied', isBookingMoney: true,
        },
        {
          source: 'invoice', sourceId: 'b', moneyDate: '2026-10-06', reference: 'INV-OTHER', visitDate: null,
          gross: 420, refunded: 0, net: 420, method: 'paypal', captureId: 'CAP-2', paypalFee: null, status: 'paid', isBookingMoney: false,
        },
      ]
    }),
  }
})

import OnlineIncomePage from '@/app/(authenticated)/cashing-up/online-income/page'

beforeEach(() => {
  state.fail = false
})

describe('Online Income page', () => {
  it('shows the totals, the P&L line, the fees and each payment', async () => {
    render(await OnlineIncomePage({ searchParams: Promise.resolve({ from: '2026-10-01', to: '2026-10-31' }) }))

    expect(screen.getByText('Taken online').nextElementSibling?.textContent).toBe('£580.00')
    expect(screen.getByText('Online booking income').nextElementSibling?.textContent).toBe('£160.00')
    expect(screen.getByText('Not recorded for 1 older payments')).toBeInTheDocument()
    expect(screen.getByText('TB-APPLIED')).toBeInTheDocument()
    expect(screen.getByText('Not a booking')).toBeInTheDocument()
    // The header actions render for desktop and mobile.
    for (const link of screen.getAllByRole('link', { name: /Download CSV/ })) {
      expect(link).toHaveAttribute('href', '/api/cashing-up/online-income/export?from=2026-10-01&to=2026-10-31')
    }
  })

  it('says it could not load rather than showing nothing', async () => {
    state.fail = true
    render(await OnlineIncomePage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText(/Online income could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText('Taken online')).not.toBeInTheDocument()
  })
})
