import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { SeasonalPeriods } from '@/app/(authenticated)/settings/table-bookings/SeasonalPeriods'
import {
  LARGE_GROUP_DEPOSIT_PER_PERSON_GBP,
  LARGE_GROUP_DEPOSIT_THRESHOLD,
} from '@/lib/table-bookings/deposit'
import { formatGbp, type BookingPeriodRow } from '@/lib/table-bookings/periods'

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: vi.fn(), error: vi.fn() },
}))

/**
 * The seasonal period editor previews what a few party sizes would pay, and names the group rule
 * when it beats the period's own deposit. That wording said "10-plus" for weeks after the threshold
 * rose to 15, and the preview's largest example party (a hard-coded 12) had stopped reaching the
 * group rule at all. Both now come from LARGE_GROUP_DEPOSIT_THRESHOLD in deposit.ts. These tests fail
 * if either the wording or the example size goes back to a number of its own.
 */

const DEPOSIT_MODULE = '@/lib/table-bookings/deposit'

// Below the group rate, so at the threshold the group deposit is the larger one and the preview has
// to name it.
const PERIOD_RATE_GBP = 5

const PERIOD_ROW: BookingPeriodRow = {
  id: 'period-1',
  code: 'test-period',
  period_kind: 'other',
  name: 'Test period',
  starts_on: '2027-03-07',
  ends_on: '2027-03-07',
  guest_question: 'Are you joining us for the test period?',
  guest_blurb: null,
  requires_preorder: false,
  preorder_cutoff_days: 7,
  deposit_basis: 'per_head',
  deposit_amount: PERIOD_RATE_GBP,
  refund_cutoff_days: 7,
  min_party_size: null,
  max_party_size: null,
  min_notice_hours: 0,
  legacy_booking_type: null,
  is_active: false,
  archived_at: null,
  menu_ready: true,
  booking_count: 0,
  menu_items: [],
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

function stubSettingsApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/settings/table-bookings/periods') {
        return jsonResponse({ data: [PERIOD_ROW] })
      }
      if (url === '/api/settings/table-bookings/allocation') {
        return jsonResponse({
          data: {
            settings: { booking_period_deposits_enabled: { value: true } },
            revisions: { deposits: 1 },
          },
        })
      }
      throw new Error(`Unexpected fetch in test: ${url}`)
    }),
  )
}

/** Renders the settings panel, opens the saved period for editing and returns its deposit preview. */
async function openDepositPreview(Panel: ComponentType): Promise<HTMLElement> {
  stubSettingsApi()
  render(<Panel />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const heading = screen.getByText('What guests would pay')
  return heading.parentElement as HTMLElement
}

function groupRuleLine(threshold: number): string {
  const groupDeposit = formatGbp(threshold * LARGE_GROUP_DEPOSIT_PER_PERSON_GBP)
  return `A party of ${threshold} pays ${groupDeposit} (the ${threshold}-plus group rule is larger).`
}

describe('SeasonalPeriods deposit preview', () => {
  afterEach(() => {
    vi.doUnmock(DEPOSIT_MODULE)
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('names the group rule by the threshold in deposit.ts, at a party of exactly that size', async () => {
    const preview = await openDepositPreview(SeasonalPeriods)

    expect(within(preview).getByText(groupRuleLine(LARGE_GROUP_DEPOSIT_THRESHOLD))).toBeInTheDocument()
    // Parties below the threshold still pay the period's own deposit.
    expect(within(preview).getByText(`A party of 2 pays ${formatGbp(2 * PERIOD_RATE_GBP)} (this period).`)).toBeInTheDocument()
    expect(within(preview).getAllByText('-plus group rule is larger', { exact: false })).toHaveLength(1)
  })

  it('moves with the constant, so the wording cannot drift from the rule again', async () => {
    const moved = LARGE_GROUP_DEPOSIT_THRESHOLD + 5
    vi.resetModules()
    vi.doMock(DEPOSIT_MODULE, async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/table-bookings/deposit')>()),
      LARGE_GROUP_DEPOSIT_THRESHOLD: moved,
    }))
    const { SeasonalPeriods: WithMovedThreshold } = await import(
      '@/app/(authenticated)/settings/table-bookings/SeasonalPeriods'
    )

    const preview = await openDepositPreview(WithMovedThreshold)

    expect(within(preview).getByText(groupRuleLine(moved))).toBeInTheDocument()
    expect(
      within(preview).queryByText(`the ${LARGE_GROUP_DEPOSIT_THRESHOLD}-plus`, { exact: false }),
    ).toBeNull()
    expect(
      within(preview).queryByText(`A party of ${LARGE_GROUP_DEPOSIT_THRESHOLD} pays`, { exact: false }),
    ).toBeNull()
  })
})
