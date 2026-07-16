import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// The route reads through one chain:
//   from('table_bookings').select(...).eq('booking_date', date).not(...).order(...)
// which resolves to { data, error }.
const queryResult: { data: unknown[] | null; error: unknown } = { data: [], error: null }
const notSpy = vi.fn()
const eqSpy = vi.fn()
const fromSpy = vi.fn()
const selectSpy = vi.fn()

function makeSupabase() {
  return {
    from: (table: string) => {
      fromSpy(table)
      return {
        select: (selectString: string) => {
          selectSpy(selectString)
          const chain: Record<string, unknown> = {
            eq: (column: string, value: string) => {
              eqSpy(column, value)
              return chain
            },
            not: (column: string, operator: string, value: string) => {
              notSpy(column, operator, value)
              return chain
            },
            order: () => Promise.resolve(queryResult),
          }
          return chain
        },
      }
    },
  }
}

vi.mock('@/lib/foh/api-auth', () => ({
  requireBohTableBookingPermission: vi.fn(),
  getLondonDateIso: vi.fn(() => '2026-07-16'),
}))

vi.mock('@/lib/pdf-generator', () => ({
  generatePDFFromHTML: vi.fn(() => Promise.resolve(Buffer.from('%PDF'))),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(() => Promise.resolve()),
}))

// Capture the sheet data handed to the template without rendering real HTML.
const sheetsSpy = vi.fn()
vi.mock('@/lib/table-booking-sheet-template', () => ({
  generateTableBookingSheetsHTML: vi.fn((sheets: unknown[]) => {
    sheetsSpy(sheets)
    return '<html></html>'
  }),
}))

import { GET } from './route'
import { getLondonDateIso, requireBohTableBookingPermission } from '@/lib/foh/api-auth'
import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { logAuditEvent } from '@/app/actions/audit'

type Sheet = {
  bookingRef: string
  customerName: string
  bookingDate: string
  startTime: string
  partySize: string
  tableLabel: string
  status: string
  generatedAt: string
}

function makeRequest(date?: string | null) {
  const url = date
    ? `http://localhost/api/boh/table-bookings/booking-sheets?date=${date}`
    : 'http://localhost/api/boh/table-bookings/booking-sheets'
  return new NextRequest(url, { method: 'GET' })
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    booking_reference: 'ANC-001',
    booking_date: '2026-07-16',
    booking_time: '19:00',
    party_size: 4,
    status: 'confirmed',
    payment_status: null,
    no_show_at: null,
    left_at: null,
    seated_at: null,
    deposit_waived: false,
    paypal_deposit_capture_id: null,
    deposit_amount: null,
    deposit_amount_locked: null,
    is_outside_seating: false,
    customer: { first_name: 'Jo', last_name: 'Bloggs' },
    table_booking_tables: [
      { table: { id: 't1', name: 'Window', table_number: '1', is_bookable: true } },
    ],
    ...overrides,
  }
}

function lastSheets(): Sheet[] {
  return sheetsSpy.mock.calls.at(-1)?.[0] as Sheet[]
}

beforeEach(() => {
  vi.clearAllMocks()
  queryResult.data = []
  queryResult.error = null
  vi.mocked(getLondonDateIso).mockReturnValue('2026-07-16')
  vi.mocked(generatePDFFromHTML).mockResolvedValue(Buffer.from('%PDF'))
  vi.mocked(requireBohTableBookingPermission).mockResolvedValue({
    ok: true,
    userId: 'user-1',
    supabase: makeSupabase(),
  } as unknown as Awaited<ReturnType<typeof requireBohTableBookingPermission>>)
})

