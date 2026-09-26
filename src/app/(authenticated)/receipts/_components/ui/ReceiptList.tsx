'use client'

import { ChangeEvent, Fragment, useMemo } from 'react'
import {
  Card,
  CardHeader,
  Empty,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
} from '@/ds'
import type { ReceiptWorkspaceData, ReceiptWorkspaceFilters, ClassificationRuleSuggestion } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'
import { ReceiptTableRow } from './ReceiptTableRow'
import { ReceiptMobileCard } from './ReceiptMobileCard'
import { formatCurrency } from '../../utils'
import {
  buildVendorGroups,
  getTransactionValue,
  getValueHeatColour,
} from './receipt-list-groups'

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
    groupByVendor?: boolean
    missingVendorOnly?: boolean
    missingExpenseOnly?: boolean
  }
  onSort: (column: SortColumn) => void
  onMobileSort: (event: ChangeEvent<HTMLSelectElement>) => void
  onTransactionChange: (updated: WorkspaceTransaction, previousStatus?: ReceiptTransaction['status']) => void
  onTransactionRemove: (id: string, previousStatus: ReceiptTransaction['status'], nextStatus?: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
  /** The workspace pages on the server; left out when everything fits on one page. */
  pagination?: {
    page: number
    totalPages: number
    pageSize: number
    totalItems: number
    onPageChange: (page: number) => void
  }
}

const NO_MATCHES = 'No transactions match your filters'

