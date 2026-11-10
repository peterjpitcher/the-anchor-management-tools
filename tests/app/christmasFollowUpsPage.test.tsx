// The "Christmas follow-ups" tab under table bookings (Christmas funnel spec, owner decision 7):
// the same permissions as the awaiting-confirmation call list. table_bookings view to see the
// list, edit to mark a guest called; the FOH kiosk login keeps its own page.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChristmasFollowUpItem } from '@/lib/table-bookings/christmas-follow-up-list'

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  permissions: [] as Array<{ module_name: string; action: string }>,
}))
const { listChristmasFollowUps, markChristmasLeadCalled } = vi.hoisted(() => ({
  listChristmasFollowUps: vi.fn(),
  markChristmasLeadCalled: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/table-bookings/christmas-follow-ups',
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async (module: string, action: string) => state.granted.has(`${module}:${action}`)),
  getUserPermissions: vi.fn(async () => ({ success: true, data: state.permissions })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/table-bookings/christmas-follow-up-list', () => ({ listChristmasFollowUps }))
vi.mock('@/app/actions/christmas-follow-ups', () => ({ markChristmasLeadCalled }))

import ChristmasFollowUpsPage from '@/app/(authenticated)/table-bookings/christmas-follow-ups/page'

const ITEM: ChristmasFollowUpItem = {
  leadId: '5d8e7f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  source: 'website',
  guestName: 'Sam Example',
  phone: '+447700900123',
  email: 'sam@example.com',
  bookingDate: '2026-12-15',
  bookingTime: '12:00',
  partySize: 12,
  startedAt: '2026-11-19T15:00:00.000Z',
  followUpEmail: 'sent',
  followUpSentAt: '2026-11-20T10:00:00.000Z',
  optedOut: false,
  calledAt: null,
  callNote: null,
  bookedSince: false,
}

const STAFF = [
  { module_name: 'table_bookings', action: 'view' },
  { module_name: 'events', action: 'view' },
]

beforeEach(() => {
  vi.clearAllMocks()
  state.permissions = STAFF
  listChristmasFollowUps.mockResolvedValue([ITEM])
  markChristmasLeadCalled.mockResolvedValue({ success: true })
})

describe('Christmas follow-ups page access', () => {
  it('turns away a login without table bookings access, and loads nothing', async () => {
    state.granted = new Set(['reports:view'])

    await expect(ChristmasFollowUpsPage()).rejects.toThrow('NEXT_REDIRECT /unauthorized')
    expect(listChristmasFollowUps).not.toHaveBeenCalled()
  })

  it('sends the FOH kiosk login to its own page', async () => {
    state.granted = new Set(['table_bookings:view'])
    state.permissions = [{ module_name: 'table_bookings', action: 'view' }]

    await expect(ChristmasFollowUpsPage()).rejects.toThrow('NEXT_REDIRECT /table-bookings/foh')
    expect(listChristmasFollowUps).not.toHaveBeenCalled()
  })

  it('shows the list to view, with tap-to-call, and no Mark called without edit', async () => {
    state.granted = new Set(['table_bookings:view'])

    render(await ChristmasFollowUpsPage())

    expect(screen.getByText('Sam Example')).toBeTruthy()
    expect(screen.getByText('Tuesday 15 December at 12:00, 12 people')).toBeTruthy()
    expect(screen.getByRole('link', { name: '+447700900123' }).getAttribute('href')).toBe('tel:+447700900123')
    expect(screen.getByText('Follow-up email sent')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark called' })).toBeNull()
    // The tab itself, in the Table Bookings tab row.
    expect(screen.getAllByText('Christmas follow-ups').length).toBeGreaterThan(0)
  })

  it('lets edit mark a guest called with a note', async () => {
    state.granted = new Set(['table_bookings:view', 'table_bookings:edit'])

    render(await ChristmasFollowUpsPage())
    fireEvent.click(screen.getByRole('button', { name: 'Mark called' }))
    fireEvent.change(await screen.findByLabelText('Note (optional)'), { target: { value: 'Rebooking by phone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(markChristmasLeadCalled).toHaveBeenCalledWith({ leadId: ITEM.leadId, note: 'Rebooking by phone' }))
    expect(await screen.findByText('Rebooking by phone')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark called' })).toBeNull()
  })

  it('says so when the list cannot be loaded', async () => {
    state.granted = new Set(['table_bookings:view'])
    listChristmasFollowUps.mockRejectedValue(new Error('statement timeout'))

    render(await ChristmasFollowUpsPage())

    expect(screen.getByText('The list could not be loaded')).toBeTruthy()
  })
})