describe('GET /api/boh/table-bookings/booking-sheets', () => {
  it('returns a PDF with download headers for a day with bookings', async () => {
    queryResult.data = [
      makeRow({ id: 'b1', booking_reference: 'ANC-001', booking_time: '18:00' }),
      makeRow({ id: 'b2', booking_reference: 'ANC-002', booking_time: '19:00' }),
      makeRow({ id: 'b3', booking_reference: 'ANC-003', booking_time: '20:00' }),
    ]

    const res = await GET(makeRequest('2026-07-16'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="table-bookings-2026-07-16.pdf"'
    )
    expect(res.headers.get('cache-control')).toBe('no-store, private, must-revalidate')
    expect(lastSheets()).toHaveLength(3)
    // Terminal states are excluded via the proven quoted in-list — a malformed
    // in-list fails open in PostgREST and would silently print cancelled bookings.
    expect(notSpy).toHaveBeenCalledWith('status', 'in', '("cancelled","no_show")')
  })

  it('returns 404 with an explanatory body when the day has no printable bookings', async () => {
    queryResult.data = []

    const res = await GET(makeRequest('2026-07-16'))

    expect(res.status).toBe(404)
    expect(await res.text()).toBe('No printable bookings found for the selected day')
    expect(generatePDFFromHTML).not.toHaveBeenCalled()
  })

  it('returns the auth response unchanged and reads nothing when permission is denied', async () => {
    vi.mocked(requireBohTableBookingPermission).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as unknown as Awaited<ReturnType<typeof requireBohTableBookingPermission>>)

    const res = await GET(makeRequest('2026-07-16'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(fromSpy).not.toHaveBeenCalled()
    expect(generatePDFFromHTML).not.toHaveBeenCalled()
  })

  it('maps the visual state, never the raw DB status', async () => {
    queryResult.data = [
      // Deposit-pending: confirmed + payment_status pending + party size over the deposit threshold.
      makeRow({
        id: 'b1',
        booking_reference: 'ANC-001',
        booking_time: '18:00',
        status: 'confirmed',
        payment_status: 'pending',
        party_size: 12,
      }),
      makeRow({
        id: 'b2',
        booking_reference: 'ANC-002',
        booking_time: '19:00',
        status: 'confirmed',
        seated_at: '2026-07-16T18:05:00Z',
      }),
      makeRow({ id: 'b3', booking_reference: 'ANC-003', booking_time: '20:00' }),
    ]

    await GET(makeRequest('2026-07-16'))

    const sheets = lastSheets()
    expect(sheets[0].status).toBe('Pending payment')
    expect(sheets[1].status).toBe('Seated')
    expect(sheets[2].status).toBe('Booked')
  })

  it('de-dups assigned tables by id and orders them by table_number, not by label', async () => {
    // Real-shaped fixtures: every row in the live `tables` table has a prose `name`
    // (table_number 6 is "High 4", 10 is "Dining Room 6a"), so the label is NEVER a digit.
    // Sorting by label would give the alphabetical "Dining Room 6a, High 4"; the BOH screen
    // orders by table_number, so the sheet must read "High 4, Dining Room 6a" to match.
    queryResult.data = [
      makeRow({
        table_booking_tables: [
          { table: { id: 't10', name: 'Dining Room 6a', table_number: '10', is_bookable: true } },
          { table: { id: 't6', name: 'High 4', table_number: '6', is_bookable: true } },
          // Duplicate assignment of the same table must not double up.
          { table: { id: 't6', name: 'High 4', table_number: '6', is_bookable: true } },
        ],
      }),
    ]

    await GET(makeRequest('2026-07-16'))

    const sheets = lastSheets()
    expect(sheets).toHaveLength(1)
    expect(sheets[0].tableLabel).toBe('High 4, Dining Room 6a')
  })

  it('orders table_numbers numerically rather than lexically (6 before 10)', async () => {
    // Guards the Intl numeric collator: a plain string sort would put "10" before "6".
    queryResult.data = [
      makeRow({
        table_booking_tables: [
          { table: { id: 't10', name: 'Ten', table_number: '10', is_bookable: true } },
          { table: { id: 't6', name: 'Six', table_number: '6', is_bookable: true } },
        ],
      }),
    ]

    await GET(makeRequest('2026-07-16'))

    expect(lastSheets()[0].tableLabel).toBe('Six, Ten')
  })

  it('selects exactly the columns the sheet needs and never the sensitive ones', async () => {
    // The select string is otherwise untested: a dropped visual-state column silently mislabels
    // status, a typo'd FK pin is a hard PostgREST 500 in prod, and re-adding special_requirements
    // would breach the "notes are never printed" decision (spec D-3 / §9) — all with green tests.
    await GET(makeRequest('2026-07-16'))

    const select = selectSpy.mock.calls[0][0] as string

    // All 10 columns read by getTableBookingVisualState / hasPendingRequiredDepositSignal.
    for (const column of [
      'status',
      'payment_status',
      'no_show_at',
      'left_at',
      'seated_at',
      'party_size',
      'deposit_waived',
      'paypal_deposit_capture_id',
      'deposit_amount',
      'deposit_amount_locked',
    ]) {
      expect(select).toContain(column)
    }
    // Plus the sheet's own fields.
    for (const column of ['id', 'booking_reference', 'booking_date', 'booking_time', 'is_outside_seating']) {
      expect(select).toContain(column)
    }
    // Pinned FK constraints — verified to exist in the live database.
    expect(select).toContain('customers!table_bookings_customer_id_fkey')
    expect(select).toContain('booking_table_assignments!booking_table_assignments_table_booking_id_fkey')
    expect(select).toContain('tables!booking_table_assignments_table_id_fkey')

    // Never selected.
    expect(select).not.toContain('special_requirements')
    expect(select).not.toContain('is_private_block')
  })

  it('reports Unassigned when the only assignment is a non-bookable table', async () => {
    queryResult.data = [
      makeRow({
        table_booking_tables: [
          { table: { id: 't1', name: 'Bar', table_number: '1', is_bookable: false } },
        ],
      }),
    ]

    await GET(makeRequest('2026-07-16'))

    expect(lastSheets()[0].tableLabel).toBe('Unassigned')
  })

  it('reports Outside for an outside booking even with a stray indoor assignment', async () => {
    queryResult.data = [
      makeRow({
        is_outside_seating: true,
        table_booking_tables: [
          { table: { id: 't1', name: 'Window', table_number: '1', is_bookable: true } },
        ],
      }),
    ]

    await GET(makeRequest('2026-07-16'))

    expect(lastSheets()[0].tableLabel).toBe('Outside')
  })

  it('orders equal booking times deterministically by reference', async () => {
    queryResult.data = [
      makeRow({ id: 'b3', booking_reference: 'ANC-003', booking_time: '19:00' }),
      makeRow({ id: 'b1', booking_reference: 'ANC-001', booking_time: '19:00' }),
      makeRow({ id: 'b2', booking_reference: 'ANC-002', booking_time: '19:00' }),
    ]

    await GET(makeRequest('2026-07-16'))

    expect(lastSheets().map((sheet) => sheet.bookingRef)).toEqual(['ANC-001', 'ANC-002', 'ANC-003'])
  })

  it('falls back to today (London) when no date is supplied', async () => {
    queryResult.data = [makeRow()]

    const res = await GET(makeRequest())

    expect(res.status).toBe(200)
    expect(eqSpy).toHaveBeenCalledWith('booking_date', '2026-07-16')
    expect(res.headers.get('content-disposition')).toContain('table-bookings-2026-07-16.pdf')
  })

  it('returns 400 for a present-but-invalid date and reads nothing', async () => {
    const res = await GET(makeRequest('2026-13-45'))

    expect(res.status).toBe(400)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('returns 404 for a valid date with an empty day', async () => {
    queryResult.data = []

    const res = await GET(makeRequest('2026-07-17'))

    expect(res.status).toBe(404)
    expect(eqSpy).toHaveBeenCalledWith('booking_date', '2026-07-17')
  })

  it('returns 422 without generating a PDF when the day exceeds the row cap', async () => {
    queryResult.data = Array.from({ length: 201 }, (_unused, index) =>
      makeRow({ id: `b${index}`, booking_reference: `ANC-${index}` })
    )

    const res = await GET(makeRequest('2026-07-16'))

    expect(res.status).toBe(422)
    expect(generatePDFFromHTML).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('returns 500 when the database read fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    queryResult.data = null
    queryResult.error = new Error('boom')

    const res = await GET(makeRequest('2026-07-16'))

    expect(res.status).toBe(500)
    expect(generatePDFFromHTML).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('audits the export once with the date and count, and no customer names', async () => {
    queryResult.data = [
      makeRow({ id: 'b1', booking_reference: 'ANC-001', booking_time: '18:00' }),
      makeRow({ id: 'b2', booking_reference: 'ANC-002', booking_time: '19:00' }),
    ]

    await GET(makeRequest('2026-07-16'))

    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    expect(logAuditEvent).toHaveBeenCalledWith({
      user_id: 'user-1',
      operation_type: 'export',
      resource_type: 'table_booking_sheets',
      operation_status: 'success',
      additional_info: { date: '2026-07-16', count: 2 },
    })
  })

  it('falls back to the reference, then a generic label, when the guest has no name', async () => {
    queryResult.data = [
      makeRow({ id: 'b1', booking_reference: 'ANC-001', booking_time: '18:00', customer: null }),
      makeRow({ id: 'b2', booking_reference: '', booking_time: '19:00', customer: [] }),
    ]

    await GET(makeRequest('2026-07-16'))

    const sheets = lastSheets()
    expect(sheets[0].customerName).toBe('ANC-001')
    expect(sheets[1].customerName).toBe('Walk-in guest')
  })
})
