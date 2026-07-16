// Covers the "Download PDF" toolbar button on the BOH table-bookings page:
// day-view gating, focusDate filtering, settled-state gating, blob download and
// the error toasts. The full client is mounted; only the network boundary,
// the download helpers and toast are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BohBookingsClient } from '../BohBookingsClient'

vi.mock('@/lib/download-file', () => ({
  downloadBlob: vi.fn(),
  filenameFromContentDisposition: vi.fn(
    (contentDisposition: string | null, fallback: string) => {
      const match = contentDisposition?.match(/filename="([^"]+)"/i)
      return match?.[1] ?? fallback
    }
  ),
}))

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  })
  return { default: toast, toast }
})

import { downloadBlob } from '@/lib/download-file'
import toast from 'react-hot-toast'

const downloadBlobMock = vi.mocked(downloadBlob)
const toastErrorMock = vi.mocked(toast.error)
const toastSuccessMock = vi.mocked(toast.success)

function todayIso(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value
      return acc
    }, {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

const TODAY = todayIso()
const OTHER_DAY = '2020-01-02'

function makeBooking(bookingDate: string, id = 'booking-1') {
  return {
    id,
    booking_reference: 'TB-001',
    booking_date: bookingDate,
    booking_time: '18:00:00',
    party_size: 4,
    committed_party_size: null,
    booking_type: 'regular',
    booking_purpose: 'dining',
    status: 'confirmed',
    visual_status: 'confirmed',
    special_requirements: null,
    seated_at: null,
    left_at: null,
    no_show_at: null,
    cancelled_at: null,
    cancelled_by: null,
    hold_expires_at: null,
    payment_status: null,
    payment_method: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    deposit_waived: false,
    high_chair_count: null,
    is_outside_seating: false,
    created_at: null,
    updated_at: null,
    customer: {
      id: 'cust-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      mobile_number: '+447700900000',
      sms_status: 'active',
    },
    guest_name: 'Ada Lovelace',
    event_id: null,
    event_name: null,
    assigned_tables: [],
    table_names: ['6'],
    assignment_count: 1,
    start_datetime: null,
    end_datetime: null,
  }
}

type SheetsResponse = {
  ok: boolean
  status: number
  contentType?: string | null
  contentDisposition?: string | null
}

type ListPayload = {
  bookings: ReturnType<typeof makeBooking>[]
  rangeStartDate: string
  rangeEndDate: string
}

function installFetch(options: {
  list?: ListPayload
  sheets?: SheetsResponse
  sheetsThrows?: boolean
}) {
  const list = options.list ?? {
    bookings: [makeBooking(TODAY)],
    rangeStartDate: TODAY,
    rangeEndDate: TODAY,
  }

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.startsWith('/api/boh/table-bookings/booking-sheets')) {
      if (options.sheetsThrows) throw new Error('network down')
      const sheets = options.sheets ?? {
        ok: true,
        status: 200,
        contentType: 'application/pdf',
        contentDisposition: 'attachment; filename="table-bookings-server.pdf"',
      }
      const headers = new Map<string, string | null>([
        ['content-type', sheets.contentType ?? null],
        ['content-disposition', sheets.contentDisposition ?? null],
      ])
      return {
        ok: sheets.ok,
        status: sheets.status,
        headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
        blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
        text: async () => 'error',
      }
    }

    if (url.startsWith('/api/boh/table-bookings')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            view: 'week',
            focus_date: TODAY,
            range_start_date: list.rangeStartDate,
            range_end_date: list.rangeEndDate,
            total: list.bookings.length,
            tables: [],
            bookings: list.bookings,
          },
        }),
      }
    }

    // Anything else the page happens to call (customer search, event options…)
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function downloadButton(): HTMLButtonElement {
  // Queried by its VISIBLE label: the accessible name must match the visible text so that voice
  // control ("click Download PDF") works — WCAG 2.5.3 Label in Name.
  return screen.getByRole('button', { name: 'Download PDF' }) as HTMLButtonElement
}

async function renderClient() {
  const user = userEvent.setup()
  render(<BohBookingsClient canEdit canManage />)
  await waitFor(() => expect(downloadButton()).toBeInTheDocument())
  return user
}

