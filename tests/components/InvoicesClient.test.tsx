import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InvoicesClient from '@/app/(authenticated)/invoices/InvoicesClient'

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
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

// Mock UI components if necessary. For now, let's assume they render reasonably well or are simple enough.
// If Select is a complex custom component, we might need to verify how it renders options.
// Assuming it renders standard <select> and <option> or compatible role.

const mockInvoices = []
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
  it('renders all status filter options', () => {
    render(
      <InvoicesClient
        initialInvoices={mockInvoices}
        initialTotal={0}
        initialSummary={mockSummary}
        initialStatus="unpaid"
        initialPage={1}
        initialSearch=""
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
})
