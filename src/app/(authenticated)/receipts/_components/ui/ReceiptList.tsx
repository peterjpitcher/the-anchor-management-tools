'use client'

import { ChangeEvent, Fragment, useMemo } from 'react'
import { Card, CardBody, CardHeader, Select } from '@/ds'
import type { ReceiptWorkspaceData, ReceiptWorkspaceFilters, ClassificationRuleSuggestion } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'
import { ReceiptTableRow } from './ReceiptTableRow'
import { ReceiptMobileCard } from './ReceiptMobileCard'
import { formatCurrency } from '../../utils'

type WorkspaceTransaction = ReceiptWorkspaceData['transactions'][number]
type SortColumn = NonNullable<ReceiptWorkspaceFilters['sortBy']>

// Helper types matching action exports
type ReceiptSortColumn = 'transaction_date' | 'details' | 'amount_in' | 'amount_out' | 'amount_total'

type VendorGroup = {
  key: string
  vendorName: string
  transactions: WorkspaceTransaction[]
  totalIn: number
  totalOut: number
  totalAmount: number
}

const MISSING_VENDOR_LABEL = 'Missing vendor'

function getVendorGroupLabel(transaction: WorkspaceTransaction) {
  const vendorName = transaction.vendor_name?.trim()
  return vendorName || MISSING_VENDOR_LABEL
}

function buildVendorGroups(transactions: WorkspaceTransaction[]): VendorGroup[] {
  const groups = new Map<string, VendorGroup>()

  transactions.forEach((transaction) => {
    const vendorName = getVendorGroupLabel(transaction)
    const key = vendorName.toLocaleLowerCase('en-GB')
    const group = groups.get(key) ?? {
      key,
      vendorName,
      transactions: [],
      totalIn: 0,
      totalOut: 0,
      totalAmount: 0,
    }

    group.transactions.push(transaction)
    const amountIn = Number(transaction.amount_in ?? 0)
    const amountOut = Number(transaction.amount_out ?? 0)
    group.totalIn += amountIn
    group.totalOut += amountOut
    group.totalAmount += Number(transaction.amount_total ?? amountIn + amountOut)
    groups.set(key, group)
  })

  return Array.from(groups.values()).sort((a, b) => {
    if (a.vendorName === MISSING_VENDOR_LABEL) return -1
    if (b.vendorName === MISSING_VENDOR_LABEL) return 1
    if (b.totalOut !== a.totalOut) return b.totalOut - a.totalOut
    return a.vendorName.localeCompare(b.vendorName)
  })
}

interface ReceiptListProps {
  transactions: WorkspaceTransaction[]
  knownVendors: string[]
  filters: {
    sortBy?: ReceiptSortColumn
    sortDirection?: 'asc' | 'desc'
    status?: string
    showOnlyOutstanding?: boolean
    groupByVendor?: boolean
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
  const shouldGroupByVendor = filters.groupByVendor ?? false
  const vendorGroups = useMemo(() => buildVendorGroups(transactions), [transactions])
  
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
  const outstandingStatuses = new Set<ReceiptTransaction['status']>(['pending'])
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
    <Card>
      <CardHeader title="Transactions" subtitle="Tick off receipts as you collect them and keep the finance trail tidy." />
      <CardBody className="p-0">
        <div className="w-full p-[var(--spacing-pad-card)] sm:hidden">
          <label htmlFor="mobile-receipts-sort" className="text-xs font-medium text-text-muted">Sort</label>
          <Select
            id="mobile-receipts-sort"
            value={mobileSortValue}
            onChange={onMobileSort}
            className="mt-1"
            options={mobileSortOptions}
          />
        </div>

        {/* Mobile View */}
        <div className="flex flex-col gap-2 px-[var(--spacing-pad-card)] pb-[var(--spacing-pad-card)] lg:hidden">
          {transactions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
              No transactions match your filters.
            </div>
          ) : shouldGroupByVendor ? (
            vendorGroups.map((group) => (
              <section key={group.key} className="space-y-2">
                <div className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-text-strong">{group.vendorName}</h3>
                    <span className="text-xs font-semibold text-text-strong">Total {formatCurrency(group.totalAmount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                    <span>{group.transactions.length} receipt{group.transactions.length === 1 ? '' : 's'}</span>
                    {group.totalOut > 0 && <span>Out {formatCurrency(group.totalOut)}</span>}
                    {group.totalIn > 0 && <span>In {formatCurrency(group.totalIn)}</span>}
                  </div>
                </div>
                {group.transactions.map((transaction) => (
                  <ReceiptMobileCard
                    key={transaction.id}
                    transaction={transaction}
                    vendorOptions={knownVendors}
                    onUpdate={(tx, prev) => handleUpdate(tx, prev ?? 'pending')}
                    onRuleSuggestion={onRuleSuggestion}
                  />
                ))}
              </section>
            ))
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
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface-2 text-left text-xs font-medium uppercase tracking-wider text-text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    <button type="button" className={`flex items-center gap-1 ${currentSortBy === 'transaction_date' ? 'text-primary' : ''}`} onClick={() => onSort('transaction_date')}>
                      Date {currentSortBy === 'transaction_date' && (currentSortDirection === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-2">
                    <button type="button" className={`flex items-center gap-1 ${currentSortBy === 'details' ? 'text-primary' : ''}`} onClick={() => onSort('details')}>
                      Details {currentSortBy === 'details' && (currentSortDirection === 'asc' ? '↑' : '↓')}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-2">Vendor</th>
                  <th scope="col" className="px-4 py-2">Expense type</th>
                  <th scope="col" className="px-4 py-2 text-right">In</th>
                  <th scope="col" className="px-4 py-2 text-right">Out</th>
                  <th scope="col" className="px-4 py-2">Status</th>
                  <th scope="col" className="px-4 py-2">Receipts</th>
                  <th scope="col" className="px-4 py-2">Notes</th>
                  <th scope="col" className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-sm text-text">
                {transactions.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-6 text-center text-text-muted">No transactions match your filters.</td></tr>
                )}
                {transactions.length > 0 && shouldGroupByVendor ? (
                  vendorGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="bg-surface-2">
                        <td colSpan={10} className="px-4 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <span className="font-semibold text-text-strong">{group.vendorName}</span>
                              <span className="text-xs text-text-muted">{group.transactions.length} receipt{group.transactions.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs font-medium text-text-muted">
                              <span className="text-text-strong">Total {formatCurrency(group.totalAmount)}</span>
                              {group.totalOut > 0 && <span>Out {formatCurrency(group.totalOut)}</span>}
                              {group.totalIn > 0 && <span>In {formatCurrency(group.totalIn)}</span>}
                            </div>
                          </div>
                        </td>
                      </tr>
                      {group.transactions.map((transaction) => (
                        <ReceiptTableRow
                          key={transaction.id}
                          transaction={transaction}
                          vendorOptions={knownVendors}
                          onUpdate={(tx, prev) => handleUpdate(tx, prev ?? 'pending')}
                          onRemove={onTransactionRemove}
                          onRuleSuggestion={onRuleSuggestion}
                        />
                      ))}
                    </Fragment>
                  ))
                ) : (
                  transactions.map((transaction) => (
                    <ReceiptTableRow
                      key={transaction.id}
                      transaction={transaction}
                      vendorOptions={knownVendors}
                      onUpdate={(tx, prev) => handleUpdate(tx, prev ?? 'pending')}
                      onRemove={onTransactionRemove}
                      onRuleSuggestion={onRuleSuggestion}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
