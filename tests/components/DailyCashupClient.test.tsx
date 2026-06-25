import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DailyClient } from '@/app/(authenticated)/cashing-up/daily/_components/DailyClient'

const routerPushMock = vi.hoisted(() => vi.fn())
const routerRefreshMock = vi.hoisted(() => vi.fn())
const upsertSessionActionMock = vi.hoisted(() => vi.fn())
const upsertAndSubmitSessionActionMock = vi.hoisted(() => vi.fn())
const approveSessionActionMock = vi.hoisted(() => vi.fn())
const deleteSessionActionMock = vi.hoisted(() => vi.fn())
const lockSessionActionMock = vi.hoisted(() => vi.fn())
const unlockSessionActionMock = vi.hoisted(() => vi.fn())
const setDailyTargetActionMock = vi.hoisted(() => vi.fn())
const getDailySummaryActionMock = vi.hoisted(() => vi.fn())
const getMissingCashupDatesActionMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
}))

vi.mock('@/app/actions/cashing-up', () => ({
  approveSessionAction: approveSessionActionMock,
  deleteSessionAction: deleteSessionActionMock,
  lockSessionAction: lockSessionActionMock,
  setDailyTargetAction: setDailyTargetActionMock,
  unlockSessionAction: unlockSessionActionMock,
  upsertSessionAction: upsertSessionActionMock,
  upsertAndSubmitSessionAction: upsertAndSubmitSessionActionMock,
}))

vi.mock('@/app/actions/daily-summary', () => ({
  getDailySummaryAction: getDailySummaryActionMock,
}))

vi.mock('@/app/actions/missing-cashups', () => ({
  getMissingCashupDatesAction: getMissingCashupDatesActionMock,
}))

vi.mock('react-hot-toast', () => ({
  default: toastMock,
}))

const baseProps = {
  siteId: 'site-1',
  siteName: 'The Anchor',
  sessionDate: '2026-05-24',
  dailySummary: null,
  dailyTarget: 0,
  weeklyData: [],
  existingSession: null,
  missingDates: ['2026-05-24', '2026-05-25'],
}

const getInput = (container: HTMLElement, selector: string): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`Missing input: ${selector}`)
  return input
}

