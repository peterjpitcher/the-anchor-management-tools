import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * The page contract for private bookings (docs/standards/UI_UX.md): every booking tab shows the
 * customer's name, the tab row is the shared PB_DETAIL_NAV, the contract opens from the header
 * rather than a tab, there are no breadcrumbs, and the list shows the section's tab row. A failed
 * load of the list is an error, never an empty list.
 */

let pathname = '/private-bookings/booking-1'
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

const fetchPrivateBookings = vi.fn()
vi.mock('@/app/actions/private-bookings-dashboard', () => ({
  fetchPrivateBookings: (...args: unknown[]) => fetchPrivateBookings(...args),
}))

const grantedPermissions = new Set<string>()
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: (module: string, action: string) => grantedPermissions.has(`${module}:${action}`),
  }),
}))

import PrivateBookingDetailClient from '@/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient'
import PrivateBookingsClient from '@/app/(authenticated)/private-bookings/_components/PrivateBookingsClient'

const booking = {
  id: 'booking-1',
  customer_id: null,
  customer_name: 'Jane Doe',
  customer_full_name: 'Jane Doe',
  customer_first_name: 'Jane',
  contact_phone: '+441234567890',
  contact_email: null,
  event_date: '2026-11-14',
  start_time: '18:00:00',
  end_time: '23:00:00',
  event_type: 'Birthday party',
  guest_count: 30,
  status: 'draft',
  deposit_amount: 0,
  total_amount: 0,
  items: [],
  payments: [],
  audit_trail: [],
  invoice_id: null,
  contract_version: 0,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
} as unknown as PrivateBookingWithDetails

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

describe('private booking detail page chrome', () => {
  beforeEach(() => {
    pathname = '/private-bookings/booking-1'
  })

  it('titles the page with the customer, uses the shared tab row and opens the contract from the header', async () => {
    render(
      <PrivateBookingDetailClient
        bookingId="booking-1"
        initialBooking={booking}
        permissions={permissions}
        paymentHistory={[]}
      />,
    )

    expect(screen.getAllByRole('heading', { level: 1, name: 'Jane Doe' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Items',
      'Messages',
      'Communications',
    ])
    // Header actions render in the desktop header and again in the phone nav row.
    const contract = screen.getAllByRole('link', { name: 'Open Contract' })[0]
    expect(contract).toHaveAttribute('href', '/private-bookings/booking-1/contract')
    expect(contract).toHaveAttribute('target', '_blank')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumbs' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Back to Private Bookings' }).length).toBeGreaterThan(0)
    for (const title of ['Event Details', 'Booking Items', 'Financial Summary', 'Quick Actions', 'Booking Information', 'Audit Trail']) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
    // The workflow panels finish loading without throwing.
    await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Suppliers' })).toBeInTheDocument())
  })

  it('keeps the same title and tab row when the booking cannot be loaded', async () => {
    render(
      <PrivateBookingDetailClient
        bookingId="booking-1"
        initialBooking={null}
        permissions={permissions}
        paymentHistory={[]}
        initialError="We could not load this booking."
      />,
    )

    // With no booking the page fetches it again; the header is the same while it does.
    expect(screen.getAllByRole('heading', { level: 1, name: 'Private Booking' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(await screen.findByText('We could not load this booking.')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1, name: 'Private Booking' }).length).toBeGreaterThan(0)
  })
})

describe('private bookings list page chrome', () => {
  beforeEach(() => {
    pathname = '/private-bookings'
    grantedPermissions.clear()
    fetchPrivateBookings.mockReset()
  })

  it('shows the section tab row and puts New Booking in the header', () => {
    grantedPermissions.add('reports:view')
    grantedPermissions.add('private_bookings:view_sms_queue')
    render(
      <PrivateBookingsClient
        permissions={{ hasCreatePermission: true, hasDeletePermission: false, hasEditPermission: true }}
        initialBookings={[]}
        initialTotalCount={0}
        pageSize={20}
      />,
    )

    const sectionTabs = screen.getAllByRole('tab').filter((tab) => tab.tagName === 'A').map((tab) => tab.textContent)
    expect(sectionTabs).toEqual(['Bookings', 'Calendar', 'SMS Queue', 'Reports', 'Settings'])
    expect(screen.getAllByRole('link', { name: 'New Booking' })[0]).toHaveAttribute('href', '/private-bookings/new')
    expect(screen.getByText('No bookings found')).toBeInTheDocument()
  })

  it('hides the tabs a person cannot open', () => {
    render(
      <PrivateBookingsClient
        permissions={{ hasCreatePermission: false, hasDeletePermission: false, hasEditPermission: false }}
        initialBookings={[]}
        initialTotalCount={0}
        pageSize={20}
      />,
    )

    const sectionTabs = screen.getAllByRole('tab').filter((tab) => tab.tagName === 'A').map((tab) => tab.textContent)
    expect(sectionTabs).toEqual(['Bookings', 'Calendar', 'Settings'])
    expect(screen.queryByRole('link', { name: 'New Booking' })).not.toBeInTheDocument()
  })

  it('shows a failed load as an error, never as an empty list', () => {
    render(
      <PrivateBookingsClient
        permissions={{ hasCreatePermission: true, hasDeletePermission: false, hasEditPermission: true }}
        initialBookings={[]}
        initialTotalCount={0}
        pageSize={20}
        initialError="Failed to load private bookings."
      />,
    )

    expect(screen.getByText('Failed to load private bookings.')).toBeInTheDocument()
    expect(screen.queryByText('No bookings found')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
