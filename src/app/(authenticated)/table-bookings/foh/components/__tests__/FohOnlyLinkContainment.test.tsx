// Containment for the shared till login (23 November 2026). The FOH-only user holds exactly
// table_bookings view/create/edit, checklists view and vouchers view/edit. Everything the floor
// screen can send that user to must be somewhere they are allowed to be: a link to anywhere else
// is a dead end at best (the layout bounces them) and a leak at worst. This renders what they see
// and checks every href against the allowlist.

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserPermission } from '@/types/rbac'
import { isFohOnlyUser } from '@/lib/foh/user-mode'
import { bookingSheetBackButton } from '@/lib/table-bookings/booking-sheet-back'
import type { FohBooking } from '../../types'
import { FohHeader } from '../FohHeader'
import { FohBookingDetailModal } from '../FohBookingDetailModal'
import { FohParkingClient } from '../../parking/FohParkingClient'

const FOH_ONLY_PERMISSIONS = [
  ['table_bookings', 'view'],
  ['table_bookings', 'create'],
  ['table_bookings', 'edit'],
  ['checklists', 'view'],
  ['vouchers', 'view'],
  ['vouchers', 'edit'],
].map(([module_name, action]) => ({ module_name, action })) as unknown as UserPermission[]

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

/** Where the FOH-only user may be sent. */
function isAllowed(href: string): boolean {
  if (href.startsWith('tel:')) return true
  if (href === '/table-bookings/foh' || href.startsWith('/table-bookings/foh/')) return true
  if (href === '/vouchers/foh') return true
  if (href === '/checklists' || href.startsWith('/checklists/')) return !href.startsWith('/checklists/manage')
  return /^\/table-bookings\/[^/]+\/sheet$/.test(href)
}

const hrefsOnScreen = () =>
  Array.from(document.querySelectorAll('a[href]')).map((anchor) => anchor.getAttribute('href') ?? '')

function expectContained(hrefs: string[]) {
  expect(hrefs.length).toBeGreaterThan(0)
  for (const href of hrefs) expect(isAllowed(href), `${href} is outside what the FOH-only user may open`).toBe(true)
}

