import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvoiceVendor } from '@/types/invoices'
import VendorsPage from '@/app/(authenticated)/invoices/vendors/page'

/**
 * The vendor Contacts dialog. A contacts list that failed to load must say so, never show
 * "No contacts yet", and the contact flags take their tones from the named map.
 */

const vendorActions = vi.hoisted(() => ({
  getVendors: vi.fn(),
  createVendor: vi.fn(),
  updateVendor: vi.fn(),
  deleteVendor: vi.fn(),
}))
const contactActions = vi.hoisted(() => ({
  getVendorContacts: vi.fn(),
  createVendorContact: vi.fn(),
  updateVendorContact: vi.fn(),
  deleteVendorContact: vi.fn(),
}))

// One router object for every render: the page reloads its vendors whenever the router changes.
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/invoices/vendors',
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true, loading: false }),
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

vi.mock('@/app/actions/vendors', () => vendorActions)
vi.mock('@/app/actions/vendor-contacts', () => contactActions)

const vendor: InvoiceVendor = {
  id: 'vendor-1',
  name: 'Acme Ltd',
  customer_id: null,
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  vat_number: '',
  payment_terms: 7,
  notes: '',
  paypal_payments_enabled: false,
  is_active: true,
  created_at: '2026-09-15T09:00:00.000Z',
  updated_at: '2026-09-15T09:00:00.000Z',
}

async function openContacts(): Promise<void> {
  render(<VendorsPage />)
  const [contactsButton] = await screen.findAllByRole('button', { name: 'Manage contacts' })
  fireEvent.click(contactsButton)
  await screen.findByText('Contacts for Acme Ltd')
}

describe('VendorsPage contacts dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorActions.getVendors.mockResolvedValue({ vendors: [vendor] })
  })

  it('shows a failed contacts load as a failure, not as no contacts', async () => {
    contactActions.getVendorContacts.mockResolvedValue({ error: 'Database unavailable' })

    await openContacts()

    expect(await screen.findByText('Could not load contacts')).toBeInTheDocument()
    expect(screen.getByText('Database unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No contacts yet')).not.toBeInTheDocument()
  })

  it('shows the empty state only when the load worked and there are no contacts', async () => {
    contactActions.getVendorContacts.mockResolvedValue({ contacts: [] })

    await openContacts()

    expect(await screen.findByText('No contacts yet')).toBeInTheDocument()
    expect(screen.queryByText('Could not load contacts')).not.toBeInTheDocument()
  })

  it('lists contacts with their primary and invoice copy flags', async () => {
    contactActions.getVendorContacts.mockResolvedValue({
      contacts: [
        {
          id: 'contact-1',
          name: 'Pat Jones',
          email: 'pat@example.com',
          is_primary: true,
          receive_invoice_copy: true,
        },
      ],
    })

    await openContacts()

    expect(await screen.findByText('Pat Jones')).toBeInTheDocument()
    expect(screen.getByText('Primary')).toBeInTheDocument()
    expect(screen.getByText('Invoice CC')).toBeInTheDocument()
  })

  it('asks before deleting a contact, in a danger dialog, and deletes only on confirm', async () => {
    contactActions.getVendorContacts.mockResolvedValue({
      contacts: [{ id: 'contact-1', name: 'Pat Jones', email: 'pat@example.com', is_primary: false }],
    })
    contactActions.deleteVendorContact.mockResolvedValue({ success: true })

    await openContacts()
    await screen.findByText('Pat Jones')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const confirm = await screen.findByRole('dialog', { name: 'Delete Contact' })
    expect(confirm).toHaveTextContent('Delete Pat Jones from the contacts for Acme Ltd? This cannot be undone.')
    expect(contactActions.deleteVendorContact).not.toHaveBeenCalled()

    const confirmButton = within(confirm).getByRole('button', { name: 'Delete' })
    expect(confirmButton).toHaveClass('bg-danger')
    fireEvent.click(confirmButton)

    await waitFor(() => expect(contactActions.deleteVendorContact).toHaveBeenCalledTimes(1))
    const sent = contactActions.deleteVendorContact.mock.calls[0][0] as FormData
    expect(sent.get('id')).toBe('contact-1')
  })

  it('keeps the contact when the delete is cancelled', async () => {
    contactActions.getVendorContacts.mockResolvedValue({
      contacts: [{ id: 'contact-1', name: 'Pat Jones', email: 'pat@example.com', is_primary: false }],
    })

    await openContacts()
    await screen.findByText('Pat Jones')

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Contact' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete Contact' })).not.toBeInTheDocument())
    expect(contactActions.deleteVendorContact).not.toHaveBeenCalled()
  })
})

describe('VendorsPage vendor dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorActions.getVendors.mockResolvedValue({ vendors: [vendor] })
  })

  it('points to where contacts are managed, not to a button the dialog does not have', async () => {
    render(<VendorsPage />)
    await screen.findAllByRole('button', { name: 'Manage contacts' })

    fireEvent.click(screen.getAllByRole('button', { name: /New Vendor|Add Vendor/ })[0])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Contacts button on the vendor’s row in the vendor list')
    expect(dialog).not.toHaveTextContent('Contacts button above')
  })
})
