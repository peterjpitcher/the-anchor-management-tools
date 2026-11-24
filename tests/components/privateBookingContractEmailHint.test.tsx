import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * Email Contract is disabled while the booking has no email address. The page says so beside
 * the button, so staff are not left guessing why it is greyed out (owner, 24 November 2026).
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

function booking(overrides: Record<string, unknown> = {}): PrivateBookingWithDetails {
  return {
    id: 'booking-1',
    customer_id: null,
    customer_name: 'Jane Doe',
    customer_full_name: 'Jane Doe',
    customer_first_name: 'Jane',
    contact_phone: '+441234567890',
    contact_email: null,
    event_date: '2026-12-28',
    start_time: '18:00:00',
    end_time: '23:00:00',
    event_type: 'Birthday party',
    guest_count: 30,
    status: 'draft',
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
    outside_food: true,
    waiver_status: 'required',
    created_at: '2026-11-24T10:00:00Z',
    updated_at: '2026-11-24T10:00:00Z',
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

const hint = 'Add an email address to this booking to send the contract.'

describe('private booking page: Email Contract without an email address', () => {
  it('disables the button and says why', () => {
    renderBooking()
    const button = screen.getByRole('button', { name: /Email Contract/ })
    expect(button).toBeDisabled()
    expect(screen.getByText(hint)).toBeInTheDocument()
    expect(button).toHaveAccessibleDescription(hint)
  })

  it('shows no hint once the booking has an email address', () => {
    renderBooking({ contact_email: 'jane@example.com' })
    expect(screen.getByRole('button', { name: /Email Contract/ })).toBeEnabled()
    expect(screen.queryByText(hint)).not.toBeInTheDocument()
  })
})