function booking(): FohBooking {
  return {
    id: BOOKING_ID,
    booking_reference: 'TB-0001',
    guest_name: 'Jo Bloggs',
    guest_phone: '+447700900123',
    booking_time: '19:00',
    party_size: 4,
    booking_type: 'regular',
    booking_purpose: 'food',
    status: 'confirmed',
    notes: null,
    start_datetime: '2026-11-21T19:00:00.000Z',
    end_datetime: '2026-11-21T21:00:00.000Z',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('the shared till login is only ever sent where it may go', () => {
  it('is the FOH-only user the layout fences in, and would stop being one with parking access', () => {
    expect(isFohOnlyUser(FOH_ONLY_PERMISSIONS)).toBe(true)
    expect(isFohOnlyUser([...FOH_ONLY_PERMISSIONS, { module_name: 'parking', action: 'view' } as unknown as UserPermission])).toBe(false)
  })

  it('the allowlist itself refuses the pages that matter', () => {
    for (const href of ['/settings/table-bookings', `/table-bookings/${BOOKING_ID}`, '/table-bookings/boh', '/parking', '/checklists/manage', '/checklists/manage/tasks', '/vouchers', '/dashboard']) {
      expect(isAllowed(href), href).toBe(false)
    }
    for (const href of ['/table-bookings/foh', '/table-bookings/foh/parking', '/checklists', '/checklists/today', '/vouchers/foh', `/table-bookings/${BOOKING_ID}/sheet`, 'tel:+447700900123']) {
      expect(isAllowed(href), href).toBe(true)
    }
  })

  it('toolbar and More menu: every link is inside the fence, and Table Setup is not there', async () => {
    render(
      <FohHeader
        date="2026-11-21"
        setDate={vi.fn()}
        canEdit
        styleVariant="manager_kiosk"
        clockNow={new Date('2026-11-21T19:00:00.000Z')}
        serviceDateNow="2026-11-21"
        totals={{ bookings: 3, covers: 12 }}
        viewMode="inside"
        outsideCount={0}
        onViewModeChange={vi.fn()}
        nextUpcomingEvent={{ id: 'event-1', name: 'Quiz Night', date: '2026-11-25', time: '19:30', start_datetime: null }}
        upcomingEventsLoaded
        submittingFoodOrderAlert={false}
        statusMessage={null}
        errorMessage={null}
        lastInteractionAtMsRef={{ current: 0 }}
        onTimelineZoomChange={vi.fn()}
        // The page offers Table Setup only with settings manage, which this user does not hold.
        canManageSettings={FOH_ONLY_PERMISSIONS.some((permission) => String(permission.module_name) === 'settings')}
        onSendFoodOrderAlert={vi.fn()}
        onOpenCreateModal={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await screen.findByRole('link', { name: 'Parking' })

    const hrefs = hrefsOnScreen()
    expectContained(hrefs)
    expect(hrefs).toEqual(expect.arrayContaining(['/checklists', '/vouchers/foh', '/table-bookings/foh/parking']))
    expect(screen.queryByRole('link', { name: 'Table Setup' })).toBeNull()
    expect(hrefs).not.toContain('/settings/table-bookings')
  })

  it('booking panel: the sheet and the phone number only, never the booking page itself', () => {
    render(
      <FohBookingDetailModal
        selectedBookingContext={{ booking: booking(), laneTableId: 'table-1', laneTableName: 'Table 1' }}
        canEdit
        bookingActionInFlight={null}
        showCancelBookingConfirmation={false}
        selectedMoveTarget=""
        selectedMoveOptions={[]}
        loadingSelectedMoveOptions={false}
        onClose={vi.fn()}
        onRunAction={vi.fn(async () => true)}
        onMoveTargetChange={vi.fn()}
        onSetShowCancelBookingConfirmation={vi.fn()}
        onOpenPartySizeEdit={vi.fn()}
        onOpenWalkoutModal={vi.fn()}
        onOpenChangeTime={vi.fn()}
        now={new Date('2026-11-21T19:20:00.000Z')}
      />
    )

    const hrefs = hrefsOnScreen()
    expectContained(hrefs)
    expect(hrefs.sort()).toEqual([`/table-bookings/${BOOKING_ID}/sheet`, 'tel:+447700900123'].sort())
    expect(hrefs).not.toContain(`/table-bookings/${BOOKING_ID}`)
  })

  it('booking sheet: back goes to the floor screen, not to the booking page', () => {
    const back = bookingSheetBackButton(isFohOnlyUser(FOH_ONLY_PERMISSIONS), BOOKING_ID)

    expect(back).toEqual({ label: 'Back to Front of House', href: '/table-bookings/foh' })
    expectContained([back.href])
    // Anyone else still goes back to the booking.
    expect(bookingSheetBackButton(false, BOOKING_ID).href).toBe(`/table-bookings/${BOOKING_ID}`)
  })

  it('parking view: back to the floor screen and phone numbers only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          today: '2026-11-21',
          arriving_today: [{
            reference: 'PK-1001', guest_name: 'Asha Patel', phone: '+447700900111', vehicle_registration: 'AB12 CDE',
            vehicle_make: null, vehicle_model: null, vehicle_colour: null,
            arrives_at: '2026-11-21T14:00:00.000Z', leaves_at: '2026-11-23T10:00:00.000Z', status: 'confirmed', paid: true,
          }],
          on_site_now: [],
          leaving_today: [],
          coming_up: [],
        },
      }),
    })))
    render(<FohParkingClient />)
    await screen.findByText('Asha Patel')

    const hrefs = hrefsOnScreen()
    expectContained(hrefs)
    expect(hrefs.sort()).toEqual(['/table-bookings/foh', 'tel:+447700900111'].sort())
  })
})
