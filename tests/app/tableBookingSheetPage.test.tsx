import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildBookingSheetModel } from '@/lib/table-bookings/booking-sheet'
import { bookingFacts, christmasOrder } from '../lib/bookingSheet/fixture'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  permissions: vi.fn(),
  load: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))

vi.mock('@/app/actions/rbac', () => ({
  getPermissionStatus: mocks.status,
  getUserPermissions: mocks.permissions,
}))
vi.mock('@/lib/table-bookings/booking-sheet-load', () => ({ loadBookingSheetModel: mocks.load }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, notFound: mocks.notFound }))
vi.mock('@/components/features/shared/PermissionsUnavailable', () => ({
  PermissionsUnavailable: () => <p>Connection problem</p>,
}))
// The shell needs the router; this test is about what the page puts in it.
vi.mock('@/ds', () => ({
  PageLayout: ({ children, headerActions, title }: { children: React.ReactNode; headerActions?: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      <div data-slot="actions">{headerActions}</div>
      {children}
    </main>
  ),
  LinkButton: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  Button: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  Alert: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div role="alert">
      {title}
      {children}
    </div>
  ),
}))

const BOOKING_ID = '11111111-2222-3333-4444-555555555555'
const FOH_LOGIN = [
  { module_name: 'table_bookings', action: 'view' },
  { module_name: 'table_bookings', action: 'edit' },
  { module_name: 'checklists', action: 'view' },
]
const BOH_STAFF = [
  { module_name: 'table_bookings', action: 'view' },
  { module_name: 'events', action: 'view' },
]

async function render(search: { print?: string } = {}): Promise<string> {
  const { default: Page } = await import('@/app/(authenticated)/table-bookings/[id]/sheet/page')
  return renderToStaticMarkup(
    await Page({ params: Promise.resolve({ id: BOOKING_ID }), searchParams: Promise.resolve(search) }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.mockResolvedValue('allowed')
  mocks.load.mockResolvedValue(buildBookingSheetModel({ booking: bookingFacts(), order: christmasOrder() }))
})

describe('/table-bookings/[id]/sheet access (D14)', () => {
  it('lets the shared FOH login view the sheet, with no download and no print', async () => {
    mocks.permissions.mockResolvedValue({ success: true, data: FOH_LOGIN })

    const html = await render()

    expect(html).toContain('Seat 1, Guest One: Peanuts')
    expect(html).not.toContain('Download PDF')
    expect(html).not.toContain('>Print<')
    expect(html).not.toContain('/api/boh/table-bookings/booking-sheets/')
    expect(html).toContain('@media print{ .bs-sheet{ display:none !important; }')
  })

  it('gives the FOH login no print even from a print link', async () => {
    mocks.permissions.mockResolvedValue({ success: true, data: FOH_LOGIN })

    const html = await render({ print: '1' })

    expect(html).not.toContain('>Print<')
    expect(html).toContain('@media print{ .bs-sheet{ display:none !important; }')
  })

  it('offers BOH staff a Print button beside the PDF', async () => {
    mocks.permissions.mockResolvedValue({ success: true, data: BOH_STAFF })

    const html = await render()

    expect(html).toContain('<button type="button">Print</button>')
  })

  it('offers BOH staff the PDF download and leaves printing alone', async () => {
    mocks.permissions.mockResolvedValue({ success: true, data: BOH_STAFF })

    const html = await render()

    expect(html).toContain(`<a href="/api/boh/table-bookings/booking-sheets/${BOOKING_ID}">Download PDF</a>`)
    // Printing is allowed: the only print rule keeps the sheet and drops the page around it.
    expect(html).not.toContain('.bs-sheet{ display:none')
    expect(html).toContain('@media print{ body *{ visibility:hidden; } .bs-sheet, .bs-sheet *{ visibility:visible; } }')
  })

  it('offers no download when the permission list did not load', async () => {
    mocks.permissions.mockResolvedValue({ success: false, error: 'Failed to fetch permissions' })

    const html = await render()

    expect(html).not.toContain('Download PDF')
    expect(html).toContain('@media print')
  })

  it('refuses anyone without table_bookings view before reading the booking', async () => {
    mocks.status.mockResolvedValue('denied')
    mocks.permissions.mockResolvedValue({ success: true, data: [] })

    await expect(render()).rejects.toThrow('REDIRECT:/unauthorized')
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('shows an error rather than a partial sheet when the read fails', async () => {
    mocks.permissions.mockResolvedValue({ success: true, data: BOH_STAFF })
    mocks.load.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const html = await render()

    expect(html).toContain('The sheet could not be loaded')
    expect(html).not.toContain('bs-sheet')
  })

  it('is a 404 for a booking that does not exist', async () => {
    mocks.permissions.mockResolvedValue({ success: true, data: BOH_STAFF })
    mocks.load.mockResolvedValue(null)

    await expect(render()).rejects.toThrow('NOT_FOUND')
  })
})
