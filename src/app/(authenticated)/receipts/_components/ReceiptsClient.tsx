'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState, useEffect, ChangeEvent, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'react-hot-toast'
import {
  type ReceiptWorkspaceData,
  type ReceiptWorkspaceFilters,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'
import { ReceiptStats } from './ui/ReceiptStats'
import { ReceiptUpload } from './ui/ReceiptUpload'
import { ReceiptExport } from './ui/ReceiptExport'
import { ReceiptFilters } from './ui/ReceiptFilters'
import { ReceiptList } from './ui/ReceiptList'
import { ReceiptRules } from './ui/ReceiptRules'
import { usePermissions } from '@/contexts/PermissionContext'
import { Button } from '@/components/ui-v2/forms/Button'

interface ReceiptsClientProps {
  initialData: ReceiptWorkspaceData
  initialFilters: {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    showOnlyOutstanding: boolean
    missingVendorOnly: boolean
    missingExpenseOnly: boolean
    search: string
    month?: string
    sortBy?: ReceiptWorkspaceFilters['sortBy']
    sortDirection?: 'asc' | 'desc'
  }
}

const summaryStatusTotalsKey: Record<ReceiptTransaction['status'], 'pending' | 'completed' | 'autoCompleted' | 'noReceiptRequired' | 'cantFind'> = {
  pending: 'pending',
  completed: 'completed',
  auto_completed: 'autoCompleted',
  no_receipt_required: 'noReceiptRequired',
  cant_find: 'cantFind',
}

function updateSummaryForStatusChange(
  update: Dispatch<SetStateAction<ReceiptWorkspaceData['summary']>>,
  previousStatus?: ReceiptTransaction['status'],
  nextStatus?: ReceiptTransaction['status']
) {
  if (!previousStatus || !nextStatus || previousStatus === nextStatus) return
  const prevKey = summaryStatusTotalsKey[previousStatus]
  const nextKey = summaryStatusTotalsKey[nextStatus]
  if (prevKey === nextKey) return

  update(prev => ({
    ...prev,
    totals: {
      ...prev.totals,
      [prevKey]: Math.max(0, prev.totals[prevKey] - 1),
      [nextKey]: prev.totals[nextKey] + 1,
    },
  }))
}

export default function ReceiptsClient({ initialData, initialFilters }: ReceiptsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')

  const { rules, knownVendors, availableMonths, pagination } = initialData
  const [transactions, setTransactions] = useState(initialData.transactions)
  const [summary, setSummary] = useState(initialData.summary)
  const [pendingRuleSuggestion, setPendingRuleSuggestion] = useState<ClassificationRuleSuggestion | null>(null)

  useEffect(() => {
    setTransactions(initialData.transactions)
  }, [initialData.transactions])

  useEffect(() => {
    setSummary(initialData.summary)
  }, [initialData.summary])

  // Sorting Logic
  type SortColumn = NonNullable<ReceiptWorkspaceFilters['sortBy']>
  const defaultSortColumn: SortColumn = !initialFilters.month ? 'amount_total' : 'transaction_date'
  const defaultSort = { column: defaultSortColumn, direction: 'desc' } as const
  const currentSortBy = (initialFilters.sortBy ?? defaultSort.column) as SortColumn
  const currentSortDirection = initialFilters.sortDirection ?? defaultSort.direction

  function updateQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })
    // If we are not explicitly setting the page, reset it when filters change
    if (!next.page) {
      params.delete('page')
    }
    const query = params.toString()
    router.replace(`/receipts${query ? `?${query}` : ''}`, { scroll: false })
  }

  function handlePageChange(newPage: number) {
    updateQuery({ page: newPage.toString() })
  }

  function applySort(column: SortColumn, direction: 'asc' | 'desc') {
    const isDefault = column === defaultSort.column && direction === defaultSort.direction
    updateQuery({
      sort: isDefault ? null : column,
      sortDirection: isDefault ? null : direction,
    })
  }

  function handleSort(column: SortColumn) {
    let nextDirection: 'asc' | 'desc' = (column === 'transaction_date' || column === 'amount_total') ? 'desc' : 'asc'
    if (currentSortBy === column) {
      nextDirection = currentSortDirection === 'asc' ? 'desc' : 'asc'
    }
    applySort(column, nextDirection)
  }

  function handleMobileSortChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (!value) return
    const [column, direction] = value.split(':') as [SortColumn, 'asc' | 'desc']
    applySort(column, direction)
  }

  // Optimistic State Updates
  function handleTransactionChange(updated: typeof transactions[number], previousStatus?: ReceiptTransaction['status']) {
    setTransactions(prev => prev.map(tx => tx.id === updated.id ? updated : tx))

    updateSummaryForStatusChange(setSummary, previousStatus, updated.status)
  }

  function handleTransactionRemove(
    id: string,
    previousStatus: ReceiptTransaction['status'],
    nextStatus?: ReceiptTransaction['status']
  ) {
    setTransactions(prev => prev.filter(tx => tx.id !== id))
    updateSummaryForStatusChange(setSummary, previousStatus, nextStatus ?? previousStatus)
  }

  const totalPages = Math.ceil(pagination.total / pagination.pageSize)
  const hasNextPage = pagination.page < totalPages
  const hasPrevPage = pagination.page > 1

  return (
    <div className="space-y-6">
      <ReceiptStats summary={summary} />

      <div className="hidden md:grid md:gap-4 md:grid-cols-5">
        <ReceiptUpload lastImport={summary.lastImport} />
        <ReceiptExport />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <ReceiptFilters
          filters={initialFilters}
          availableMonths={availableMonths}
        />

        <ReceiptList
          transactions={transactions}
          knownVendors={knownVendors}
          filters={{
              sortBy: currentSortBy,
              sortDirection: currentSortDirection,
              status: initialFilters.status,
              showOnlyOutstanding: initialFilters.showOnlyOutstanding,
              missingVendorOnly: initialFilters.missingVendorOnly,
              missingExpenseOnly: initialFilters.missingExpenseOnly,
          }}
          onSort={handleSort}
          onMobileSort={handleMobileSortChange}
          onTransactionChange={handleTransactionChange}
          onTransactionRemove={handleTransactionRemove}
          onRuleSuggestion={setPendingRuleSuggestion}
        />

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-500">
              Page {pagination.page} of {totalPages} <span className="hidden sm:inline">({pagination.total} items)</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasPrevPage}
                onClick={() => handlePageChange(pagination.page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasNextPage}
                onClick={() => handlePageChange(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <ReceiptRules
        rules={rules}
        pendingSuggestion={pendingRuleSuggestion}
        onApplySuggestion={() => setPendingRuleSuggestion(null)}
        onDismissSuggestion={() => setPendingRuleSuggestion(null)}
      />
    </div>
  )
}
