import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * When the invoice email went but the app could not record it, the booking page must say
 * so as a warning, not report a plain success: the page may still show the invoice as
 * unsent and offer Email Invoice, and a second press would send the customer a duplicate.
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

// The billing and receipt panels load their own data and are not what this file is about.
vi.mock('@/components/private-bookings/PrivateBookingBilling', () => ({ PrivateBookingBilling: () => null }))
vi.mock('@/components/private-bookings/PrivateBookingReceiptPanel', () => ({ PrivateBookingReceiptPanel: () => null }))

// The confirmation dialog is stood in for by one button, so the test drives the page's
// confirm handler directly rather than the preview and the dialog's own form.
vi.mock('@/app/(authenticated)/private-bookings/[id]/InvoiceBookingModal', () => ({
  InvoiceBookingModal: ({ onConfirm }: { onConfirm: (input: { depositTreatment: 'held_separately'; reference: string }) => void }) => (
    <button type="button" onClick={() => onConfirm({ depositTreatment: 'held_separately', reference: '' })}>
      Confirm and send
    </button>
  ),
}))

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/ds', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/ds')>()), toast }))

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
import {
  generatePrivateBookingInvoice,
  retryPrivateBookingInvoiceEmail,
} from '@/app/actions/privateBookingInvoice'

const mockedGenerate = generatePrivateBookingInvoice as unknown as Mock
const mockedRetry = retryPrivateBookingInvoiceEmail as unknown as Mock

const WARNING =
  'The invoice was emailed, but the app could not record that it was sent, so it may still show as draft or unsent. Do not send it again: the customer already has it.'

function booking(overrides: Record<string, unknown> = {}): PrivateBookingWithDetails {
  return {
    id: 'booking-1',
    customer_id: null,
    customer_name: 'Jane Doe',
    customer_full_name: 'Jane Doe',
    customer_first_name: 'Jane',
    contact_phone: '+441234567890',
    contact_email: 'jane@example.com',
    event_date: '2027-03-20',
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
    invoice_id: 'invoice-1',
    invoice_sent_at: null,
    contract_version: 0,
    contract_sent_at: null,
    contract_accepted_at: '2026-10-02T10:00:00Z',
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
  canInvoice: true,
  canViewPricing: false,
}

function renderBooking(): void {
  render(
    <PrivateBookingDetailClient
      bookingId="booking-1"
      initialBooking={booking()}
      permissions={permissions}
      paymentHistory={[]}
      depositRefunds={[]}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('private booking page: invoice emailed but not recorded', () => {
  it('warns, rather than reporting plain success, when a first send was not recorded', async () => {
    mockedGenerate.mockResolvedValue({ invoiceId: 'invoice-1', invoiceNumber: 'INV-1', sent: true, warning: WARNING })
    renderBooking()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(WARNING, { duration: 12000 }))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still reports plain success when the first send was recorded', async () => {
    mockedGenerate.mockResolvedValue({ invoiceId: 'invoice-1', invoiceNumber: 'INV-1', sent: true })
    renderBooking()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm and send' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invoice INV-1 sent'))
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('warns, rather than reporting plain success, when Email Invoice was not recorded', async () => {
    mockedRetry.mockResolvedValue({ sent: true, warning: WARNING })
    renderBooking()

    fireEvent.click(screen.getByRole('button', { name: 'Email Invoice' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(WARNING, { duration: 12000 }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('still reports plain success when Email Invoice was recorded', async () => {
    mockedRetry.mockResolvedValue({ sent: true })
    renderBooking()

    fireEvent.click(screen.getByRole('button', { name: 'Email Invoice' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invoice sent'))
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
