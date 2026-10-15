import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PrivateBookingWithDetails } from '@/types/private-bookings'

/**
 * When a discount or an item change saved but the booking's balance status did not update,
 * the action returns success with a warning. Both pages that make those changes (the booking
 * page and its Items tab) must show that warning, not a plain success, so staff do not make
 * the change again and do tell the developer.
 */

const pathname = '/private-bookings/booking-1'
// One router for every render, as Next gives: the pages key their effects on it.
const router = vi.hoisted(() => ({ refresh: () => {}, push: () => {}, replace: () => {} }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'booking-1' }),
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
  getVendorRate: vi.fn(async () => ({ data: null })),
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

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => false }),
}))

// The signing panel loads its own data and is not what this file is about.
vi.mock('@/components/features/signing/BookingSigningPanel', () => ({ BookingSigningPanel: () => null }))

import PrivateBookingDetailClient from '@/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient'
import ItemsPage from '@/app/(authenticated)/private-bookings/[id]/items/page'
import {
  applyBookingDiscount,
  deleteBookingItem,
  getPrivateBooking,
  updateBookingItem,
} from '@/app/actions/privateBookingActions'

const mockedApplyDiscount = applyBookingDiscount as unknown as Mock
const mockedDeleteItem = deleteBookingItem as unknown as Mock
const mockedUpdateItem = updateBookingItem as unknown as Mock
const mockedGetBooking = getPrivateBooking as unknown as Mock

const warningFor = (lead: string): string =>
  `${lead}, but the booking's balance status did not update, so it may show the wrong amount still owed or the wrong paid-in-full status. Do not make the change again: tell the developer.`

const item = {
  id: 'item-1',
  booking_id: 'booking-1',
  item_type: 'other',
  description: 'Cake table',
  quantity: 2,
  unit_price: 50,
  discount_value: null,
  discount_type: null,
  line_total: 100,
  vat_rate: 20,
  notes: null,
  display_order: 0,
  space_id: null,
  package_id: null,
  vendor_id: null,
  created_at: '2026-09-01T10:00:00Z',
}

function booking(): PrivateBookingWithDetails {
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
    items: [item],
    payments: [],
    audit_trail: [],
    invoice_id: null,
    contract_version: 0,
    contract_sent_at: null,
    outside_food: false,
    waiver_status: 'not_required',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
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

function renderBookingPage(): void {
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
  mockedGetBooking.mockResolvedValue({ data: booking() })
})

describe('booking page: change saved but balance status not updated', () => {
  it('warns when an item was removed but the balance status did not update', async () => {
    const warning = warningFor('The item was removed')
    mockedDeleteItem.mockResolvedValue({ success: true, warning })
    renderBookingPage()

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning, { duration: 12000 }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows no warning when an item was removed and the balance status updated', async () => {
    mockedDeleteItem.mockResolvedValue({ success: true })
    renderBookingPage()

    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(mockedDeleteItem).toHaveBeenCalledWith('item-1'))
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('warns when an item edit saved but the balance status did not update', async () => {
    const warning = warningFor('The item was saved')
    mockedUpdateItem.mockResolvedValue({ success: true, warning })
    renderBookingPage()

    fireEvent.click(screen.getByRole('button', { name: 'Edit item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning, { duration: 12000 }))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('warns when a discount saved but the balance status did not update', async () => {
    const warning = warningFor('The discount was saved')
    mockedApplyDiscount.mockResolvedValue({ success: true, warning })
    renderBookingPage()

    fireEvent.click(screen.getByRole('button', { name: 'Apply Discount' }))
    fireEvent.change(await screen.findByRole('spinbutton'), { target: { value: '10' } })
    fireEvent.change(screen.getByPlaceholderText(/Early bird discount/), { target: { value: 'Loyalty' } })
    const submit = screen.getAllByRole('button', { name: 'Apply Discount' }).find(
      (button) => button.getAttribute('type') === 'submit',
    )
    fireEvent.click(submit as HTMLElement)

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning, { duration: 12000 }))
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('items tab: change saved but balance status not updated', () => {
  it('warns instead of reporting plain success when an item was removed', async () => {
    const warning = warningFor('The item was removed')
    mockedDeleteItem.mockResolvedValue({ success: true, warning })
    render(<ItemsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning, { duration: 12000 }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('still reports plain success when an item was removed and the balance status updated', async () => {
    mockedDeleteItem.mockResolvedValue({ success: true })
    render(<ItemsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete item' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Item deleted successfully'))
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('warns instead of reporting plain success when an item edit saved', async () => {
    const warning = warningFor('The item was saved')
    mockedUpdateItem.mockResolvedValue({ success: true, warning })
    render(<ItemsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit item' }))
    const save = await screen.findAllByRole('button', { name: /Save|Update/ })
    fireEvent.click(save[save.length - 1])

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning, { duration: 12000 }))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
