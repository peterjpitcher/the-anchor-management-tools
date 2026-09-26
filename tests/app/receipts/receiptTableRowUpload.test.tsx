// The receipts table's upload control is an icon-only FileButton: it needs an accessible name and
// a hover hint, because the icon alone does not say what it does.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReceiptTransaction } from '@/types/database'
import { ReceiptTableRow } from '@/app/(authenticated)/receipts/_components/ui/ReceiptTableRow'

vi.mock('@/app/actions/receipts', () => ({
  markReceiptTransaction: vi.fn(),
  deleteReceiptFile: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
  updateReceiptClassification: vi.fn(),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

function transaction(): ReceiptTransaction & { files: []; autoRule: null } {
  return {
    id: 'tx-1',
    transaction_date: '2026-09-01',
    details: 'Card payment',
    amount_in: null,
    amount_out: 12.5,
    status: 'pending',
    source_type: 'bank',
    vendor_name: null,
    expense_category: null,
    files: [],
    autoRule: null,
  } as unknown as ReceiptTransaction & { files: []; autoRule: null }
}

describe('ReceiptTableRow upload button', () => {
  it('is named and carries a hover hint', () => {
    render(
      <table>
        <tbody>
          <ReceiptTableRow
            transaction={transaction()}
            vendorOptions={[]}
            onUpdate={() => {}}
            onRemove={() => {}}
            onRuleSuggestion={() => {}}
          />
        </tbody>
      </table>
    )

    expect(screen.getByRole('button', { name: 'Upload receipt' })).toHaveAttribute('title', 'Upload receipt')
  })
})
