import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import InvoicesClient from '@/app/(authenticated)/invoices/InvoicesClient'
import type { InvoiceWithDetails } from '@/types/invoices'

const routerPushMock = vi.hoisted(() => vi.fn())
const downloadInvoicePdfMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const downloadBlobMock = vi.hoisted(() => vi.fn())

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
  usePathname: () => '/invoices',
  useSearchParams: () => new URLSearchParams(),
}))

// Mock PermissionContext
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
    loading: false,
  }),
}))

vi.mock('@/lib/invoices/download-pdf', () => ({
  downloadInvoicePdf: downloadInvoicePdfMock,
}))

vi.mock('@/lib/download-file', () => ({
  downloadBlob: downloadBlobMock,
  filenameFromContentDisposition: vi.fn(() => 'invoices-export.zip'),
}))

// Mock UI components if necessary. For now, let's assume they render reasonably well or are simple enough.
// If Select is a complex custom component, we might need to verify how it renders options.
// Assuming it renders standard <select> and <option> or compatible role.

const mockInvoices: InvoiceWithDetails[] = []
const invoiceWithDetails: InvoiceWithDetails = {
  id: 'invoice-1',
  invoice_number: 'INV-001',
  vendor_id: 'vendor-1',
  invoice_date: '2026-04-01',
  due_date: '2026-04-15',
  status: 'sent',
  invoice_discount_percentage: 0,
  subtotal_amount: 100,
  discount_amount: 0,
  vat_amount: 20,
  total_amount: 120,
  paid_amount: 0,
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-01T00:00:00.000Z',
  vendor: {
    id: 'vendor-1',
    name: 'Acme Supplies',
    is_active: true,
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
  },
  line_items: [],
  payments: [],
}
const mockSummary = {
  total_outstanding: 0,
  total_overdue: 0,
  total_this_month: 0,
  count_draft: 0,
}
const mockPermissions = {
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canExport: true,
  canManageCatalog: true,
}

describe('InvoicesClient', () => {
  beforeEach(() => {
    routerPushMock.mockClear()
    downloadInvoicePdfMock.mockClear()
    downloadBlobMock.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders all status filter options', () => {
    render(
      <InvoicesClient
        initialInvoices={mockInvoices}
        initialTotal={0}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={1}
        initialSearch=""
        initialVendorSearch=""
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    // Check if the select element exists
    // The Select component in ui-v2 might label itself or just be a select. 
    // Looking at InvoicesClient.tsx: <Select ... > <option ...> ... </Select>
    // If it renders a native select, we can find it by role 'combobox' or just display value.
    
    // In InvoicesClient, the select value is "unpaid" initially. 
    // We can look for the combobox and check its options.
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()

    // Check for options
    const expectedOptions = [
      'All',
      'Unpaid',
      'Draft',
      'Sent',
      'Partially Paid',
      'Paid',
      'Overdue',
      'Void',
      'Written Off'
    ]

    expectedOptions.forEach(optionText => {
        expect(screen.getByRole('option', { name: optionText })).toBeInTheDocument()
    })
  })

  it('renders a one-click invoice PDF download button', () => {
    render(
      <InvoicesClient
        initialInvoices={[invoiceWithDetails]}
        initialTotal={1}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={1}
        initialSearch=""
        initialVendorSearch=""
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    const downloadButton = screen.getByRole('button', { name: 'Download invoice INV-001' })

    expect(downloadButton).toBeInTheDocument()
  })

  it('does not navigate to the invoice detail page when the download icon is clicked', () => {
    render(
      <InvoicesClient
        initialInvoices={[invoiceWithDetails]}
        initialTotal={1}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={1}
        initialSearch=""
        initialVendorSearch=""
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    const downloadButton = screen.getByRole('button', { name: 'Download invoice INV-001' })
    const downloadIcon = downloadButton.querySelector('svg')

    fireEvent.click(downloadIcon ?? downloadButton)

    expect(downloadInvoicePdfMock).toHaveBeenCalledWith({
      id: 'invoice-1',
      invoiceNumber: 'INV-001',
    })
    expect(routerPushMock).not.toHaveBeenCalled()
  })

  it('updates the URL when filtering by vendor name', async () => {
    render(
      <InvoicesClient
        initialInvoices={[invoiceWithDetails]}
        initialTotal={1}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={3}
        initialSearch=""
        initialVendorSearch=""
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Filter vendor...'), {
      target: { value: 'Acme' },
    })

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/invoices?vendor=Acme&page=1')
    })
  })

  it('updates the URL immediately when invoice date filters change', () => {
    const { container } = render(
      <InvoicesClient
        initialInvoices={[invoiceWithDetails]}
        initialTotal={1}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={2}
        initialSearch=""
        initialVendorSearch=""
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    const dateInputs = container.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-04-01' } })

    expect(routerPushMock).toHaveBeenCalledWith('/invoices?start_date=2026-04-01&page=1')

    fireEvent.change(dateInputs[1], { target: { value: '2026-06-30' } })

    expect(routerPushMock).toHaveBeenCalledWith(
      '/invoices?start_date=2026-04-01&end_date=2026-06-30&page=1'
    )
  })

  it('applies the current quarter date filter without a separate apply button', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'))

    render(
      <InvoicesClient
        initialInvoices={[invoiceWithDetails]}
        initialTotal={1}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={2}
        initialSearch=""
        initialVendorSearch=""
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'This quarter' }))

    expect(routerPushMock).toHaveBeenCalledWith(
      '/invoices?start_date=2026-04-01&end_date=2026-06-30&page=1'
    )
  })

  it('downloads exports using the current list filters and selected dates', async () => {
    const blob = new Blob(['zip'])
    ;(global.fetch as unknown as vi.Mock).mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn(() => 'attachment; filename="filtered-invoices.zip"'),
      },
      blob: vi.fn().mockResolvedValue(blob),
    })

    const { container } = render(
      <InvoicesClient
        initialInvoices={[invoiceWithDetails]}
        initialTotal={1}
        initialSummary={mockSummary}
        initialStatus="paid"
        initialPage={1}
        initialSearch="INV"
        initialVendorSearch="Acme"
        initialStartDate=""
        initialEndDate=""
        initialLimit={20}
        initialError={null}
        permissions={mockPermissions}
      />
    )

    const dateInputs = container.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-04-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/invoices/export?start_date=2026-04-01&end_date=2026-06-30&status=paid&search=INV&vendor=Acme'
      )
    })
    expect(downloadBlobMock).toHaveBeenCalledWith(blob, 'invoices-export.zip')
  })
})
