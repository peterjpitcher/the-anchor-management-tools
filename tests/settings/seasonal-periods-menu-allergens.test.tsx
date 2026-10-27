import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SeasonalPeriods } from '@/app/(authenticated)/settings/table-bookings/SeasonalPeriods'
import type { BookingPeriodRow } from '@/lib/table-bookings/periods'

vi.mock('@/ds/primitives/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

/**
 * BK-060: the 14 Christmas dishes went live with no allergens, and the menu editor could only add a
 * dish, so filling them in meant removing and re-adding each one. A manager can now see which dishes
 * have none and edit a dish in place, keeping its course, price and order.
 */

const PERIOD_ROW: BookingPeriodRow = {
  id: 'period-1',
  code: 'christmas-2026',
  period_kind: 'christmas',
  name: 'Christmas dinner 2026',
  starts_on: '2026-11-10',
  ends_on: '2026-12-20',
  guest_question: 'Are you joining us for Christmas dinner?',
  guest_blurb: null,
  requires_preorder: true,
  preorder_cutoff_days: 7,
  deposit_basis: 'per_head',
  deposit_amount: 10,
  refund_cutoff_days: 7,
  min_party_size: 4,
  max_party_size: 20,
  min_notice_hours: 24,
  legacy_booking_type: null,
  is_active: true,
  archived_at: null,
  menu_ready: true,
  booking_count: 0,
  menu_items: [
    { id: 'dish-1', course: 'main', name: 'Christmas Dinner - Turkey', description: null, price_gbp: null, allergens: null, sort_order: 5, is_active: true },
    { id: 'dish-2', course: 'starter', name: 'Seasonal Soup', description: null, price_gbp: null, allergens: 'Celery', sort_order: 0, is_active: true },
  ],
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('SeasonalPeriods menu allergens', () => {
  it('shows which dishes have none, and saves allergens onto a dish without moving it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/settings/table-bookings/periods') return jsonResponse({ data: [PERIOD_ROW] })
      if (url === '/api/settings/table-bookings/allocation') {
        return jsonResponse({ data: { settings: {}, revisions: { deposits: 1 } } })
      }
      if (url === '/api/settings/table-bookings/periods/menu' && init?.method === 'POST') return jsonResponse({ success: true, id: 'dish-1' })
      throw new Error(`Unexpected fetch in test: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SeasonalPeriods />)
    fireEvent.click(await screen.findByRole('button', { name: 'Menu (2)' }))

    expect(screen.getByText('Allergens: Celery')).toBeInTheDocument()
    expect(screen.getByText('No allergens recorded. Guests are told to check the menu or ask us.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Christmas Dinner - Turkey' }))
    expect(screen.getByLabelText('Dish name')).toHaveValue('Christmas Dinner - Turkey')
    expect(screen.getByLabelText('Course')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Allergens (optional)'), { target: { value: 'Celery, mustard, sulphites' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Dish' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/settings/table-bookings/periods/menu', expect.objectContaining({ method: 'POST' })),
    )
    const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/periods/menu') && init?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      id: 'dish-1',
      sort_order: 5,
      course: 'main',
      name: 'Christmas Dinner - Turkey',
      description: null,
      price_gbp: null,
      allergens: 'Celery, mustard, sulphites',
    })
  })
})
