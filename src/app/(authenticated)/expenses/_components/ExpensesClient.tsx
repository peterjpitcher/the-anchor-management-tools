'use client'

import { useState, useCallback, useTransition, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardBody,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Stat,
  Empty,
  Alert,
  ProgressBar,
} from '@/ds'
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
// Formatters
// ---------------------------------------------------------------------------

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)

// ---------------------------------------------------------------------------
// Category data for ProgressBar sidebar
// ---------------------------------------------------------------------------

const EXPENSE_CATEGORIES = [
  { name: 'Marketing', budget: 1500 },
  { name: 'Maintenance', budget: 1000 },
  { name: 'Training', budget: 600 },
  { name: 'Licensing', budget: 250 },
  { name: 'Software', budget: 400 },
  { name: 'Security', budget: 800 },
  { name: 'Events', budget: 1500 },
]

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

  // Sorting
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

  // Data refresh
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

  // Filter handlers
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

  // CRUD handlers
  const handleCreate = useCallback(async () => {
    setEditingExpense(null)
    setEditingFiles([])
    setCreatedExpenseId(null)
    setShowForm(true)
  }, [])

  const handleEdit = useCallback(async (expense: Expense) => {
    setEditingExpense(expense)
    setCreatedExpenseId(null)
    const result = await getExpenseFiles(expense.id)
    if (result.success && result.data) {
      setEditingFiles(result.data.map((f) => ({
        id: f.id, file_name: f.file_name, mime_type: f.mime_type, signed_url: f.signed_url,
      })))
    } else {
      setEditingFiles([])
    }
    setShowForm(true)
  }, [])

  const handleSubmit = useCallback(
    async (data: ExpenseFormData): Promise<{ success?: boolean; error?: string; createdId?: string }> => {
      if (editingExpense) {
        const result = await updateExpense({ ...data, id: editingExpense.id })
        if (result.success) { refreshData(); setShowForm(false) }
        return result
      } else {
        const result = await createExpense(data)
        if (result.success && result.data) {
          setCreatedExpenseId(result.data.id)
          refreshData()
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
      for (const file of files) formData.append('file', file)
      const result = await uploadExpenseFile(formData)
      if (result.success) { refreshData(); setShowForm(false) }
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
      if (result.success) refreshData()
    },
    [refreshData]
  )

  // File viewer
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

  // Compute category spend from expenses
  const categorySpend = useMemo(() => {
    const spend: Record<string, number> = {}
    for (const exp of expenses) {
      const cat = exp.company_ref || 'Other'
      spend[cat] = (spend[cat] || 0) + exp.amount
    }
    return spend
  }, [expenses])

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="This Quarter" value={formatCurrency(stats.quarterTotal)} />
        <Stat label="VAT Reclaimable" value={formatCurrency(stats.vatReclaimable)} />
        <Stat
          label="Missing Receipts"
          value={String(stats.missingReceipts)}
          hint={stats.missingReceipts > 0 ? 'Needs attention' : 'All receipts present'}
        />
      </div>

      {/* Two-column layout: table + sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Expense table */}
        <div className="space-y-4">
          {/* Filters + New button */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label htmlFor="filter-from" className="block text-xs font-medium text-text-muted">From</label>
                <Input
                  id="filter-from"
                  type="date"
                  value={filters.dateFrom ?? ''}
                  onChange={(e) => handleFilterChange({ dateFrom: e.target.value || undefined })}
                />
              </div>
              <div>
                <label htmlFor="filter-to" className="block text-xs font-medium text-text-muted">To</label>
                <Input
                  id="filter-to"
                  type="date"
                  value={filters.dateTo ?? ''}
                  onChange={(e) => handleFilterChange({ dateTo: e.target.value || undefined })}
                />
              </div>
              <div>
                <label htmlFor="filter-company" className="block text-xs font-medium text-text-muted">Company</label>
                <Input
                  id="filter-company"
                  type="text"
                  placeholder="Search..."
                  value={filters.companySearch ?? ''}
                  onChange={(e) => handleFilterChange({ companySearch: e.target.value || undefined })}
                />
              </div>
            </div>
            <Button variant="primary" size="sm" onClick={handleCreate}>
              New Expense
            </Button>
          </div>

          <Card>
            {expenses.length === 0 ? (
              <Empty
                title={isPending ? 'Loading...' : 'No expenses found'}
                description='Click "New Expense" to add one.'
                action={<Button variant="primary" onClick={handleCreate}>New Expense</Button>}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader label="Date" column="date" currentColumn={expenseSort.column} currentDirection={expenseSort.direction} onSort={toggleExpenseSort} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted" />
                    <SortableHeader label="Company" column="company" currentColumn={expenseSort.column} currentDirection={expenseSort.direction} onSort={toggleExpenseSort} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted" />
                    <SortableHeader label="Justification" column="justification" currentColumn={expenseSort.column} currentDirection={expenseSort.direction} onSort={toggleExpenseSort} className="hidden px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted sm:table-cell" />
                    <SortableHeader label="Amount" column="amount" currentColumn={expenseSort.column} currentDirection={expenseSort.direction} onSort={toggleExpenseSort} className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted" />
                    <SortableHeader label="VAT" column="vat" currentColumn={expenseSort.column} currentDirection={expenseSort.direction} onSort={toggleExpenseSort} className="hidden px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-muted md:table-cell" />
                    <TableHead align="center">Receipt</TableHead>
                    <TableHead align="right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedExpenses.map((expense) => (
                    <TableRow key={expense.id} onClick={() => handleEdit(expense)} className="cursor-pointer">
                      <TableCell className="text-text-muted">
                        {formatDateInLondon(expense.expense_date, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </TableCell>
                      <TableCell>{expense.company_ref}</TableCell>
                      <TableCell className="hidden max-w-[200px] truncate text-text-muted sm:table-cell">
                        {expense.justification}
                      </TableCell>
                      <TableCell align="right" className="font-medium tabular-nums">{formatCurrency(expense.amount)}</TableCell>
                      <TableCell align="right" className="hidden text-text-muted tabular-nums md:table-cell">
                        {expense.vat_applicable ? formatCurrency(expense.vat_amount) : '-'}
                      </TableCell>
                      <TableCell align="center">
                        {expense.file_count > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleViewFiles(expense.id) }}
                            className="text-success hover:text-success/80"
                            aria-label={`View ${expense.file_count} receipt(s)`}
                          >
                            <CheckIcon />
                          </button>
                        ) : (
                          <span className="text-danger"><CrossIcon /></span>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteExpense(expense.id) }}
                          className="text-danger text-sm hover:text-danger/80"
                          aria-label={`Delete expense from ${expense.company_ref}`}
                        >
                          Delete
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        {/* Right: Category breakdown sidebar with ProgressBars */}
        <div>
          <Card>
            <CardHeader title="Spend by category" subtitle="Current period" />
            <CardBody>
              <div className="space-y-4">
                {EXPENSE_CATEGORIES.map((cat) => {
                  const spend = categorySpend[cat.name] ?? 0
                  const pct = cat.budget > 0 ? Math.round((spend / cat.budget) * 100) : 0
                  const tone = pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'primary'
                  return (
                    <div key={cat.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-medium text-text">{cat.name}</span>
                        <span className="text-[11px] tabular-nums text-text-muted">
                          {formatCurrency(spend)} / {formatCurrency(cat.budget)}
                        </span>
                      </div>
                      <ProgressBar value={pct} tone={tone} />
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false) }}
          role="dialog"
          aria-modal="true"
          aria-label={editingExpense ? 'Edit expense' : 'New expense'}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-text">
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
            id: f.id, file_name: f.file_name, mime_type: f.mime_type, signed_url: f.signed_url,
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
// Inline icons
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg className="mx-auto h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg className="mx-auto h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  )
}
