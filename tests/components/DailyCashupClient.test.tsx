import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DailyClient } from '@/app/(authenticated)/cashing-up/daily/_components/DailyClient'

const routerPushMock = vi.hoisted(() => vi.fn())
const upsertSessionActionMock = vi.hoisted(() => vi.fn())
const upsertAndSubmitSessionActionMock = vi.hoisted(() => vi.fn())
const getDailySummaryActionMock = vi.hoisted(() => vi.fn())
const getMissingCashupDatesActionMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}))

vi.mock('@/app/actions/cashing-up', () => ({
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
    const notes = getInput(container, '#input-notes')

    fireEvent.change(cash50, { target: { value: '50' } })
    fireEvent.change(cashExpected, { target: { value: '45' } })
    fireEvent.change(cardTotal, { target: { value: '10' } })
    fireEvent.change(stripeTotal, { target: { value: '5' } })
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
})
