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
const getCashupDayMoneyActionMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
  usePathname: () => '/cashing-up/daily',
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

vi.mock('@/app/actions/cashup-day-money', () => ({
  getCashupDayMoneyAction: getCashupDayMoneyActionMock,
}))

const NO_DAY_MONEY = {
  tableDeposits: { count: 0, amount: 0 },
  eventTickets: { count: 0, amount: 0 },
  privateHires: [],
  vouchersRedeemed: { count: 0, amount: 0 },
  total: 0,
}

vi.mock('@/ds/primitives/Toast', () => ({
  toast: toastMock,
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
  initialEditMode: false,
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
    getCashupDayMoneyActionMock.mockResolvedValue({ success: true, data: NO_DAY_MONEY })
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
    const drinksSales = getInput(container, '#input-drinks-sales')
    const notes = getInput(container, '#input-notes')

    fireEvent.change(cash50, { target: { value: '50' } })
    fireEvent.change(cashExpected, { target: { value: '45' } })
    fireEvent.change(cardTotal, { target: { value: '10' } })
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
        gapNote: 'All checked',
        cashCounts: [{ denomination: 50, totalAmount: 50 }],
        paymentBreakdowns: [
          { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 45, countedAmount: 50 },
          { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: 10, countedAmount: 10 },
          { paymentTypeCode: 'STRIPE', paymentTypeLabel: 'Stripe', expectedAmount: 0, countedAmount: 0 },
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
      expect(notes.value).toBe('')
    })
    expect(routerPushMock).toHaveBeenCalledWith('/cashing-up/daily?date=2026-05-25&siteId=site-1')
  })

  it('colours the balance banner by the one cash variance map: short red, over amber, balanced green', () => {
    const { container } = render(<DailyClient {...baseProps} />)
    const cash50 = getInput(container, '#input-denom-50')
    const cashExpected = getInput(container, '#input-cash-expected')
    const banner = () => screen.getByText(/Cash variance: review before approving|Cash balanced/).closest('[role="alert"]') as HTMLElement

    fireEvent.change(cash50, { target: { value: '50' } })
    fireEvent.change(cashExpected, { target: { value: '60' } })
    expect(banner()).toHaveClass('bg-danger-soft')
    expect(within(banner()).getByText('£-10.00')).toHaveClass('text-danger-fg')

    fireEvent.change(cashExpected, { target: { value: '45' } })
    expect(banner()).toHaveClass('bg-warning-soft')
    expect(within(banner()).getByText('£5.00')).toHaveClass('text-warning-fg')

    fireEvent.change(cashExpected, { target: { value: '50' } })
    expect(banner()).toHaveClass('bg-success-soft')
    expect(banner()).toHaveTextContent('Cash balanced')
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

  it('shows a failed week at a glance as a failure, not as a week with no takings', () => {
    render(<DailyClient {...baseProps} weeklyError="Database unavailable" />)

    const failure = screen.getByText('Database unavailable').closest('[role="alert"]')
    expect(failure).not.toBeNull()
    expect(within(failure as HTMLElement).getByText("Couldn't load this week")).toBeInTheDocument()
    expect(screen.queryByText('No takings for this week')).not.toBeInTheDocument()
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
          prepared_by_user_id: 'user-1',
          approved_by_user_id: null,
          created_by_user_id: 'user-1',
          updated_by_user_id: 'user-1',
          created_at: '',
          updated_at: '',
          cashup_payment_breakdowns: [],
          cashup_cash_counts: [],
          cashup_sales_breakdowns: [],
        }}
      />
    )

    // Approve is a header action: PageLayout renders it in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0])

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
          prepared_by_user_id: 'user-1',
          approved_by_user_id: null,
          created_by_user_id: 'user-1',
          updated_by_user_id: 'user-1',
          created_at: '',
          updated_at: '',
          cashup_payment_breakdowns: [],
          cashup_cash_counts: [],
          cashup_sales_breakdowns: [],
        }}
      />
    )

    // Delete is a header action: PageLayout renders it in the desktop header and the phone nav row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      expect(deleteSessionActionMock).toHaveBeenCalledWith('session-1')
    })
    expect(routerRefreshMock).toHaveBeenCalled()
  })

  describe('sales and takings gap and Stripe (BK-119, D33)', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      id: 'session-1',
      status: 'draft' as const,
      site_id: 'site-1',
      session_date: '2026-05-24',
      notes: null,
      total_expected_amount: 0,
      total_counted_amount: 0,
      total_variance_amount: 0,
      prepared_by_user_id: 'user-1',
      approved_by_user_id: null,
      created_by_user_id: 'user-1',
      updated_by_user_id: 'user-1',
      created_at: '',
      updated_at: '',
      cashup_payment_breakdowns: [],
      cashup_cash_counts: [],
      cashup_sales_breakdowns: [],
      ...overrides,
    })

    it('has no Stripe field on a new cash-up', () => {
      const { container } = render(<DailyClient {...baseProps} />)
      expect(container.querySelector('#input-stripe-total')).toBeNull()
      expect(screen.queryByText('Stripe')).not.toBeInTheDocument()
    })

    it('keeps a historic Stripe amount on the cash-up that holds one', async () => {
      const { container } = render(
        <DailyClient
          {...baseProps}
          existingSession={session({
            cashup_payment_breakdowns: [
              { id: 'p1', cashup_session_id: 'session-1', payment_type_code: 'STRIPE', payment_type_label: 'Stripe', expected_amount: 12.5, counted_amount: 12.5, variance_amount: 0 },
            ],
          })}
        />
      )
      expect(getInput(container, '#input-stripe-total').value).toBe('12.5')

      fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))

      await waitFor(() => expect(upsertSessionActionMock).toHaveBeenCalledTimes(1))
      expect(upsertSessionActionMock.mock.calls[0][0].paymentBreakdowns).toContainEqual(
        { paymentTypeCode: 'STRIPE', paymentTypeLabel: 'Stripe', expectedAmount: 12.5, countedAmount: 12.5 },
      )
    })

    it('will not submit a gap over £5 between till sales and takings without a note', async () => {
      const { container } = render(<DailyClient {...baseProps} />)
      fireEvent.change(getInput(container, '#input-card-total'), { target: { value: '100' } })
      fireEvent.change(getInput(container, '#input-drinks-sales'), { target: { value: '130' } })

      expect(screen.getAllByText('Till sales are £30.00 more than takings. Say why in the notes before submitting (any gap over £5.00).').length).toBeGreaterThan(0)

      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      expect(toastMock.error).toHaveBeenCalledWith('Till sales are £30.00 more than takings. Say why in the notes before submitting (any gap over £5.00).')
      expect(upsertAndSubmitSessionActionMock).not.toHaveBeenCalled()

      fireEvent.change(getInput(container, '#input-notes'), { target: { value: 'Christening deposit paid by PayPal' } })
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => expect(upsertAndSubmitSessionActionMock).toHaveBeenCalledTimes(1))
      expect(upsertAndSubmitSessionActionMock.mock.calls[0][0]).toMatchObject({ gapNote: 'Christening deposit paid by PayPal' })
    })

    it('shows what was paid outside the till for the day', async () => {
      getCashupDayMoneyActionMock.mockResolvedValue({
        success: true,
        data: {
          tableDeposits: { count: 2, amount: 320 },
          eventTickets: { count: 0, amount: 0 },
          privateHires: [{ id: 'pb-1', label: 'Christening', paidOutsideTill: 744.8 }],
          vouchersRedeemed: { count: 1, amount: 25 },
          total: 1089.8,
        },
      })
      render(<DailyClient {...baseProps} />)

      expect(await screen.findByText('Paid outside the till for this day')).toBeInTheDocument()
      expect(screen.getByText('Table deposits paid online (2 bookings)')).toBeInTheDocument()
      expect(screen.getByText('Private hire: Christening, paid online or by bank')).toBeInTheDocument()
      expect(screen.getByText('£1,089.80')).toBeInTheDocument()
      expect(getCashupDayMoneyActionMock).toHaveBeenCalledWith('2026-05-24')
    })
  })
})

