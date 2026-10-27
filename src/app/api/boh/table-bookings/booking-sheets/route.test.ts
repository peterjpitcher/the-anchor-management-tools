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

// The pre-order tables are service-role only, so the route reads them through the admin client after
// permission has been proven. Both chains it uses are covered: covers are ordered, selections are not.
const preorderState: {
  enabled: boolean
  covers: Record<string, unknown>[]
  selections: Record<string, unknown>[]
  menuItems: Record<string, unknown>[]
  periods: Record<string, unknown>[]
} = { enabled: false, covers: [], selections: [], menuItems: [], periods: [] }

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => {
        const rows =
          table === 'booking_preorder_covers'
            ? preorderState.covers
            : table === 'booking_period_menu_items'
              ? preorderState.menuItems
              : table === 'booking_periods'
                ? preorderState.periods
                : preorderState.selections
        const result = { data: rows, error: null }
        const chain = {
          in: () => chain,
          order: () => Promise.resolve(result),
          then: (resolve: (value: typeof result) => unknown) =>
            Promise.resolve(result).then(resolve),
        }
        return chain
      },
    }),
  }),
}))

vi.mock('@/lib/table-bookings/preorder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/table-bookings/preorder')>(
    '@/lib/table-bookings/preorder'
  )
  return { ...actual, isPreorderEnabled: vi.fn(async () => preorderState.enabled) }
})

