import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BK-163: after changing a customer's phone or email from the customer list, the offer to update
 * their upcoming private hires is made there, with the bookings the save found. It used to send
 * staff to the customer page, which knew nothing of them, so the update could never be made.
 */

const mocks = vi.hoisted(() => ({
  updateCustomer: vi.fn(),
  updateUpcoming: vi.fn(),
  getCustomerList: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/customers',
}))
vi.mock('@/app/actions/customers', () => ({
  createCustomer: vi.fn(),
  updateCustomer: mocks.updateCustomer,
  deleteCustomer: vi.fn(),
  importCustomers: vi.fn(),
  getCustomerList: mocks.getCustomerList,
  updateUpcomingPrivateBookingContacts: mocks.updateUpcoming,
}))
// The form itself is tested elsewhere; here it only hands back what staff typed.
vi.mock('@/components/features/customers/CustomerForm', () => ({
  CustomerForm: ({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => Promise<void> }) => (
    <button type="button" onClick={() => void onSubmit({ first_name: 'Alex', last_name: 'Smith', mobile_number: '07700900999', email: 'new@example.com' })}>
      Save Test Customer
    </button>
  ),
}))

import CustomersClient from '@/app/(authenticated)/customers/_components/CustomersClient'

const CUSTOMER = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  first_name: 'Alex',
  last_name: 'Smith',
  mobile_number: '07700900111',
  email: 'old@example.com',
  sms_opt_in: true,
  sms_status: 'active',
  created_at: '2026-01-01T10:00:00.000Z',
}
const OFFERS = [{ bookingId: 'booking-1', fields: ['contact_phone', 'contact_email'] }]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateCustomer.mockResolvedValue({ success: true, data: CUSTOMER, privateBookingsWithOldContact: OFFERS })
  mocks.updateUpcoming.mockResolvedValue({ success: true, updated: 1 })
  mocks.getCustomerList.mockResolvedValue({
    customers: [CUSTOMER], totalCount: 1, smsActiveCount: 1, smsDeactivatedCount: 0,
    customerPreferences: {}, customerLabels: {}, unreadCounts: {},
  })
})

describe('editing a customer from the list', () => {
  it('offers the booking update right there, and makes it with the bookings the save found', async () => {
    render(
      <CustomersClient
        initialData={{ customers: [CUSTOMER] as never, totalCount: 1, smsActiveCount: 1, smsDeactivatedCount: 0, customerPreferences: {}, customerLabels: {}, unreadCounts: {} }}
        initialPage={1}
        initialPageSize={25}
        initialSearch=""
        initialSmsFilter="all"
        canManageCustomers
        canSendBulkMessages={false}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Save Test Customer' }))

    expect(await screen.findByText(/One upcoming private booking still has the old phone number or email address/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update Bookings' }))

    await waitFor(() => expect(mocks.updateUpcoming).toHaveBeenCalledWith(CUSTOMER.id, OFFERS))
    await waitFor(() => expect(screen.queryByText(/still has the old phone number/)).not.toBeInTheDocument())
  })

  it('offers nothing when no booking is on the old details', async () => {
    mocks.updateCustomer.mockResolvedValue({ success: true, data: CUSTOMER, privateBookingsWithOldContact: [] })
    render(
      <CustomersClient
        initialData={{ customers: [CUSTOMER] as never, totalCount: 1, smsActiveCount: 1, smsDeactivatedCount: 0, customerPreferences: {}, customerLabels: {}, unreadCounts: {} }}
        initialPage={1}
        initialPageSize={25}
        initialSearch=""
        initialSmsFilter="all"
        canManageCustomers
        canSendBulkMessages={false}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Save Test Customer' }))

    await waitFor(() => expect(mocks.updateCustomer).toHaveBeenCalled())
    expect(screen.queryByText(/Update Upcoming Private Bookings/)).not.toBeInTheDocument()
  })
})