async function switchTo(user: ReturnType<typeof userEvent.setup>, label: 'Day' | 'Week' | 'Month') {
  await user.click(screen.getByRole('button', { name: label }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BohBookingsClient — Download PDF button', () => {
  describe('gating', () => {
    it('should be disabled with an explanatory title when in week view', async () => {
      installFetch({})
      await renderClient()

      await waitFor(() => expect(downloadButton()).toBeDisabled())
      expect(downloadButton()).toHaveAttribute(
        'title',
        "Switch to Day view to print a day's sheets"
      )
    })

    it('should be disabled with an explanatory title when in month view', async () => {
      installFetch({})
      const user = await renderClient()

      await switchTo(user, 'Month')

      await waitFor(() => expect(downloadButton()).toBeDisabled())
      expect(downloadButton()).toHaveAttribute(
        'title',
        "Switch to Day view to print a day's sheets"
      )
    })

    it('should be enabled in day view when the focused day has bookings', async () => {
      installFetch({})
      const user = await renderClient()

      await switchTo(user, 'Day')

      await waitFor(() => expect(downloadButton()).toBeEnabled())
      expect(downloadButton()).not.toHaveAttribute('title')
    })

    it('should be disabled when the loaded range does not cover the focused day', async () => {
      // scheduleSettled === false: the payload's range excludes focusDate, so the
      // rows on screen are not this day's rows even though loading has finished.
      installFetch({
        list: {
          bookings: [makeBooking(TODAY)],
          rangeStartDate: '2999-01-01',
          rangeEndDate: '2999-01-07',
        },
      })
      const user = await renderClient()

      await switchTo(user, 'Day')

      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
      expect(downloadButton()).toBeDisabled()
    })

    it('should be disabled when the focused day has no bookings even though other days do', async () => {
      installFetch({
        list: {
          bookings: [makeBooking(OTHER_DAY)],
          rangeStartDate: TODAY,
          rangeEndDate: TODAY,
        },
      })
      const user = await renderClient()

      await switchTo(user, 'Day')

      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
      expect(downloadButton()).toBeDisabled()
    })

    it('should be disabled when the focused day has only cancelled/no_show bookings', async () => {
      // The list route applies NO status filter, so these rows arrive in `bookings` — but the
      // sheets route excludes them. Counting them would enable the button onto a guaranteed 404.
      installFetch({
        list: {
          bookings: [
            { ...makeBooking(TODAY), id: 'b-cancelled', status: 'cancelled' },
            { ...makeBooking(TODAY), id: 'b-noshow', status: 'no_show' },
          ],
          rangeStartDate: TODAY,
          rangeEndDate: TODAY,
        },
      })
      const user = await renderClient()

      await switchTo(user, 'Day')

      await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
      expect(downloadButton()).toBeDisabled()
    })
  })

  describe('download', () => {
    async function clickDownload() {
      const user = await renderClient()
      await switchTo(user, 'Day')
      await waitFor(() => expect(downloadButton()).toBeEnabled())
      await user.click(downloadButton())
      return user
    }

    it('should download the blob using the server-supplied filename on success', async () => {
      installFetch({})

      await clickDownload()

      await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
      expect(downloadBlobMock.mock.calls[0][0]).toBeInstanceOf(Blob)
      expect(downloadBlobMock.mock.calls[0][1]).toBe('table-bookings-server.pdf')
      expect(toastSuccessMock).toHaveBeenCalledWith(
        `Downloaded booking sheets for ${TODAY}`
      )
    })

    it('should fall back to the client filename when the server sends no Content-Disposition', async () => {
      installFetch({
        sheets: {
          ok: true,
          status: 200,
          contentType: 'application/pdf',
          contentDisposition: null,
        },
      })

      await clickDownload()

      await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1))
      expect(downloadBlobMock.mock.calls[0][1]).toBe(`table-bookings-${TODAY}.pdf`)
    })

    it.each([
      [404, 'No bookings to print for this day'],
      [422, 'Too many bookings to print in one PDF'],
      [401, 'Your session has expired — please sign in again'],
      [403, "You don't have permission to export booking sheets"],
      [500, 'Could not generate the booking sheets'],
    ])('should show a distinct toast and not download on %i', async (status, message) => {
      installFetch({ sheets: { ok: false, status } })

      await clickDownload()

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(message))
      expect(downloadBlobMock).not.toHaveBeenCalled()
    })

    it('should not download when the response is not a PDF', async () => {
      installFetch({
        sheets: {
          ok: true,
          status: 200,
          contentType: 'text/html',
          contentDisposition: 'attachment; filename="oops.html"',
        },
      })

      await clickDownload()

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith('Unexpected response — no PDF was downloaded')
      )
      expect(downloadBlobMock).not.toHaveBeenCalled()
    })

    it('should show a generic toast when the request throws', async () => {
      installFetch({ sheetsThrows: true })

      await clickDownload()

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith('Could not generate the booking sheets')
      )
      expect(downloadBlobMock).not.toHaveBeenCalled()
    })

    it('should re-enable the button after a download completes', async () => {
      installFetch({})

      await clickDownload()

      await waitFor(() => expect(downloadButton()).toBeEnabled())
    })
  })
})
