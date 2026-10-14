import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * The booking page warns when the contract or the food agreement is still unsigned with the
 * event 14 days away or less (owner, 13 October 2026). A warning only: it carries no buttons,
 * because the signing panel lower on the page has the actions.
 */

const pathname = '/private-bookings/booking-1'
// One router for every render, as Next gives: the pages key their effects on it.
const router = vi.hoisted(() => ({ refresh: () => {}, push: () => {}, replace: () => {} }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/actions/privateBookingActions', () => ({
  getPrivateBooking: vi.fn(async () => ({})),
  updateBookingStatus: vi.fn(),
  recordDepositPayment: vi.fn(),
  recordFinalPayment: vi.fn(),
  addBookingItem: vi.fn(),
  updateBookingItem: vi.fn(),
  deleteBookingItem: vi.fn(),
  reorderBookingItems: vi.fn(),
  getVenueSpaces: vi.fn(async () => ({ data: [] })),
  getCateringPackages: vi.fn(async () => ({ data: [] })),
  getVendors: vi.fn(async () => ({ data: [] })),
  applyBookingDiscount: vi.fn(),
  cancelPrivateBooking: vi.fn(),
  addPrivateBookingNote: vi.fn(),
  createDepositPaymentOrder: vi.fn(),
  captureDepositPayment: vi.fn(),
  resendCalendarInvite: vi.fn(),
  getBookingPortalLink: vi.fn(),
  sendDepositPaymentLink: vi.fn(),
  editPrivateBookingPayment: vi.fn(),
  deletePrivateBookingPayment: vi.fn(),
  getCancellationPreview: vi.fn(async () => ({})),
  getCompletionPreview: vi.fn(async () => ({})),
  sendBookingContract: vi.fn(),
  confirmPrivateBookingDeposit: vi.fn(),
  deletePrivateBooking: vi.fn(),
  extendBookingHold: vi.fn(),
  getBookingDeleteEligibility: vi.fn(async () => ({ canDelete: true, sentCount: 0, scheduledCount: 0 })),
}))

vi.mock('@/app/actions/privateBookingInvoice', () => ({
  generatePrivateBookingInvoice: vi.fn(),
  previewPrivateBookingInvoice: vi.fn(),
  retryPrivateBookingInvoiceEmail: vi.fn(),
  cancelPrivateBookingInvoice: vi.fn(),
}))

vi.mock('@/app/actions/privateBookingWorkflow', () => ({
  listDeductions: vi.fn(async () => ({ data: [] })),
  proposeDeduction: vi.fn(),
  recordDeductionDiscussion: vi.fn(),
  decideDeduction: vi.fn(),
  listBookingSuppliers: vi.fn(async () => ({ data: [] })),
  addBookingSupplier: vi.fn(),
  updateBookingSupplier: vi.fn(),
  setSupplierStatus: vi.fn(),
  setWaiverStatus: vi.fn(),
  uploadSignedWaiver: vi.fn(),
  setRiskStatus: vi.fn(),
  lockBookingRecord: vi.fn(),
  unlockBookingRecord: vi.fn(),
  logComplaint: vi.fn(),
  updateComplaint: vi.fn(),
  listComplaints: vi.fn(async () => ({ data: [] })),
}))

vi.mock('@/app/actions/refundActions', () => ({ getRefundHistory: vi.fn(async () => ({ data: [] })) }))
vi.mock('@/app/actions/privateBookingExtras', () => ({}))
vi.mock('@/app/actions/privateBookingReceipt', () => ({}))
vi.mock('@/app/actions/invoices', () => ({ getLineItemCatalog: vi.fn() }))
vi.mock('@/components/features/invoices/RefundDialog', () => ({ RefundDialog: () => null }))
vi.mock('@/components/features/invoices/RefundHistoryTable', () => ({ RefundHistoryTable: () => null }))

const grantedPermissions = new Set<string>()
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: (module: string, action: string) => grantedPermissions.has(`${module}:${action}`),
  }),
}))

// The signing panel loads its own data and is not what this file is about.
vi.mock('@/components/features/signing/BookingSigningPanel', () => ({ BookingSigningPanel: () => null }))

import PrivateBookingDetailClient from '@/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient'

/** A London calendar date `days` from today, so the test reads the same on any day it runs. */
function daysFromToday(days: number): string {
  const date = shiftIsoDate(getTodayIsoDate(), days)
  if (!date) throw new Error('Could not build the test date')
  return date
}

