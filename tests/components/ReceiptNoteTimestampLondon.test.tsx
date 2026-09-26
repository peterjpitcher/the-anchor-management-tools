// The timestamp written into a receipt note, on the London clock.
//
// Saving a note on the receipts table (desktop row or mobile card) prefixes it with the time it
// was written, and that text is stored with the transaction. Formatting the time without a zone
// used the device's clock, so a note saved on a device not set to UK time (a laptop on UTC, say)
// was stamped an hour early during British Summer Time and, late in the evening, with the day
// before. The UTC test run stands in for such a device.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiptTableRow } from '@/app/(authenticated)/receipts/_components/ui/ReceiptTableRow'
import { ReceiptMobileCard } from '@/app/(authenticated)/receipts/_components/ui/ReceiptMobileCard'
import type { ReceiptFile, ReceiptTransaction } from '@/types/database'

const markReceiptTransaction = vi.hoisted(() => vi.fn())

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => ({
    hasPermission: () => true,
  }),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

vi.mock('@/app/actions/receipts', () => ({
  deleteReceiptFile: vi.fn(),
  getReceiptSignedUrl: vi.fn(),
  markReceiptTransaction: (...args: unknown[]) => markReceiptTransaction(...args),
  updateReceiptClassification: vi.fn(),
}))

// 00:30 BST on Friday 2 October 2026 in London; still 23:30 on Thursday 1 October in UTC.
const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'
const LONDON_STAMP = '02 Oct 2026, 00:30'
// The stored separator is a long dash with a space either side, built here so this file holds none.
const SEPARATOR = ` ${String.fromCharCode(0x2014)} `

type WorkspaceTransaction = ReceiptTransaction & {
  files: ReceiptFile[]
  autoRule?: { id: string; name: string } | null
}

const transaction: WorkspaceTransaction = {
  id: 'tx-1',
  batch_id: null,
  transaction_date: '2026-10-01',
  details: 'Coffee',
  transaction_type: null,
  amount_in: 0,
  amount_out: 12,
  amount_total: 12,
  balance: null,
  dedupe_hash: 'hash-1',
  source_type: 'bank',
  card_member: null,
  card_account: null,
  merchant_category: null,
  merchant_town: null,
  external_reference: null,
  status: 'pending',
  receipt_required: true,
  marked_by: null,
  marked_by_email: null,
  marked_by_name: null,
  marked_at: null,
  marked_method: null,
  rule_applied_id: null,
  auto_completed_reason: null,
  vendor_id: null,
  vendor_name: 'Cafe',
  vendor_source: 'manual',
  vendor_rule_id: null,
  vendor_updated_at: null,
  expense_category: null,
  expense_category_source: null,
  expense_rule_id: null,
  expense_updated_at: null,
  notes: null,
  ai_confidence: null,
  ai_suggested_keywords: null,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  files: [],
  autoRule: null,
}

function savedNote(): unknown {
  expect(markReceiptTransaction).toHaveBeenCalledTimes(1)
  return (markReceiptTransaction.mock.calls[0][0] as { note?: string }).note
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(JUST_AFTER_MIDNIGHT_BST))
  markReceiptTransaction.mockResolvedValue({ transaction: { ...transaction, notes: 'saved' } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ReceiptTableRow note timestamp', () => {
  it('stamps a saved note with the London date and time', async () => {
    render(
      <table>
        <tbody>
          <ReceiptTableRow
            transaction={transaction}
            vendorOptions={[]}
            onUpdate={vi.fn()}
            onRemove={vi.fn()}
            onRuleSuggestion={vi.fn()}
          />
        </tbody>
      </table>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Chased supplier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(markReceiptTransaction).toHaveBeenCalled())
    expect(savedNote()).toBe(`${LONDON_STAMP}${SEPARATOR}Chased supplier`)
  })
})

describe('ReceiptMobileCard note timestamp', () => {
  it('stamps a saved note with the London date and time', async () => {
    render(
      <ReceiptMobileCard
        transaction={transaction}
        vendorOptions={[]}
        onUpdate={vi.fn()}
        onRuleSuggestion={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    fireEvent.change(screen.getByPlaceholderText('Note'), { target: { value: 'Chased supplier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(markReceiptTransaction).toHaveBeenCalled())
    expect(savedNote()).toBe(`${LONDON_STAMP}${SEPARATOR}Chased supplier`)
  })
})
