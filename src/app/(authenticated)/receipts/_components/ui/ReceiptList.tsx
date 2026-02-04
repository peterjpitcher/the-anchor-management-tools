'use client'

import { ChangeEvent } from 'react'
import { Card } from '@/components/ui-v2/layout/Card'
import { Select } from '@/components/ui-v2/forms/Select'
import type { ReceiptWorkspaceData, ReceiptWorkspaceFilters, ClassificationRuleSuggestion } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'
import { ReceiptTableRow } from './ReceiptTableRow'
import { ReceiptMobileCard } from './ReceiptMobileCard'

type WorkspaceTransaction = ReceiptWorkspaceData['transactions'][number]
type SortColumn = NonNullable<ReceiptWorkspaceFilters['sortBy']>

// Helper types matching action exports
type ReceiptSortColumn = 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'amount_total'

interface ReceiptListProps {
  transactions: WorkspaceTransaction[]
  knownVendors: string[]
  filters: {
    sortBy?: ReceiptSortColumn
    sortDirection?: 'asc' | 'desc'
    status?: string
    showOnlyOutstanding?: boolean
    missingVendorOnly?: boolean
    missingExpenseOnly?: boolean
  }
  onSort: (column: SortColumn) => void
  onMobileSort: (event: ChangeEvent<HTMLSelectElement>) => void
  onTransactionChange: (updated: WorkspaceTransaction, previousStatus?: ReceiptTransaction['status']) => void
  onTransactionRemove: (id: string, previousStatus: ReceiptTransaction['status'], nextStatus?: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

export function ReceiptList({
  transactions,
  knownVendors,
  filters,
  onSort,
  onMobileSort,
  onTransactionChange,
  onTransactionRemove,
  onRuleSuggestion,
}: ReceiptListProps) {
  const currentSortBy = filters.sortBy ?? 'transaction_date'
  const currentSortDirection = filters.sortDirection ?? 'desc'
  const mobileSortValue = `${currentSortBy}:${currentSortDirection}`
  
  const mobileSortOptions = [
    { value: 'transaction_date:desc', label: 'Date · newest first' },
    { value: 'transaction_date:asc', label: 'Date · oldest first' },
    { value: 'details:asc', label: 'Details · A → Z' },
    { value: 'details:desc', label: 'Details · Z → A' },
    { value: 'amount_total:desc', label: 'Amount · high to low' },
    { value: 'amount_total:asc', label: 'Amount · low to high' },
    { value: 'amount_out:desc', label: 'Money out · high to low' },
    { value: 'amount_out:asc', label: 'Money out · low to high' },
    { value: 'amount_in:desc', label: 'Money in · high to low' },
    { value: 'amount_in:asc', label: 'Money in · low to high' },
  ]

  const isVendorMissing = (value: string | null | undefined) => !value || value.trim().length === 0
  const isExpenseMissing = (value: string | null | undefined) => !value || value.trim().length === 0
  const outstandingStatuses = new Set<ReceiptTransaction['status']>(['pending', 'cant_find'])
  const isOutstandingStatus = (status: ReceiptTransaction['status']) => outstandingStatuses.has(status)

  // Filter check to immediately remove items that no longer match strict filters
  // This logic was previously in the `handleStatusUpdate` of the monolithic component
  const handleUpdate = (updated: WorkspaceTransaction, previousStatus: ReceiptTransaction['status']) => {
      // If we are filtering by a specific status and the status changed, remove it
      if (filters.status && filters.status !== 'all' && filters.status !== updated.status) {
          onTransactionRemove(updated.id, previousStatus, updated.status)
          return
      }
      // If we show only outstanding and it's now complete, remove it
      if (filters.showOnlyOutstanding && !isOutstandingStatus(updated.status)) {
          onTransactionRemove(updated.id, previousStatus, updated.status)
          return
      }
      if (filters.missingVendorOnly && !isVendorMissing(updated.vendor_name)) {
          onTransactionRemove(updated.id, previousStatus, updated.status)
          return
      }
      if (filters.missingExpenseOnly && !isExpenseMissing(updated.expense_category)) {
          onTransactionRemove(updated.id, previousStatus, updated.status)
          return
      }
      
      onTransactionChange(updated, previousStatus)
  }

  return (
    <Card header={<div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
          <p className="text-sm text-gray-500">Tick off receipts as you collect them and keep the finance trail tidy.</p>
        </div>
      </div>}>

        <div className="w-full sm:hidden mb-4">
          <label htmlFor="mobile-receipts-sort" className="text-xs font-medium text-gray-600">Sort</label>
          <Select
            id="mobile-receipts-sort"
            value={mobileSortValue}
            onChange={onMobileSort}
            className="mt-1"
            selectSize="sm"
          >
            {mobileSortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>

        {/* Mobile View */}
        <div className="flex flex-col gap-2 px-2 lg:hidden">
          {transactions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
              No transactions match your filters.
            </div>
          ) : (
            transactions.map((transaction) => (
              <ReceiptMobileCard
                key={transaction.id}
                transaction={transaction}
                vendorOptions={knownVendors}
                onUpdate={(tx, prev) => handleUpdate(tx, prev ?? 'pending')}
                onRuleSuggestion={onRuleSuggestion}
              />
            ))
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden lg:block">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 text-left text-sm font-semibold text-gray-600">
                <tr>
                  <th className="px-4 py-3">
                    <button className={`flex items-center gap-1 ${currentSortBy === 'transaction_date' ? 'text-emerald-700' : ''}`} onClick={() => onSort('transaction_date')}>
                        Date {currentSortBy === 'transaction_date' && (currentSortDirection === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button className={`flex items-center gap-1 ${currentSortBy === 'details' ? 'text-emerald-700' : ''}`} onClick={() => onSort('details')}>
                        Details {currentSortBy === 'details' && (currentSortDirection === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Expense type</th>
                  <th className="px-4 py-3 text-right">In</th>
                  <th className="px-4 py-3 text-right">Out</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Receipts</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                 {transactions.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-500">No transactions match your filters.</td></tr>
                )}
                {transactions.map(transaction => (
                  <ReceiptTableRow
                    key={transaction.id}
                    transaction={transaction}
                    vendorOptions={knownVendors}
                    onUpdate={(tx, prev) => handleUpdate(tx, prev ?? 'pending')}
                    onRemove={onTransactionRemove}
                    onRuleSuggestion={onRuleSuggestion}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
    </Card>
  )
}