function booking(overrides: Record<string, unknown> = {}): PrivateBookingWithDetails {
  return {
    id: 'booking-1',
    customer_id: null,
    customer_name: 'Jane Doe',
    customer_full_name: 'Jane Doe',
    customer_first_name: 'Jane',
    contact_phone: '+441234567890',
    contact_email: null,
    event_date: daysFromToday(5),
    start_time: '18:00:00',
    end_time: '23:00:00',
    event_type: 'Birthday party',
    guest_count: 30,
    status: 'confirmed',
    date_tbd: false,
    deposit_amount: 0,
    total_amount: 0,
    items: [],
    payments: [],
    audit_trail: [],
    invoice_id: null,
    contract_version: 0,
    contract_sent_at: null,
    contract_accepted_at: null,
    outside_food: false,
    waiver_status: 'not_required',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  } as unknown as PrivateBookingWithDetails
}

const permissions = {
  canEdit: true,
  canDelete: false,
  canManageDeposits: false,
  canSendSms: true,
  canManageSpaces: false,
  canManageCatering: false,
  canManageVendors: false,
  canEditPayments: false,
  canRefund: false,
  canInvoice: false,
  canViewPricing: false,
}

function renderBooking(overrides: Record<string, unknown> = {}): void {
  render(
    <PrivateBookingDetailClient
      bookingId="booking-1"
      initialBooking={booking(overrides)}
      permissions={permissions}
      paymentHistory={[]}
      depositRefunds={[]}
    />,
  )
}

function paperworkAlert(): HTMLElement | null {
  return screen.queryAllByRole('alert').find((alert) => within(alert).queryByText('Paperwork outstanding')) ?? null
}

function sentences(alert: HTMLElement): string[] {
  return within(alert).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

describe('private booking page: paperwork outstanding warning', () => {
  it('warns that the contract has not been sent, and says how close the event is', () => {
    renderBooking()
    const alert = paperworkAlert()
    expect(alert).not.toBeNull()
    expect(alert).toHaveTextContent('The event is in 5 days.')
    expect(sentences(alert as HTMLElement)).toEqual(['The contract has not been sent.'])
    // A warning only: the actions live in the signing panel.
    expect(within(alert as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
    expect(within(alert as HTMLElement).queryByRole('link')).not.toBeInTheDocument()
  })

  it('lists the contract and the food agreement, each in its own state', () => {
    renderBooking({
      event_date: daysFromToday(1),
      contract_version: 1,
      contract_sent_at: '2026-10-01T10:00:00Z',
      outside_food: true,
      waiver_status: 'not_required',
    })
    const alert = paperworkAlert() as HTMLElement
    expect(alert).toHaveTextContent('The event is tomorrow.')
    expect(sentences(alert)).toEqual([
      'The contract has been sent but not signed.',
      'The food agreement has not been sent.',
    ])
  })

  it('warns about a food agreement that is with the customer on the day of the event', () => {
    renderBooking({
      event_date: daysFromToday(0),
      contract_accepted_at: '2026-10-02T10:00:00Z',
      waiver_status: 'sent',
    })
    const alert = paperworkAlert() as HTMLElement
    expect(alert).toHaveTextContent('The event is today.')
    expect(sentences(alert)).toEqual(['The food agreement has been sent but not signed.'])
  })

  it('shows nothing when the contract is signed and no food agreement is needed', () => {
    renderBooking({ contract_accepted_at: '2026-10-02T10:00:00Z' })
    expect(paperworkAlert()).toBeNull()
  })

  it('shows nothing when the food agreement is signed too', () => {
    renderBooking({ contract_accepted_at: '2026-10-02T10:00:00Z', outside_food: true, waiver_status: 'signed' })
    expect(paperworkAlert()).toBeNull()
  })

  it('shows nothing while the event is more than 14 days away', () => {
    renderBooking({ event_date: daysFromToday(15) })
    expect(paperworkAlert()).toBeNull()
  })

  it('starts on day 14', () => {
    renderBooking({ event_date: daysFromToday(14) })
    expect(paperworkAlert()).toHaveTextContent('The event is in 14 days.')
  })

  it('shows nothing for a cancelled or completed booking, or one with no date yet', () => {
    for (const overrides of [{ status: 'cancelled' }, { status: 'completed' }, { date_tbd: true }]) {
      const { unmount } = render(
        <PrivateBookingDetailClient
          bookingId="booking-1"
          initialBooking={booking(overrides)}
          permissions={permissions}
          paymentHistory={[]}
          depositRefunds={[]}
        />,
      )
      expect(paperworkAlert()).toBeNull()
      unmount()
    }
  })
})
