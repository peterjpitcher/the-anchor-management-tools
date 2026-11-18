import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Spec C1 (18 November 2026): the SMS Active and SMS Deactivated tab counts do not depend
 * on the page, so a plain page change keeps the counts the list holds and asks the server
 * for none. A change of filter asks for them again.
 */

const mocks = vi.hoisted(() => ({ getCustomerList: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/customers',
}))
vi.mock('@/app/actions/customers', () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  deleteCustomer: vi.fn(),
  importCustomers: vi.fn(),
  getCustomerList: mocks.getCustomerList,
  updateUpcomingPrivateBookingContacts: vi.fn(),
}))

import CustomersClient from '@/app/(authenticated)/customers/_components/CustomersClient'

function customer(i: number) {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`,
    first_name: `Guest${i}`,
    last_name: 'Smith',
    mobile_number: `07700900${String(i).padStart(3, '0')}`,
    email: `guest${i}@example.com`,
    sms_opt_in: true,
    sms_status: 'active',
    created_at: '2026-01-01T10:00:00.000Z',
  }
}

const PAGE_ONE = Array.from({ length: 25 }, (_, i) => customer(i))
const PAGE_TWO = Array.from({ length: 25 }, (_, i) => customer(i + 25))

beforeEach(() => {
  vi.clearAllMocks()
})

/** The value shown under a stat label such as "SMS Active". */
function statValue(label: string): string | null | undefined {
  return screen.getByText(label, { selector: 'span' }).nextElementSibling?.textContent
}

function renderList() {
  render(
    <CustomersClient
      initialData={{
        customers: PAGE_ONE as never,
        totalCount: 60,
        smsActiveCount: 41,
        smsDeactivatedCount: 7,
        customerPreferences: {},
        customerLabels: {},
        unreadCounts: {},
      }}
      initialPage={1}
      initialPageSize={25}
      initialSearch=""
      initialSmsFilter="all"
      canManageCustomers={false}
      canSendBulkMessages={false}
    />,
  )
}

describe('customer list tab counts', () => {
  it('keeps the counts it holds on a plain page change', async () => {
    mocks.getCustomerList.mockResolvedValue({
      customers: PAGE_TWO, totalCount: 60, smsActiveCount: null, smsDeactivatedCount: null,
      customerPreferences: {}, customerLabels: {}, unreadCounts: {},
    })
    renderList()
    expect(statValue('SMS Active')).toBe('41')

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(mocks.getCustomerList).toHaveBeenCalledTimes(1))
    expect(mocks.getCustomerList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, includeTabCounts: false }),
    )
    expect(await screen.findAllByText('Guest25', { exact: false })).not.toHaveLength(0)
    expect(statValue('SMS Active')).toBe('41')
    expect(statValue('SMS Deactivated')).toBe('7')
  })

  it('asks for the counts again when the filter changes', async () => {
    mocks.getCustomerList.mockResolvedValue({
      customers: PAGE_ONE.slice(0, 5), totalCount: 5, smsActiveCount: 41, smsDeactivatedCount: 5,
      customerPreferences: {}, customerLabels: {}, unreadCounts: {},
    })
    renderList()

    fireEvent.click(screen.getByRole('radio', { name: 'Deactivated' }))

    await waitFor(() => expect(mocks.getCustomerList).toHaveBeenCalledTimes(1))
    expect(mocks.getCustomerList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, smsFilter: 'deactivated', includeTabCounts: true }),
    )
    await waitFor(() => expect(statValue('SMS Deactivated')).toBe('5'))
  })
})
