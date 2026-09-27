'use client'

import { useState, useCallback, useTransition, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Button,
  Input,
  Card,
  CardHeader,
  CardBody,
  ConfirmDialog,
  DataTable,
  Stat,
  StatGrid,
  Empty,
  Icon,
  PageLayout,
  PageLoading,
  ProgressBar,
  Modal,
  IconButton,
  RowActions,
  type Column,
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
import { EXPENSES_LIST_LAYOUT } from '../_shared/nav'

/** The Modal footer's submit button names the expense form by this id. */
const EXPENSE_FORM_ID = 'expense-form'

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)

// Module level so DataTable gets the same function on every render.
const expenseRowKey = (expense: Expense): string => expense.id

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
  // The form saves and uploads itself; the Modal footer's buttons show that it is busy.
  const [formBusy, setFormBusy] = useState(false)

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

  const [expensePendingDelete, setExpensePendingDelete] = useState<Expense | null>(null)

  const handleDeleteExpense = useCallback(
    async (id: string) => {
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

  const hasActiveFilters = Boolean(filters.dateFrom || filters.dateTo || filters.companySearch)
  const highestSupplierSpend = Math.max(...stats.supplierSpend.map((row) => row.amount), 0)

  // The list opens newest first, as it always has. DataTable sorts from there when a header is
  // clicked (it used to be the compat SortableHeader with the useSort hook).
  const expensesByDate = useMemo(
    () => [...expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date)),
    [expenses],
  )

  const expenseColumns: Column<Expense>[] = [
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      sortFn: (a, b) => a.expense_date.localeCompare(b.expense_date),
      cell: (expense) => (
        <span className="text-text-muted">
          {formatDateInLondon(expense.expense_date, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      ),
    },
    {
      key: 'company',
      header: 'Company',
      sortable: true,
      sortFn: (a, b) => a.company_ref.localeCompare(b.company_ref),
      cell: (expense) => expense.company_ref,
    },
    {
      key: 'justification',
      header: 'Justification',
      sortable: true,
      sortFn: (a, b) => a.justification.localeCompare(b.justification),
      className: 'hidden sm:table-cell',
      cell: (expense) => (
        <span className="block max-w-[200px] truncate text-text-muted">{expense.justification}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.amount - b.amount,
      cell: (expense) => <span className="font-medium tabular-nums">{formatCurrency(expense.amount)}</span>,
    },
    {
      key: 'vat',
      header: 'VAT',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.vat_amount - b.vat_amount,
      className: 'hidden md:table-cell',
      cell: (expense) => (
        <span className="text-text-muted tabular-nums">
          {expense.vat_applicable ? formatCurrency(expense.vat_amount) : '-'}
        </span>
      ),
    },
    {
      key: 'receipt',
      header: 'Receipt',
      align: 'center',
      cell: (expense) =>
        expense.file_count > 0 ? (
          <IconButton
            type="button"
            size="sm"
            onClick={(e) => { e.stopPropagation(); handleViewFiles(expense.id) }}
            className="text-success hover:text-success-fg"
            label={`View ${expense.file_count} receipt(s)`}
            icon={<Icon name="check" size={20} />}
          />
        ) : (
          <span className="inline-flex text-danger">
            <Icon name="x" size={20} />
            <span className="sr-only">No receipt</span>
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (expense) => (
        <RowActions
          actions={[
            {
              key: 'delete',
              label: `Delete expense from ${expense.company_ref}`,
              icon: <Icon name="trash" size={16} />,
              tone: 'danger',
              onSelect: () => setExpensePendingDelete(expense),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <PageLayout
      {...EXPENSES_LIST_LAYOUT}
      headerActions={
        <Button variant="primary" size="sm" onClick={handleCreate}>
          New Expense
        </Button>
      }
    >
      {/* Stats row */}
      <StatGrid columns={3}>
        <Stat label="This Quarter" value={formatCurrency(stats.quarterTotal)} />
        <Stat label="VAT Reclaimable" value={formatCurrency(stats.vatReclaimable)} />
        <Stat
          label="Missing Receipts"
          value={String(stats.missingReceipts)}
          tone={stats.missingReceipts > 0 ? 'warning' : 'default'}
          hint={stats.missingReceipts > 0 ? 'Needs attention' : 'All receipts present'}
        />
      </StatGrid>

      {/* Two-column layout: table + sidebar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: filters and the expense table */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input
              id="filter-from"
              label="From"
              type="date"
              value={filters.dateFrom ?? ''}
              onChange={(e) => handleFilterChange({ dateFrom: e.target.value || undefined })}
            />
            <Input
              id="filter-to"
              label="To"
              type="date"
              value={filters.dateTo ?? ''}
              onChange={(e) => handleFilterChange({ dateTo: e.target.value || undefined })}
            />
            <Input
              id="filter-company"
              label="Company"
              type="text"
              placeholder="Search..."
              value={filters.companySearch ?? ''}
              onChange={(e) => handleFilterChange({ companySearch: e.target.value || undefined })}
            />
          </div>

          <Card padding="none">
            {expenses.length === 0 ? (
              isPending ? (
                <PageLoading inline />
              ) : (
                <Empty
                  size="sm"
                  title={hasActiveFilters ? 'No expenses match these filters' : 'No expenses yet'}
                  description={
                    hasActiveFilters
                      ? 'Change or clear the filters to see more expenses.'
                      : 'Use New Expense to add one.'
                  }
                />
              )
            ) : (
              <DataTable
                data={expensesByDate}
                columns={expenseColumns}
                getRowKey={expenseRowKey}
                onRowClick={(expense) => { void handleEdit(expense) }}
                clickableRows
                bordered={false}
              />
            )}
          </Card>
        </div>

        {/* Right: Supplier breakdown sidebar with ProgressBars */}
        <div>
          <Card>
            <CardHeader title="Supplier Spend" subtitle="This quarter" />
            <CardBody>
              {stats.supplierSpend.length === 0 ? (
                <Empty size="sm" title="No supplier spend for this period" description="No expenses were recorded this quarter." />
              ) : (
                <div className="space-y-4">
                  {stats.supplierSpend.map((row) => {
                    const pct = highestSupplierSpend > 0 ? Math.round((row.amount / highestSupplierSpend) * 100) : 0
                    return (
                      <div key={row.supplier}>
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-medium text-text">{row.supplier}</span>
                          <span className="shrink-0 text-meta tabular-nums text-text-muted">
                            {formatCurrency(row.amount)}
                          </span>
                        </div>
                        <ProgressBar value={pct} tone="primary" label={`${row.supplier} spend`} />
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Form modal: the DS Modal gives a mobile bottom-sheet, focus trap and Escape-to-close */}
      {showForm && (
        <Modal
          open
          onClose={() => setShowForm(false)}
          title={editingExpense ? 'Edit Expense' : 'New Expense'}
          width="lg"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)} disabled={formBusy}>
                Cancel
              </Button>
              <Button type="submit" form={EXPENSE_FORM_ID} variant="primary" loading={formBusy}>
                {editingExpense ? 'Save Changes' : 'Create Expense'}
              </Button>
            </>
          }
        >
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
            formId={EXPENSE_FORM_ID}
            onBusyChange={setFormBusy}
          />
        </Modal>
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

      <ConfirmDialog
        open={expensePendingDelete !== null}
        title="Delete Expense"
        message="Delete this expense and all attached receipts?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (expensePendingDelete) await handleDeleteExpense(expensePendingDelete.id)
        }}
        onClose={() => setExpensePendingDelete(null)}
      />
    </PageLayout>
  )
}
