import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildBookingSheetModel } from '@/lib/table-bookings/booking-sheet'
import { renderBookingOnePager } from '@/lib/table-booking-one-pager-template'
import { bookingFacts, christmasOrder } from '../lib/bookingSheet/fixture'

const mocks = vi.hoisted(() => ({
  moduleAuth: vi.fn(),
  rpc: vi.fn(),
  load: vi.fn(),
  pdf: vi.fn(),
  audit: vi.fn(),
}))

// The real requireBohTableBookingPermission runs, over a mocked module check and permission list,
// so these tests prove the route refuses the FOH login the same way the day sheets route does.
vi.mock('@/lib/api/permissions', () => ({ requireModulePermission: mocks.moduleAuth }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/table-bookings/booking-sheet-load', () => ({ loadBookingSheetModel: mocks.load }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML: mocks.pdf }))
vi.mock('@/lib/pdf/anchor-logo', () => ({ getAnchorLogoDataUri: () => 'data:image/png;base64,iVBORw0KGgo=' }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))

import { GET } from '@/app/api/boh/table-bookings/booking-sheets/[id]/route'

const BOOKING_ID = '11111111-2222-3333-4444-555555555555'

function call(id = BOOKING_ID) {
  return GET(new NextRequest(`http://localhost/api/boh/table-bookings/booking-sheets/${id}`), {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.moduleAuth.mockResolvedValue({ ok: true, userId: 'user-1', supabase: { rpc: mocks.rpc } })
  mocks.load.mockResolvedValue(buildBookingSheetModel({ booking: bookingFacts(), order: christmasOrder() }))
  mocks.pdf.mockResolvedValue(Buffer.from('%PDF'))
  mocks.audit.mockResolvedValue(undefined)
})

describe('GET /api/boh/table-bookings/booking-sheets/[id] (D14)', () => {
  it('refuses the shared FOH login with 403 and renders nothing', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { module_name: 'table_bookings', action: 'view' },
        { module_name: 'checklists', action: 'view' },
      ],
      error: null,
    })

    const response = await call()

    expect(response.status).toBe(403)
    expect(mocks.moduleAuth).toHaveBeenCalledWith('table_bookings', 'view')
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.pdf).not.toHaveBeenCalled()
  })

  it('refuses when the permission list cannot be read (fail closed)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'fetch failed' } })

    const response = await call()

    expect(response.status).toBe(503)
    expect(mocks.pdf).not.toHaveBeenCalled()
  })

  it('passes through a refusal of table_bookings view unchanged', async () => {
    const refusal = new Response('Forbidden', { status: 403 })
    mocks.moduleAuth.mockResolvedValue({ ok: false, response: refusal })

    const response = await call()

    expect(response).toBe(refusal)
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('gives BOH staff the PDF of the same sheet the screen shows', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { module_name: 'table_bookings', action: 'view' },
        { module_name: 'events', action: 'view' },
      ],
      error: null,
    })

    const response = await call()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="booking-TB-FIXTURE.pdf"')
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    const html = mocks.pdf.mock.calls[0][0] as string
    const model = await mocks.load.mock.results[0].value
    // The screen's fragment, rendered for the PDF: same content, compact type, printable.
    const screen = renderBookingOnePager(model, { allowPrint: true })
    for (const fragment of ['Seat 1, Guest One: Peanuts', '3 of 6 chosen, 3 missing', '<th scope="col">Dietary needs</th>']) {
      expect(screen).toContain(fragment)
      expect(html).toContain(fragment)
    }
    expect(html).not.toContain('@media print')
    // Audited without names or allergies.
    const audit = mocks.audit.mock.calls[0][0]
    expect(audit).toEqual(expect.objectContaining({ resource_type: 'table_booking_sheet', resource_id: BOOKING_ID, operation_type: 'export' }))
    expect(JSON.stringify(audit)).not.toContain('Peanuts')
    expect(JSON.stringify(audit)).not.toContain('Guest One')
  })

  it('is 400 for a malformed id and 404 for a booking that does not exist', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ module_name: 'table_bookings', action: 'view' }, { module_name: 'events', action: 'view' }], error: null })

    expect((await call('not-a-uuid')).status).toBe(400)
    mocks.load.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(mocks.pdf).not.toHaveBeenCalled()
  })

  it('is 500, not a partial PDF, when the read fails', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ module_name: 'table_bookings', action: 'view' }, { module_name: 'events', action: 'view' }], error: null })
    mocks.load.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await call()

    expect(response.status).toBe(500)
    expect(mocks.pdf).not.toHaveBeenCalled()
  })
})
