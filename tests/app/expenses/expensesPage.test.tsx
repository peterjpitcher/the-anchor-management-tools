import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// The insights chart links to /expenses?from=&to=. The page applies those dates on the server and
// the client must not load the list a second time when it mounts (spec 5.2 B5).

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  checkUserPermission: vi.fn(),
  getExpenses: vi.fn(),
  getExpenseStats: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/expenses',
  useSearchParams: () => new URLSearchParams('from=2026-07-01&to=2026-09-30'),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/expenses', () => ({
  getExpenses: mocks.getExpenses,
  getExpenseStats: mocks.getExpenseStats,
  getExpenseFiles: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  uploadExpenseFile: vi.fn(),
  deleteExpenseFile: vi.fn(),
}))

import ExpensesPage from '@/app/(authenticated)/expenses/page'
import { ExpensesClient } from '@/app/(authenticated)/expenses/_components/ExpensesClient'

const STATS = { quarterTotal: 0, vatReclaimable: 0, missingReceipts: 0, supplierSpend: [] }

function page(params: Record<string, string | string[]> = {}) {
  return ExpensesPage({ searchParams: Promise.resolve(params) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkUserPermission.mockResolvedValue(true)
  mocks.getExpenses.mockResolvedValue({ success: true, data: [] })
  mocks.getExpenseStats.mockResolvedValue({ success: true, data: STATS })
})

afterEach(() => {
  cleanup()
})

describe('ExpensesPage', () => {
  it('loads the list for the dates in the address on the server', async () => {
    await page({ from: '2026-07-01', to: '2026-09-30' })

    expect(mocks.getExpenses).toHaveBeenCalledTimes(1)
    expect(mocks.getExpenses).toHaveBeenCalledWith({ dateFrom: '2026-07-01', dateTo: '2026-09-30' })
  })

  it('loads everything when the address has no dates', async () => {
    await page()

    expect(mocks.getExpenses).toHaveBeenCalledWith({ dateFrom: undefined, dateTo: undefined })
  })

  it('ignores a date that is not a real date rather than failing the page', async () => {
    await page({ from: '2026-02-30', to: 'soon' })

    expect(mocks.getExpenses).toHaveBeenCalledWith({ dateFrom: undefined, dateTo: undefined })
  })

  it('shows the filtered list with the date inputs filled and does not fetch again on mount', async () => {
    render(await page({ from: '2026-07-01', to: '2026-09-30' }))
    await Promise.resolve()

    expect(mocks.getExpenses).toHaveBeenCalledTimes(1)
    expect(screen.getByDisplayValue('2026-07-01')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-09-30')).toBeInTheDocument()
  })

  it('still sends someone without the view permission away', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)
    mocks.redirect.mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT')
    })

    await expect(page({ from: '2026-07-01' })).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/unauthorized')
    expect(mocks.getExpenses).not.toHaveBeenCalled()
  })
})

describe('ExpensesClient', () => {
  it('does not refetch on mount even when the address carries dates', async () => {
    render(
      <ExpensesClient
        initialExpenses={[]}
        initialStats={STATS}
        initialFilters={{ dateFrom: '2026-07-01', dateTo: '2026-09-30' }}
      />,
    )
    await Promise.resolve()

    expect(mocks.getExpenses).not.toHaveBeenCalled()
    expect(mocks.getExpenseStats).not.toHaveBeenCalled()
  })
})