// The day's private hires print on the sheets too (BK-075). None by default.
const dayLoadState: { hires: Record<string, unknown>[]; fail: boolean } = { hires: [], fail: false }
vi.mock('@/services/day-load', () => ({
  loadDayLoads: vi.fn(async (date: string) => {
    if (dayLoadState.fail) throw new Error('timeout')
    return new Map([[date, { date, privateHires: dayLoadState.hires }]])
  }),
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
  requirements: string[]
  generatedAt: string
  preorder?: {
    allergies: string[]
    covers: Array<{
      seatLabel: string
      courses: Array<{ courseLabel: string; itemName: string }>
      dietaryNote: string | null
    }>
  }
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
    high_chair_count: 0,
    requires_accessible_table: false,
    allergies: null,
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
  preorderState.enabled = false
  preorderState.covers = []
  preorderState.selections = []
  preorderState.menuItems = []
  preorderState.periods = []
  dayLoadState.hires = []
  dayLoadState.fail = false
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

  // BK-075 (reversing spec decision D-4): the kitchen sees a catered party on its sheets.
  it('prints each private hire in time order among the bookings, with its rooms, guests and catering', async () => {
    queryResult.data = [
      makeRow({ id: 'b1', booking_reference: 'ANC-001', booking_time: '18:00' }),
      makeRow({ id: 'b2', booking_reference: 'ANC-002', booking_time: '20:00' }),
    ]
    dayLoadState.hires = [{
      id: 'a1b2c3d4-0000-0000-0000-000000000001', customerName: 'Sam Party', status: 'confirmed',
      startTime: '19:00', endTime: '23:30', guestCount: 40, roomNames: ['The Dining Room'], holdsRoom: true,
      catering: ['Finger Buffet x 40'], kitchen: { covers: 40, foodTime: '19:30' },
    }]

    await GET(makeRequest('2026-07-16'))

    const sheets = lastSheets()
    expect(sheets.map((sheet) => sheet.bookingRef)).toEqual(['ANC-001', 'PB-A1B2C3D4', 'ANC-002'])
    expect(sheets[1]).toMatchObject({
      customerName: 'Sam Party',
      startTime: '7pm to 11:30pm',
      partySize: '40',
      tableLabel: 'Private hire: The Dining Room',
      status: 'Private hire, confirmed',
      requirements: ['Finger Buffet x 40', 'Kitchen: 40 covers at 7:30pm'],
    })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      additional_info: { date: '2026-07-16', count: 3, private_hires: 1 },
    }))
  })

  it('prints a day with only a private hire, and says so when the hires cannot be read', async () => {
    dayLoadState.hires = [{
      id: 'a1b2c3d4-0000-0000-0000-000000000002', customerName: 'No Room Party', status: 'draft',
      startTime: null, endTime: null, guestCount: null, roomNames: [], holdsRoom: false, catering: [], kitchen: null,
    }]
    expect((await GET(makeRequest('2026-07-16'))).status).toBe(200)
    expect(lastSheets()[0]).toMatchObject({
      tableLabel: 'Private hire: no room booked', partySize: 'Not set', startTime: 'Time not set',
      status: 'Private hire, not confirmed', requirements: ['No catering booked'],
    })

    dayLoadState.fail = true
    queryResult.data = [makeRow()]
    expect((await GET(makeRequest('2026-07-16'))).status).toBe(200)
    expect(lastSheets()[0].customerName).toBe('Private hires could not be loaded')
    expect(lastSheets()).toHaveLength(2)
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
        party_size: 16,
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

    // All 11 columns read by getTableBookingVisualState / hasPendingRequiredDepositSignal.
    // booking_type matters because a Christmas booking owes a deposit at any
    // party size, so dropping it would mislabel a Christmas party of 6.
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
      'booking_type',
    ]) {
      expect(select).toContain(column)
    }
    // Plus the sheet's own fields.
    for (const column of [
      'id',
      'booking_reference',
      'booking_date',
      'booking_time',
      'is_outside_seating',
      'high_chair_count',
      'requires_accessible_table',
    ]) {
      expect(select).toContain(column)
    }
    // Pinned FK constraints — verified to exist in the live database.
    expect(select).toContain('customers!table_bookings_customer_id_fkey')
    expect(select).toContain('booking_table_assignments!booking_table_assignments_table_booking_id_fkey')
    expect(select).toContain('tables!booking_table_assignments_table_id_fkey')

    // The Christmas tiers come from the booking, not from cover rows (BK-058).
    expect(select).toContain('christmas_course_counts')

    // The guest's notes and dietary needs print beside the allergies, marked confidential: owner
    // decision D6 (BK-052) reversed spec D-3 because allergies mostly arrive in the notes.
    expect(select).toContain('special_requirements')
    expect(select).toContain('dietary_requirements')
    expect(select).toContain('allergies')

    // Never selected: the staff-only note stays off the printed sheet.
    expect(select).not.toContain('internal_notes')
    expect(select).not.toContain('is_private_block')
  })

  it("prints a booking's notes, allergies and dietary needs, and leaves a booking with none unchanged", async () => {
    queryResult.data = [
      makeRow({ id: 'b1', booking_reference: 'ANC-001' }),
      makeRow({
        id: 'b2',
        booking_reference: 'ANC-002',
        special_requirements: '  Coeliac, please no bread  ',
        dietary_requirements: ['Vegetarian'],
        allergies: [],
      }),
    ]

    await GET(makeRequest('2026-07-16'))

    const sheets = lastSheets() as Array<Sheet & { guestNotes?: unknown }>
    expect(sheets.find((sheet) => sheet.bookingRef === 'ANC-001')?.guestNotes).toBeUndefined()
    expect(sheets.find((sheet) => sheet.bookingRef === 'ANC-002')?.guestNotes).toEqual({
      allergies: [],
      dietary: ['Vegetarian'],
      notes: 'Coeliac, please no bread',
    })
  })

  it('maps step-free and high-chair needs onto the sheet, step-free first', async () => {
    queryResult.data = [
      makeRow({ id: 'b1', booking_reference: 'ANC-001' }),
      makeRow({
        id: 'b2',
        booking_reference: 'ANC-002',
        requires_accessible_table: true,
        high_chair_count: 2,
      }),
      makeRow({ id: 'b3', booking_reference: 'ANC-003', high_chair_count: 1 }),
    ]

    await GET(makeRequest('2026-07-16'))

    const sheets = lastSheets()
    expect(sheets[0].requirements).toEqual([])
    expect(sheets[1].requirements).toEqual(['Step-free table', 'High chair ×2'])
    expect(sheets[2].requirements).toEqual(['High chair ×1'])
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
      additional_info: { date: '2026-07-16', count: 2, private_hires: 0 },
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

  describe('seasonal pre-orders', () => {
    function coverRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'c1',
        table_booking_id: 'b1',
        ordinal: 1,
        guest_name: null,
        dietary_note: null,
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T10:00:00Z',
        ...overrides,
      }
    }

    function selectionRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 's1',
        cover_id: 'c1',
        course: 'main',
        menu_item_id: 'm1',
        item_name: 'Roast turkey',
        price_gbp: '24.95',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T10:00:00Z',
        ...overrides,
      }
    }

    it('attaches no pre-order block while the feature is switched off', async () => {
      preorderState.enabled = false
      preorderState.covers = [coverRow()]
      queryResult.data = [makeRow({ id: 'b1' })]

      await GET(makeRequest('2026-07-16'))

      expect(lastSheets()[0].preorder).toBeUndefined()
    })

    it('attaches no pre-order block to a booking that has no covers', async () => {
      preorderState.enabled = true
      preorderState.covers = [coverRow({ id: 'c9', table_booking_id: 'b2' })]
      queryResult.data = [
        makeRow({ id: 'b1', booking_reference: 'ANC-001', booking_time: '18:00' }),
        makeRow({ id: 'b2', booking_reference: 'ANC-002', booking_time: '19:00' }),
      ]

      await GET(makeRequest('2026-07-16'))

      const sheets = lastSheets()
      expect(sheets[0].preorder).toBeUndefined()
      expect(sheets[1].preorder?.covers).toHaveLength(1)
    })

    it('builds a seat per cover, labelled with the guest name when one was given', async () => {
      preorderState.enabled = true
      preorderState.covers = [
        coverRow({ id: 'c1', ordinal: 1, guest_name: 'Jo Bloggs' }),
        coverRow({ id: 'c2', ordinal: 2, guest_name: null }),
      ]
      preorderState.selections = [
        selectionRow({ id: 's1', cover_id: 'c1', course: 'main', item_name: 'Roast turkey' }),
        selectionRow({ id: 's2', cover_id: 'c1', course: 'starter', item_name: 'Parsnip soup' }),
        selectionRow({ id: 's3', cover_id: 'c2', course: 'main', item_name: 'Nut roast' }),
      ]
      queryResult.data = [makeRow({ id: 'b1' })]

      await GET(makeRequest('2026-07-16'))

      const preorder = lastSheets()[0].preorder
      expect(preorder?.covers.map((cover) => cover.seatLabel)).toEqual([
        'Seat 1 · Jo Bloggs',
        'Seat 2',
      ])
      // Starter before main regardless of the order the rows came back in.
      expect(preorder?.covers[0].courses).toEqual([
        { courseLabel: 'Starter', itemName: 'Parsnip soup' },
        { courseLabel: 'Main', itemName: 'Roast turkey' },
      ])
    })

    // BK-058: the kitchen sheet follows each guest's Christmas tier.
    it('prints each seat tier, a 1 course seat as choosing on the day, and flags a withdrawn dish', async () => {
      preorderState.enabled = true
      preorderState.covers = [
        coverRow({ id: 'c1', ordinal: 1 }),
        coverRow({ id: 'c2', ordinal: 2 }),
        coverRow({ id: 'c3', ordinal: 3 }),
      ]
      preorderState.selections = [
        selectionRow({ id: 's1', cover_id: 'c1', course: 'main', menu_item_id: 'm1', item_name: 'Fixture main' }),
        selectionRow({ id: 's2', cover_id: 'c2', course: 'main', menu_item_id: 'm2', item_name: 'Withdrawn main' }),
      ]
      preorderState.menuItems = [
        { id: 'm1', is_active: true },
        { id: 'm2', is_active: false },
      ]
      queryResult.data = [
        makeRow({ id: 'b1', party_size: 4, booking_type: 'christmas', christmas_course_counts: [3, 2, 1, 1] }),
      ]

      await GET(makeRequest('2026-07-16'))

      const sheet = lastSheets()[0] as Sheet & { christmasCourses?: string }
      const covers = sheet.preorder?.covers as Array<{
        tierLabel?: string
        choosesOnTheDay?: boolean
        courses: Array<{ itemName: string; withdrawn?: boolean }>
      }>
      expect(covers.map((cover) => cover.tierLabel)).toEqual(['3 courses', '2 courses', '1 course'])
      expect(covers[2].choosesOnTheDay).toBe(true)
      expect(covers[0].courses[0].withdrawn).toBeUndefined()
      expect(covers[1].courses[0]).toEqual(expect.objectContaining({ itemName: 'Withdrawn main', withdrawn: true }))
      expect(sheet.christmasCourses).toBe('1 x 3 courses, 1 x 2 courses, 2 x 1 course')
    })

    // BK-051: a seat a manager changed after the noon cutoff is marked for the kitchen.
    it('marks a seat whose choice was recorded after the cutoff, and only that seat', async () => {
      preorderState.enabled = true
      preorderState.periods = [{ id: 'period-1', preorder_cutoff_days: 7 }]
      preorderState.covers = [coverRow({ id: 'c1', ordinal: 1 }), coverRow({ id: 'c2', ordinal: 2 })]
      preorderState.selections = [
        // Before noon on 5 December, the cutoff for a 12 December booking.
        selectionRow({ id: 's1', cover_id: 'c1', created_at: '2026-12-05T11:59:00Z' }),
        // After it: a manager's late change.
        selectionRow({ id: 's2', cover_id: 'c2', created_at: '2026-12-06T09:00:00Z' }),
      ]
      queryResult.data = [makeRow({ id: 'b1', booking_date: '2026-12-12', booking_period_id: 'period-1' })]

      await GET(makeRequest('2026-12-12'))

      const covers = lastSheets()[0].preorder?.covers as Array<{ lateChange?: boolean }>
      expect(covers.map((cover) => cover.lateChange)).toEqual([undefined, true])
    })

    it('gives an all 1 course Christmas booking its tiers even though it has no seats', async () => {
      preorderState.enabled = true
      queryResult.data = [
        makeRow({ id: 'b1', party_size: 4, booking_type: 'christmas', christmas_course_counts: [1, 1, 1, 1] }),
        makeRow({ id: 'b2', booking_reference: 'ANC-002', booking_time: '20:00', booking_type: 'christmas', christmas_course_counts: null }),
        makeRow({ id: 'b3', booking_reference: 'ANC-003', booking_time: '21:00', booking_type: 'regular' }),
      ]

      await GET(makeRequest('2026-07-16'))

      const sheets = lastSheets() as Array<Sheet & { christmasCourses?: string }>
      expect(sheets[0].preorder).toBeUndefined()
      expect(sheets[0].christmasCourses).toBe('4 x 1 course')
      expect(sheets[1].christmasCourses).toBe('Not recorded')
      expect(sheets[2].christmasCourses).toBeUndefined()
    })

    // Spec section 6 item 3: losing either allergy source is the worst regression this feature has.
    it('carries the booking allergy list and the per-seat dietary note together', async () => {
      preorderState.enabled = true
      preorderState.covers = [coverRow({ dietary_note: 'No dairy please' })]
      preorderState.selections = [selectionRow()]
      queryResult.data = [makeRow({ id: 'b1', allergies: ['Nuts', 'Shellfish'] })]

      await GET(makeRequest('2026-07-16'))

      const preorder = lastSheets()[0].preorder
      expect(preorder?.allergies).toEqual(['Nuts', 'Shellfish'])
      expect(preorder?.covers[0].dietaryNote).toBe('No dairy please')
    })

    it('treats a null allergy column as an empty list rather than dropping the block', async () => {
      preorderState.enabled = true
      preorderState.covers = [coverRow()]
      preorderState.selections = [selectionRow()]
      queryResult.data = [makeRow({ id: 'b1', allergies: null })]

      await GET(makeRequest('2026-07-16'))

      expect(lastSheets()[0].preorder?.allergies).toEqual([])
    })
  })
})