export function ReceiptList({
  transactions,
  knownVendors,
  filters,
  onSort,
  onMobileSort,
  onTransactionChange,
  onTransactionRemove,
  onRuleSuggestion,
  pagination,
}: ReceiptListProps) {
  const currentSortBy = filters.sortBy ?? 'transaction_date'
  const currentSortDirection = filters.sortDirection ?? 'desc'
  const mobileSortValue = `${currentSortBy}:${currentSortDirection}`
  const shouldGroupByVendor = filters.groupByVendor ?? false
  const vendorGroups = useMemo(() => buildVendorGroups(transactions), [transactions])
  const valueRanges = useMemo(() => {
    const transactionValues = transactions.map(getTransactionValue)
    const groupValues = vendorGroups.map((group) => group.totalAmount)

    return {
      transactionMin: Math.min(...transactionValues),
      transactionMax: Math.max(...transactionValues),
      groupMin: Math.min(...groupValues),
      groupMax: Math.max(...groupValues),
    }
  }, [transactions, vendorGroups])

  const transactionHeatColour = (transaction: WorkspaceTransaction) =>
    getValueHeatColour(
      getTransactionValue(transaction),
      valueRanges.transactionMin,
      valueRanges.transactionMax,
      0.55,
    )

  const groupHeatColour = (totalAmount: number) =>
    getValueHeatColour(totalAmount, valueRanges.groupMin, valueRanges.groupMax, 0.92)
  
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

  const sortHeader = (column: SortColumn, label: string, align?: 'left' | 'right') => (
    <SortHeader
      column={column}
      label={label}
      align={align}
      currentSortBy={currentSortBy}
      currentSortDirection={currentSortDirection}
      onSort={onSort}
    />
  )

  return (
    <Card>
      <CardHeader title="Transactions" subtitle="Tick off receipts as you collect them and keep the finance trail tidy" />
      {/* Card list runs to lg, so the sort control must too. It used to stop
          at sm, leaving tablets with cards and no way to sort them. */}
      <div className="w-full p-pad-card lg:hidden">
        <Select
          id="mobile-receipts-sort"
          label="Sort"
          value={mobileSortValue}
          onChange={onMobileSort}
          options={mobileSortOptions}
        />
      </div>

      {/* Phones and tablets */}
      <div className="flex flex-col gap-2 px-pad-card pb-pad-card lg:hidden">
        {transactions.length > 0 && shouldGroupByVendor && <ValueHeatLegend />}
        {transactions.length === 0 ? (
          <Empty size="sm" variant="dashed" title={NO_MATCHES} />
        ) : shouldGroupByVendor ? (
          vendorGroups.map((group) => (
            <section key={group.key} className="space-y-2" aria-label={group.vendorName}>
              <div
                className="rounded-default px-3 py-2 text-sm text-on-dark shadow-sm"
                style={{ backgroundColor: groupHeatColour(group.totalAmount) }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold">{group.vendorName}</p>
                  <span className="text-xs font-bold">Total {formatCurrency(group.totalAmount)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-on-dark-muted">
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
                  heatColour={transactionHeatColour(transaction)}
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

      {/* Desktop table */}
      <div className="hidden lg:block">
        {transactions.length > 0 && shouldGroupByVendor && (
          <div className="flex justify-end border-t border-border px-4 py-2">
            <ValueHeatLegend />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              {sortHeader('transaction_date', 'Date')}
              {sortHeader('details', 'Details')}
              <TableHead>Vendor</TableHead>
              <TableHead>Expense type</TableHead>
              {sortHeader('amount_in', 'In', 'right')}
              {sortHeader('amount_out', 'Out', 'right')}
              <TableHead>Status</TableHead>
              <TableHead>Receipts</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="text-sm text-text">
            {transactions.length === 0 && (
              <TableRow>
                <TableCell colSpan={10}>
                  <Empty size="sm" title={NO_MATCHES} />
                </TableCell>
              </TableRow>
            )}
            {transactions.length > 0 && shouldGroupByVendor ? (
              vendorGroups.map((group) => (
                <Fragment key={group.key}>
                  {/* A plain row: its heat colour is worked out per group, and TableRow takes no style. */}
                  <tr
                    className="text-on-dark shadow-sm"
                    style={{ backgroundColor: groupHeatColour(group.totalAmount) }}
                  >
                    <td colSpan={10} className="px-4 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="font-bold">{group.vendorName}</span>
                          <span className="text-xs font-semibold text-on-dark-muted">{group.transactions.length} receipt{group.transactions.length === 1 ? '' : 's'}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs font-bold">
                          <span>Total {formatCurrency(group.totalAmount)}</span>
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
                      heatColour={transactionHeatColour(transaction)}
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
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <TablePagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={pagination.onPageChange}
        />
      )}
    </Card>
  )
}

/**
 * The server sorts every matching transaction and the order lives in the address, so DataTable
 * (which sorts the rows it is given, in memory) cannot do this: the DS Table's sortable header is
 * used. That header only listens for clicks on the cell, which a keyboard cannot reach, so the raw
 * button inside gives it a tab stop; its click bubbles to the cell, so a press sorts once. A DS
 * Button would add its own height and padding to the header row.
 */
function SortHeader({
  column,
  label,
  align = 'left',
  currentSortBy,
  currentSortDirection,
  onSort,
}: {
  column: SortColumn
  label: string
  align?: 'left' | 'right'
  currentSortBy: SortColumn
  currentSortDirection: 'asc' | 'desc'
  onSort: (column: SortColumn) => void
}) {
  const isActive = currentSortBy === column
  return (
    <TableHead
      sortable
      align={align}
      sortDirection={isActive ? currentSortDirection : null}
      onSort={() => onSort(column)}
      className={isActive ? 'text-primary' : undefined}
    >
      <button
        type="button"
        aria-label={`Sort by ${label}`}
        className="rounded-sm uppercase tracking-wider focus-visible:outline-hidden focus-visible:shadow-ring-inset"
      >
        {label}
      </button>
    </TableHead>
  )
}

function ValueHeatLegend() {
  return (
    <div className="flex items-center gap-2 text-meta font-bold text-text-muted">
      <span>Lower value</span>
      {/* The same two colours getValueHeatColour mixes between, as tokens. */}
      <span
        aria-hidden="true"
        className="h-3 w-28 rounded-full border border-border"
        style={{ background: 'linear-gradient(90deg, var(--color-info), var(--color-danger))' }}
      />
      <span>Higher value</span>
    </div>
  )
}