describe('DailyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDailySummaryActionMock.mockResolvedValue({ success: true, summary: null })
    getMissingCashupDatesActionMock.mockResolvedValue({ success: true, dates: [] })
    upsertSessionActionMock.mockResolvedValue({ success: true, data: { id: 'session-1' } })
    upsertAndSubmitSessionActionMock.mockResolvedValue({ success: true, data: { id: 'session-1' } })
    approveSessionActionMock.mockResolvedValue({ success: true, data: { id: 'session-1', status: 'approved' } })
    deleteSessionActionMock.mockResolvedValue({ success: true, data: { id: 'session-1' } })
    lockSessionActionMock.mockResolvedValue({ success: true, data: { id: 'session-1', status: 'locked' } })
    unlockSessionActionMock.mockResolvedValue({ success: true, data: { id: 'session-1', status: 'approved' } })
    setDailyTargetActionMock.mockResolvedValue({ success: true })
  })

  it('hides number input steppers on the daily cash-up fields', () => {
    const { container } = render(<DailyClient {...baseProps} />)

    const numberInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'))

    expect(numberInputs.length).toBeGreaterThan(0)
    numberInputs.forEach((input) => {
      expect(input.className).toContain('[appearance:textfield]')
      expect(input.className).toContain('[&::-webkit-inner-spin-button]:appearance-none')
    })
  })

  it('submits in one action and clears entered values after success', async () => {
    const { container } = render(<DailyClient {...baseProps} />)
    const cash50 = getInput(container, '#input-denom-50')
    const cashExpected = getInput(container, '#input-cash-expected')
    const cardTotal = getInput(container, '#input-card-total')
    const stripeTotal = getInput(container, '#input-stripe-total')
    const drinksSales = getInput(container, '#input-drinks-sales')
    const notes = getInput(container, '#input-notes')

    fireEvent.change(cash50, { target: { value: '50' } })
    fireEvent.change(cashExpected, { target: { value: '45' } })
    fireEvent.change(cardTotal, { target: { value: '10' } })
    fireEvent.change(stripeTotal, { target: { value: '5' } })
    fireEvent.change(drinksSales, { target: { value: '60' } })
    fireEvent.change(notes, { target: { value: 'All checked' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(upsertAndSubmitSessionActionMock).toHaveBeenCalledTimes(1)
    })

    expect(upsertSessionActionMock).not.toHaveBeenCalled()
    expect(upsertAndSubmitSessionActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: 'site-1',
        sessionDate: '2026-05-24',
        status: 'draft',
        notes: 'All checked',
        cashCounts: [{ denomination: 50, totalAmount: 50 }],
        paymentBreakdowns: [
          { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 45, countedAmount: 50 },
          { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: 10, countedAmount: 10 },
          { paymentTypeCode: 'STRIPE', paymentTypeLabel: 'Stripe', expectedAmount: 5, countedAmount: 5 },
        ],
        salesBreakdowns: [
          { salesCategory: 'drinks_sales', amount: 60 },
          { salesCategory: 'food_sales', amount: 0 },
          { salesCategory: 'other_sales', amount: 0 },
        ],
      }),
      undefined
    )

    await waitFor(() => {
      expect(cash50.value).toBe('')
      expect(cashExpected.value).toBe('')
      expect(cardTotal.value).toBe('')
      expect(stripeTotal.value).toBe('')
      expect(notes.value).toBe('')
    })
    expect(routerPushMock).toHaveBeenCalledWith('/cashing-up/daily?date=2026-05-25&siteId=site-1')
  })

  it('clears stale values when moving to a different empty cash-up date', async () => {
    const { container, rerender } = render(<DailyClient {...baseProps} />)
    const cardTotal = getInput(container, '#input-card-total')

    fireEvent.change(cardTotal, { target: { value: '12.34' } })

    rerender(<DailyClient {...baseProps} sessionDate="2026-05-25" missingDates={[]} />)

    await waitFor(() => {
      expect(cardTotal.value).toBe('')
    })
  })

  it('shows payment breakdown totals in the week at a glance table', () => {
    render(
      <DailyClient
        {...baseProps}
        weeklyData={[
          {
            session_date: '2026-05-23',
            status: 'submitted',
            total_expected_amount: 1842.33,
            total_counted_amount: 1828.43,
            total_variance_amount: -13.9,
            cash_counted_amount: 154.2,
            non_cash_counted_amount: 1674.23,
          },
        ]}
      />
    )

    const saturdayRow = screen.getByText('Sat').closest('tr')
    expect(saturdayRow).not.toBeNull()
    const row = within(saturdayRow as HTMLTableRowElement)

    expect(row.getByText('£154.20')).toBeInTheDocument()
    expect(row.getByText('£1,674.23')).toBeInTheDocument()
    expect(row.getByText('£1,828.43')).toBeInTheDocument()
    expect(row.queryByText('£3,670.76')).not.toBeInTheDocument()
  })

  it('wires approve action for submitted sessions', async () => {
    render(
      <DailyClient
        {...baseProps}
        existingSession={{
          id: 'session-1',
          status: 'submitted',
          site_id: 'site-1',
          session_date: '2026-05-24',
          notes: null,
          total_expected_amount: 0,
          total_counted_amount: 0,
          total_variance_amount: 0,
          prepared_by_user_id: null,
          approved_by_user_id: null,
          locked_at: null,
          created_by_user_id: null,
          updated_by_user_id: null,
          created_at: '',
          updated_at: '',
          cashup_payment_breakdowns: [],
          cashup_cash_counts: [],
          cashup_sales_breakdowns: [],
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(approveSessionActionMock).toHaveBeenCalledWith('session-1')
    })
    expect(routerRefreshMock).toHaveBeenCalled()
  })

  it('saves the daily target', async () => {
    render(<DailyClient {...baseProps} dailyTarget={100} />)
    const targetInput = screen.getByLabelText('Target')

    fireEvent.change(targetInput, { target: { value: '125.50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Target' }))

    await waitFor(() => {
      expect(setDailyTargetActionMock).toHaveBeenCalledWith('site-1', '2026-05-24', 125.5)
    })
    expect(routerRefreshMock).toHaveBeenCalled()
  })

  it('confirms before deleting an unlocked session', async () => {
    render(
      <DailyClient
        {...baseProps}
        existingSession={{
          id: 'session-1',
          status: 'draft',
          site_id: 'site-1',
          session_date: '2026-05-24',
          notes: null,
          total_expected_amount: 0,
          total_counted_amount: 0,
          total_variance_amount: 0,
          prepared_by_user_id: null,
          approved_by_user_id: null,
          locked_at: null,
          created_by_user_id: null,
          updated_by_user_id: null,
          created_at: '',
          updated_at: '',
          cashup_payment_breakdowns: [],
          cashup_cash_counts: [],
          cashup_sales_breakdowns: [],
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(deleteSessionActionMock).toHaveBeenCalledWith('session-1')
    })
    expect(routerRefreshMock).toHaveBeenCalled()
  })
})
