import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceVendor } from '@/types/invoices'
import VendorsPage from '@/app/(authenticated)/invoices/vendors/page'

const actionMocks = vi.hoisted(() => ({
  getVendors: vi.fn(),
  createVendor: vi.fn(),
  updateVendor: vi.fn(),
  deleteVendor: vi.fn(),
}))
const router = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/invoices/vendors',
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    loading: false,
  }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/app/actions/vendors', () => actionMocks)

vi.mock('@/app/actions/vendor-contacts', () => ({
  getVendorContacts: vi.fn(),
  createVendorContact: vi.fn(),
  updateVendorContact: vi.fn(),
  deleteVendorContact: vi.fn(),
}))

const enabledVendor: InvoiceVendor = {
  id: 'vendor-1',
  name: 'Sidemen Entertainment Limited',
  customer_id: null,
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  vat_number: '',
  payment_terms: 7,
  notes: '',
  paypal_payments_enabled: true,
  is_active: true,
  created_at: '2026-09-15T09:00:00.000Z',
  updated_at: '2026-09-15T09:00:00.000Z',
}

describe('VendorsPage PayPal setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actionMocks.getVendors.mockResolvedValue({ vendors: [enabledVendor] })
    actionMocks.createVendor.mockResolvedValue({ success: true })
    actionMocks.updateVendor.mockResolvedValue({ success: true })
  })

  it('starts a new vendor with PayPal payments off', async () => {
    render(<VendorsPage />)

    const [addVendorButton] = await screen.findAllByRole('button', { name: 'Add Vendor' })
    fireEvent.click(addVendorButton)

    expect(screen.getByRole('checkbox', { name: 'Offer PayPal/card payment' })).not.toBeChecked()
  })

  it('hydrates an enabled vendor and serialises an unticked edit as false', async () => {
    render(<VendorsPage />)

    const [editVendorButton] = await screen.findAllByRole('button', { name: 'Edit vendor' })
    fireEvent.click(editVendorButton)
    const checkbox = screen.getByRole('checkbox', { name: 'Offer PayPal/card payment' })
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'Update Vendor' }))

    await waitFor(() => expect(actionMocks.updateVendor).toHaveBeenCalledTimes(1))
    const submittedForm = actionMocks.updateVendor.mock.calls[0][0] as FormData
    expect(submittedForm.get('paypal_payments_enabled')).toBe('false')
  })
})
