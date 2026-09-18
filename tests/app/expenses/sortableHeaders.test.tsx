import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/expenses',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/expenses', () => ({
  getExpenses: vi.fn(),
  getExpenseStats: vi.fn(),
  getExpenseFiles: vi.fn(),
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
  uploadExpenseFile: vi.fn(),
  deleteExpenseFile: vi.fn(),
  getExpenseInsights: vi.fn(),
}))
// The chart draws nothing these tests need, so it is kept out of jsdom.
vi.mock('@/components/charts/BarChart', () => ({ BarChart: () => null }))

import { ExpensesClient } from '@/app/(authenticated)/expenses/_components/ExpensesClient'
import { ExpensesInsightsClient } from '@/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient'
import type { Expense } from '@/app/actions/expenses'

const expense: Expense = {
  id: 'exp-1',
  expense_date: '2026-09-02',
  company_ref: 'Booker',
  justification: 'Bar stock top-up',
  amount: 120.5,
  vat_applicable: true,
  vat_amount: 20.08,
  notes: null,
  created_by: null,
  created_at: '2026-09-02T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  file_count: 1,
}

let consoleError: MockInstance

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleError.mockRestore()
})

function headerRowTags(header: HTMLElement): string[] {
  return Array.from(header.closest('tr')?.children ?? []).map((cell) => cell.tagName)
}

function invalidNestingWarnings(): unknown[][] {
  return consoleError.mock.calls.filter((call) => String(call[0]).includes('cannot be a child of'))
}

// A sort button placed straight into a <tr> is invalid HTML. Browsers bundled those buttons
// into the first column (so the headers sat over the wrong columns), screen readers got no
// column headers, and React reported a hydration error on every load (18 Sep 2026).
describe('sortable expense table headers', () => {
  it('gives the expenses list one column header per column', () => {
    render(
      <ExpensesClient
        initialExpenses={[expense]}
        initialStats={{ quarterTotal: 120.5, vatReclaimable: 20.08, missingReceipts: 0, supplierSpend: [] }}
      />,
    )

    for (const name of ['Date', 'Company', 'Justification', 'Amount', 'VAT', 'Receipt', 'Actions']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(headerRowTags(screen.getByRole('columnheader', { name: 'Date' }))).toEqual(Array(7).fill('TH'))
    expect(invalidNestingWarnings()).toEqual([])
  })

  it('gives the insights company table one column header per column', () => {
    render(
      <ExpensesInsightsClient
        initialData={{
          bars: [],
          totals: { totalAmount: 520, totalVat: 86.67, count: 4 },
          byCompany: [{ companyRef: 'Booker', totalAmount: 520, totalVat: 86.67, count: 4 }],
        }}
      />,
    )

    for (const name of ['Company', 'Total', 'VAT', 'Count']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'descending')
    expect(headerRowTags(screen.getByRole('columnheader', { name: 'Company' }))).toEqual(Array(4).fill('TH'))
    expect(invalidNestingWarnings()).toEqual([])
  })
})
