'use client'

import { useState, useCallback, useTransition, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  getExpenses,
  getExpenseStats,
  getExpenseFiles,
  createExpense,
  updateExpense,
  deleteExpense,
  uploadExpenseFile,
  deleteExpenseFile,
  type Expense,
  type ExpenseStats,
  type ExpenseFile,
  type ExpenseFilters,
} from '@/app/actions/expenses'
import { ExpenseForm, type ExpenseFormData, type ExistingFile } from './ExpenseForm'
import { ExpenseFileViewer } from './ExpenseFileViewer'
import { useSort } from '@/hooks/useSort'
import { SortableHeader } from '@/components/ui/SortableHeader'

// ---------------------------------------------------------------------------
// Currency formatter
// ---------------------------------------------------------------------------

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExpensesClientProps {
  initialExpenses: Expense[]
  initialStats: ExpenseStats
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpensesClient({
  initialExpenses,
  initialStats,
}: ExpensesClientProps): React.JSX.Element {
  const searchParams = useSearchParams()
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses)
  const [stats, setStats] = useState<ExpenseStats>(initialStats)
  const [filters, setFilters] = useState<ExpenseFilters>(() => {
    const from = searchParams.get('from') ?? undefined
    const to = searchParams.get('to') ?? undefined
    return { dateFrom: from, dateTo: to }
  })
  const [isPending, startTransition] = useTransition()

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  type ExpenseSortKey = 'date' | 'company' | 'justification' | 'amount' | 'vat'

  const expenseComparators = useMemo(
    () => ({
      date: (a: Expense, b: Expense) => a.expense_date.localeCompare(b.expense_date),
      company: (a: Expense, b: Expense) => a.company_ref.localeCompare(b.company_ref),
      justification: (a: Expense, b: Expense) => a.justification.localeCompare(b.justification),
      amount: (a: Expense, b: Expense) => a.amount - b.amount,
      vat: (a: Expense, b: Expense) => a.vat_amount - b.vat_amount,
    }),
    []
  )

  const {
    sortedData: sortedExpenses,
    sort: expenseSort,
    toggleSort: toggleExpenseSort,
  } = useSort<Expense, ExpenseSortKey>(expenses, 'date', 'desc', expenseComparators)

  // Apply URL search params as initial filters on mount
  useEffect(() => {
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (from || to) {
      const initialFilters: ExpenseFilters = {
        dateFrom: from ?? undefined,
        dateTo: to ?? undefined,
      }
      startTransition(async () => {
        const result = await getExpenses(initialFilters)
        if (result.success && result.data) setExpenses(result.data)
      })
    }
  }, [])

  // Modal state
  const [showForm, setShowForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [editingFiles, setEditingFiles] = useState<ExistingFile[]>([])
  const [createdExpenseId, setCreatedExpenseId] = useState<string | null>(null)

  // File viewer state
  const [viewerFiles, setViewerFiles] = useState<ExpenseFile[]>([])
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerIndex, setViewerIndex] = useState(0)

  // ---------------------------------------------------------------------------
  // Data refresh
  // ---------------------------------------------------------------------------

  const refreshData = useCallback(() => {
    startTransition(async () => {
      const [expResult, statsResult] = await Promise.all([
        getExpenses(filters),
        getExpenseStats(),
      ])
      if (expResult.success && expResult.data) setExpenses(expResult.data)
      if (statsResult.success && statsResult.data) setStats(statsResult.data)
    })
  }, [filters])

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------

  const handleFilterChange = useCallback(
    (newFilters: Partial<ExpenseFilters>) => {
      const merged = { ...filters, ...newFilters }
      setFilters(merged)
      startTransition(async () => {
        const result = await getExpenses(merged)
        if (result.success && result.data) setExpenses(result.data)
      })
    },
    [filters]
  )

  // ---------------------------------------------------------------------------
  // CRUD handlers
  // ---------------------------------------------------------------------------

  const handleCreate = useCallback(async () => {
    setEditingExpense(null)
    setEditingFiles([])
    setCreatedExpenseId(null)
    setShowForm(true)
  }, [])

  const handleEdit = useCallback(async (expense: Expense) => {
    setEditingExpense(expense)
    setCreatedExpenseId(null)

    // Load existing files
    const result = await getExpenseFiles(expense.id)
    if (result.success && result.data) {
      setEditingFiles(
        result.data.map((f) => ({
          id: f.id,
          file_name: f.file_name,
          mime_type: f.mime_type,
          signed_url: f.signed_url,
        }))
      )
    } else {
      setEditingFiles([])
    }

    setShowForm(true)
  }, [])

  const handleSubmit = useCallback(
    async (data: ExpenseFormData): Promise<{ success?: boolean; error?: string; createdId?: string }> => {
      if (editingExpense) {
        const result = await updateExpense({ ...data, id: editingExpense.id })
        if (result.success) {
          refreshData()
          setShowForm(false)
        }
        return result
      } else {
        const result = await createExpense(data)
        if (result.success && result.data) {
          setCreatedExpenseId(result.data.id)
          refreshData()
          // Don't close form yet — let file upload complete
          // Return the created ID so the form can pass it synchronously to upload
          return { success: true, createdId: result.data.id }
        }
        return { success: result.success, error: result.error }
      }
    },
    [editingExpense, refreshData]
  )

  const handleUploadFiles = useCallback(
    async (files: File[], expenseId?: string): Promise<{ success?: boolean; error?: string }> => {
      const targetId = expenseId ?? editingExpense?.id ?? createdExpenseId
      if (!targetId) return { error: 'No expense to attach files to' }

      const formData = new FormData()
      formData.set('expense_id', targetId)
      for (const file of files) {
        formData.append('file', file)
      }

      const result = await uploadExpenseFile(formData)
      if (result.success) {
        refreshData()
        setShowForm(false)
      }
      return { success: result.success, error: result.error }
    },
    [editingExpense, createdExpenseId, refreshData]
  )

  const handleDeleteFile = useCallback(
    async (fileId: string): Promise<{ success?: boolean; error?: string }> => {
      const result = await deleteExpenseFile(fileId)
      if (result.success) {
        setEditingFiles((prev) => prev.filter((f) => f.id !== fileId))
        refreshData()
      }
      return result
    },
    [refreshData]
  )

  const handleDeleteExpense = useCallback(
    async (id: string) => {
      if (!confirm('Delete this expense and all attached receipts?')) return
      const result = await deleteExpense(id)
      if (result.success) {
        refreshData()
      }
    },
    [refreshData]
  )

  // ---------------------------------------------------------------------------
  // File viewer
  // ---------------------------------------------------------------------------

  const handleViewFiles = useCallback(async (expenseId: string) => {
    const result = await getExpenseFiles(expenseId)
    if (result.success && result.data && result.data.length > 0) {
      setViewerFiles(result.data)
      setViewerIndex(0)
      setViewerOpen(true)
    }
  }, [])

  const handleViewerDelete = useCallback(
    async (fileId: string): Promise<{ error?: string }> => {
      const result = await deleteExpenseFile(fileId)
      if (result.success) {
        setViewerFiles((prev) => prev.filter((f) => f.id !== fileId))
        refreshData()
        return {}
      }
      return { error: result.error }
    },
    [refreshData]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="This Quarter" value={formatCurrency(stats.quarterTotal)} />
        <StatCard label="VAT Reclaimable" value={formatCurrency(stats.vatReclaimable)} />
        <StatCard
          label="Missing Receipts"
          value={stats.missingReceipts.toString()}
          variant={stats.missingReceipts > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Filters + New button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <label htmlFor="filter-from" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              From
            </label>
            <input
              id="filter-from"
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => handleFilterChange({ dateFrom: e.target.value || undefined })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label htmlFor="filter-to" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              To
            </label>
            <input
              id="filter-to"
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => handleFilterChange({ dateTo: e.target.value || undefined })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div>
            <label htmlFor="filter-company" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Company
            </label>
            <input
              id="filter-company"
              type="text"
              placeholder="Search..."
              value={filters.companySearch ?? ''}
              onChange={(e) => handleFilterChange({ companySearch: e.target.value || undefined })}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New Expense
        </button>
      </div>

      {/* Expense table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <SortableHeader
                label="Date"
                column="date"
                currentColumn={expenseSort.column}
                currentDirection={expenseSort.direction}
                onSort={toggleExpenseSort}
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              />
              <SortableHeader
                label="Company"
                column="company"
                currentColumn={expenseSort.column}
                currentDirection={expenseSort.direction}
                onSort={toggleExpenseSort}
                className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              />
              <SortableHeader
                label="Justification"
                column="justification"
                currentColumn={expenseSort.column}
                currentDirection={expenseSort.direction}
                onSort={toggleExpenseSort}
                className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 sm:table-cell"
              />
              <SortableHeader
                label="Amount"
                column="amount"
                currentColumn={expenseSort.column}
                currentDirection={expenseSort.direction}
                onSort={toggleExpenseSort}
                className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
              />
              <SortableHeader
                label="VAT"
                column="vat"
                currentColumn={expenseSort.column}
                currentDirection={expenseSort.direction}
                onSort={toggleExpenseSort}
                className="hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 md:table-cell"
              />
              <th scope="col" className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Receipt
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
            {expenses.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  {isPending ? 'Loading...' : 'No expenses found. Click "New Expense" to add one.'}
                </td>
              </tr>
            )}
            {sortedExpenses.map((expense) => (
              <tr
                key={expense.id}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                onClick={() => handleEdit(expense)}
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                  {formatDateInLondon(expense.expense_date, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                  {expense.company_ref}
                </td>
                <td className="hidden max-w-[200px] truncate px-4 py-3 text-sm text-gray-500 dark:text-gray-400 sm:table-cell">
                  {expense.justification}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                  {formatCurrency(expense.amount)}
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400 md:table-cell">
                  {expense.vat_applicable ? formatCurrency(expense.vat_amount) : '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  {expense.file_count > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleViewFiles(expense.id)
                      }}
                      className="inline-flex items-center text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                      aria-label={`View ${expense.file_count} receipt(s)`}
                    >
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  ) : (
                    <svg className="mx-auto h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteExpense(expense.id)
                    }}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    aria-label={`Delete expense from ${expense.company_ref}`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowForm(false)
          }}
          role="dialog"
          aria-modal="true"
          aria-label={editingExpense ? 'Edit expense' : 'New expense'}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {editingExpense ? 'Edit Expense' : 'New Expense'}
            </h2>
            <ExpenseForm
              initialData={
                editingExpense
                  ? {
                      id: editingExpense.id,
                      expense_date: editingExpense.expense_date,
                      company_ref: editingExpense.company_ref,
                      justification: editingExpense.justification,
                      amount: editingExpense.amount,
                      vat_applicable: editingExpense.vat_applicable,
                      vat_amount: editingExpense.vat_amount,
                      notes: editingExpense.notes ?? '',
                    }
                  : undefined
              }
              existingFiles={editingFiles}
              onSubmit={handleSubmit}
              onUploadFiles={handleUploadFiles}
              onDeleteFile={handleDeleteFile}
              onCancel={() => setShowForm(false)}
              isEditing={!!editingExpense}
            />
          </div>
        </div>
      )}

      {/* File viewer */}
      {viewerOpen && viewerFiles.length > 0 && (
        <ExpenseFileViewer
          files={viewerFiles.map((f) => ({
            id: f.id,
            file_name: f.file_name,
            mime_type: f.mime_type,
            signed_url: f.signed_url,
          }))}
          initialIndex={viewerIndex}
          onClose={() => setViewerOpen(false)}
          onDelete={handleViewerDelete}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat card subcomponent
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  variant = 'default',
}: {
  label: string
  value: string
  variant?: 'default' | 'warning'
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <dt className="truncate text-sm font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold tracking-tight ${
          variant === 'warning'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
