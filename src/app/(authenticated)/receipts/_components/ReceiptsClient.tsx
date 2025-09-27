'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState, useTransition, useRef, ChangeEvent, FormEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import { Pagination } from '@/components/Pagination'
import {
  importReceiptStatement,
  markReceiptTransaction,
  uploadReceiptForTransaction,
  deleteReceiptFile,
  toggleReceiptRule,
  createReceiptRule,
  updateReceiptRule,
  deleteReceiptRule,
  getReceiptSignedUrl,
  type ReceiptWorkspaceData,
  type ReceiptWorkspaceFilters,
} from '@/app/actions/receipts'
import type { ReceiptRule, ReceiptTransaction, ReceiptFile } from '@/types/database'
import { DocumentArrowDownIcon, ArrowPathIcon, CheckCircleIcon, XCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'

interface ReceiptsClientProps {
  initialData: ReceiptWorkspaceData
  initialFilters: ReceiptWorkspaceFilters & {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    showOnlyOutstanding: boolean
    search: string
    page: number
    sortBy?: ReceiptWorkspaceFilters['sortBy']
    sortDirection?: 'asc' | 'desc'
  }
}

const statusLabels: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
}

function formatCurrency(value: number | null) {
  if (!value) return ''
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatDate(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function buildReceiptName(details: string, amount: number | null) {
  const safeDetails = details
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
  const amountLabel = amount ? amount.toFixed(2) : '0.00'
  return `${safeDetails} · £${amountLabel}`
}

export default function ReceiptsClient({ initialData, initialFilters }: ReceiptsClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [statementFile, setStatementFile] = useState<File | null>(null)
  const [activeTransactionId, setActiveTransactionId] = useState<string | null>(null)
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [isStatementPending, startStatementTransition] = useTransition()
  const [isRowPending, startRowTransition] = useTransition()
  const [isRulePending, startRuleTransition] = useTransition()
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({})

  const { summary, transactions, rules, pagination } = initialData
  const currentSortBy = (initialFilters.sortBy ?? 'transaction_date') as NonNullable<ReceiptWorkspaceFilters['sortBy']>
  const currentSortDirection: 'asc' | 'desc' = initialFilters.sortDirection ?? 'desc'
  const defaultSort: { column: NonNullable<ReceiptWorkspaceFilters['sortBy']>; direction: 'asc' | 'desc' } = {
    column: 'transaction_date',
    direction: 'desc',
  }

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize))

  const statusOptions = useMemo(() => (
    [
      { value: 'all', label: 'All statuses' },
      { value: 'pending', label: 'Pending' },
      { value: 'completed', label: 'Completed' },
      { value: 'auto_completed', label: 'Auto completed' },
      { value: 'no_receipt_required', label: 'No receipt required' },
    ]
  ), [])

  const directionOptions = useMemo(() => (
    [
      { value: 'all', label: 'All directions' },
      { value: 'out', label: 'Money out' },
      { value: 'in', label: 'Money in' },
    ]
  ), [])

  function updateQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'all') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })
    params.delete('page')
    const query = params.toString()
    router.push(`/receipts${query ? `?${query}` : ''}`)
  }

  function handleSort(column: NonNullable<ReceiptWorkspaceFilters['sortBy']>) {
    let nextDirection: 'asc' | 'desc' = column === 'transaction_date' ? 'desc' : 'asc'

    if (currentSortBy === column) {
      nextDirection = currentSortDirection === 'asc' ? 'desc' : 'asc'
    }

    const isDefault = column === defaultSort.column && nextDirection === defaultSort.direction

    updateQuery({
      sort: isDefault ? null : column,
      sortDirection: isDefault ? null : nextDirection,
    })
  }

  async function handleStatementSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!statementFile) {
      toast.error('Please choose a CSV bank statement to upload.')
      return
    }
    const formData = new FormData()
    formData.append('statement', statementFile)

    startStatementTransition(async () => {
      const result = await importReceiptStatement(formData)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Imported ${result?.inserted ?? 0} new transactions${result?.autoApplied ? ` · ${result.autoApplied} auto-matched` : ''}`)
      setStatementFile(null)
      router.refresh()
    })
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    updateQuery({ status: event.target.value })
  }

  function handleDirectionChange(event: ChangeEvent<HTMLSelectElement>) {
    updateQuery({ direction: event.target.value })
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const query = (formData.get('search') as string)?.trim() ?? ''
    updateQuery({ search: query || null })
  }

  function handleOutstandingToggle(event: ChangeEvent<HTMLInputElement>) {
    updateQuery({ outstanding: event.target.checked ? null : '0' })
  }

  function handlePageChange(page: number) {
    if (page < 1 || page > totalPages) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    const query = params.toString()
    router.push(`/receipts${query ? `?${query}` : ''}`)
  }

  function handleFileInputRef(transactionId: string, element: HTMLInputElement | null) {
    fileInputsRef.current[transactionId] = element
  }

  async function handleStatusUpdate(transactionId: string, status: ReceiptTransaction['status']) {
    setActiveTransactionId(transactionId)
    startRowTransition(async () => {
      const result = await markReceiptTransaction({ transactionId, status })
      if (result?.error) {
        toast.error(result.error)
        setActiveTransactionId(null)
        return
      }
      toast.success('Transaction updated')
      router.refresh()
      setActiveTransactionId(null)
    })
  }

  function handleUploadClick(transactionId: string) {
    const input = fileInputsRef.current[transactionId]
    if (input) {
      input.click()
    }
  }

  async function handleReceiptUpload(transactionId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const formData = new FormData()
    formData.append('transactionId', transactionId)
    formData.append('receipt', file)

    setActiveTransactionId(transactionId)
    startRowTransition(async () => {
      const result = await uploadReceiptForTransaction(formData)
      if (result?.error) {
        toast.error(result.error)
        setActiveTransactionId(null)
        return
      }
      toast.success('Receipt uploaded and transaction completed')
      router.refresh()
      setActiveTransactionId(null)
    })
  }

  async function handleReceiptDownload(fileId: string) {
    const result = await getReceiptSignedUrl(fileId)
    if (result?.error || !result?.url) {
      toast.error(result?.error ?? 'Unable to download receipt')
      return
    }
    window.open(result.url, '_blank', 'noopener')
  }

  async function handleReceiptDelete(fileId: string, transactionId: string) {
    setActiveTransactionId(transactionId)
    startRowTransition(async () => {
      const result = await deleteReceiptFile(fileId)
      if (result?.error) {
        toast.error(result.error)
        setActiveTransactionId(null)
        return
      }
      toast.success('Receipt removed')
      router.refresh()
      setActiveTransactionId(null)
    })
  }

  async function handleRuleToggle(rule: ReceiptRule) {
    setActiveRuleId(rule.id)
    startRuleTransition(async () => {
      const result = await toggleReceiptRule(rule.id, !rule.is_active)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success(`Rule ${rule.is_active ? 'disabled' : 'enabled'}`)
      router.refresh()
      setActiveRuleId(null)
    })
  }

  async function handleRuleDelete(ruleId: string) {
    if (!confirm('Delete this rule?')) return
    setActiveRuleId(ruleId)
    startRuleTransition(async () => {
      const result = await deleteReceiptRule(ruleId)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success('Rule deleted')
      router.refresh()
      setActiveRuleId(null)
    })
  }

  async function handleRuleSubmit(event: FormEvent<HTMLFormElement>, ruleId?: string) {
    event.preventDefault()
    const formElement = event.currentTarget
    const formData = new FormData(formElement)

    setActiveRuleId(ruleId ?? 'new')
    startRuleTransition(async () => {
      const result = ruleId
        ? await updateReceiptRule(ruleId, formData)
        : await createReceiptRule(formData)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success(`Rule ${ruleId ? 'updated' : 'created'}`)
      setEditingRuleId(null)
      formElement.reset()
      router.refresh()
      setActiveRuleId(null)
    })
  }

  function handleExportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const year = formData.get('year') as string
    const quarter = formData.get('quarter') as string
    if (!year || !quarter) {
      toast.error('Select a year and quarter to export')
      return
    }
    const url = `/api/receipts/export?year=${encodeURIComponent(year)}&quarter=${encodeURIComponent(quarter)}`
    window.location.href = url
  }

  const currentYear = new Date().getUTCFullYear()
  const exportYears = [currentYear, currentYear - 1, currentYear - 2]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Pending" value={summary.totals.pending} tone="warning" />
        <SummaryCard title="Completed" value={summary.totals.completed} tone="success" />
        <SummaryCard title="Auto-matched" value={summary.totals.autoCompleted} tone="info" />
        <SummaryCard title="No receipt required" value={summary.totals.noReceiptRequired} tone="neutral" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" header={<div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upload bank statement</h2>
            <p className="text-sm text-gray-500">Import CSV statements and auto-match recurring items.</p>
          </div>
        </div>}>
          <form onSubmit={handleStatementSubmit} className="space-y-4">
            <div>
              <Input
                type="file"
                accept=".csv"
                onChange={(event) => setStatementFile(event.target.files?.[0] ?? null)}
              />
              {statementFile && (
                <p className="mt-2 text-sm text-gray-500">{statementFile.name}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isStatementPending}>
                {isStatementPending && <Spinner className="mr-2 h-4 w-4" />}Upload statement
              </Button>
              <Button type="button" variant="secondary" onClick={() => setStatementFile(null)} disabled={!statementFile || isStatementPending}>
                Clear selection
              </Button>
            </div>
            {summary.lastImport && (
              <p className="text-sm text-gray-500">
                Last upload: {formatDate(summary.lastImport.uploaded_at)} · {summary.lastImport.original_filename}
              </p>
            )}
          </form>
        </Card>

        <Card className="lg:col-span-2" header={<div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Quarterly export</h2>
            <p className="text-sm text-gray-500">Download a PDF summary and all receipts as a ZIP.</p>
          </div>
        </div>}>
          <form onSubmit={handleExportSubmit} className="grid gap-3 sm:grid-cols-2">
            <Select name="year" defaultValue={String(currentYear)}>
              <option value="" disabled>Year</option>
              {exportYears.map((yearOption) => (
                <option key={yearOption} value={yearOption}>{yearOption}</option>
              ))}
            </Select>
            <Select name="quarter" defaultValue={String(Math.ceil((new Date().getUTCMonth() + 1) / 3))}>
              <option value="" disabled>Quarter</option>
              <option value="1">Q1 (January to March)</option>
              <option value="2">Q2 (April to June)</option>
              <option value="3">Q3 (July to September)</option>
              <option value="4">Q4 (October to December)</option>
            </Select>
            <Button type="submit" className="sm:col-span-2">
              <DocumentArrowDownIcon className="mr-2 h-5 w-5" />
              Download receipts bundle
            </Button>
          </form>
        </Card>
      </div>

      <Card header={<div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
          <p className="text-sm text-gray-500">Tick off receipts as you collect them and keep the finance trail tidy.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={initialFilters.status ?? 'all'} onChange={handleStatusChange} className="w-40">
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Select value={initialFilters.direction ?? 'all'} onChange={handleDirectionChange} className="w-40">
            {directionOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
      </div>}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <form onSubmit={handleSearchSubmit} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Input
              name="search"
              placeholder="Search description or type"
              defaultValue={initialFilters.search ?? ''}
              className="sm:w-64"
            />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <Checkbox
              checked={initialFilters.showOnlyOutstanding}
              onChange={handleOutstandingToggle}
            />
            Outstanding only
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-left text-sm font-semibold text-gray-600">
              <tr>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    className={`flex items-center gap-1 text-left text-sm font-semibold ${currentSortBy === 'transaction_date' ? 'text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => handleSort('transaction_date')}
                  >
                    Date
                    {currentSortBy === 'transaction_date' && (
                      <span aria-hidden>{currentSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    type="button"
                    className={`flex items-center gap-1 text-left text-sm font-semibold ${currentSortBy === 'details' ? 'text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => handleSort('details')}
                  >
                    Details
                    {currentSortBy === 'details' && (
                      <span aria-hidden>{currentSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className={`flex w-full items-center justify-end gap-1 text-sm font-semibold ${currentSortBy === 'amount_in' ? 'text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => handleSort('amount_in')}
                  >
                    In
                    {currentSortBy === 'amount_in' && (
                      <span aria-hidden>{currentSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className={`flex w-full items-center justify-end gap-1 text-sm font-semibold ${currentSortBy === 'amount_out' ? 'text-emerald-700' : 'text-gray-600'}`}
                    onClick={() => handleSort('amount_out')}
                  >
                    Out
                    {currentSortBy === 'amount_out' && (
                      <span aria-hidden>{currentSortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 w-48">Status</th>
                <th className="px-4 py-3">Receipts</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-500">No transactions match your filters.</td>
                </tr>
              )}
              {transactions.map((transaction) => {
                const isProcessing = activeTransactionId === transaction.id && isRowPending
                const files = transaction.files as ReceiptFile[]
                const amount = transaction.amount_out ?? transaction.amount_in
                return (
                  <tr key={transaction.id} className="align-top">
                    <td className="px-4 py-3 text-gray-600">{formatDate(transaction.transaction_date)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{transaction.details}</p>
                      <p className="text-xs text-gray-500">{transaction.transaction_type ?? '—'}</p>
                      {transaction.rule_applied_id && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          <ArrowPathIcon className="h-4 w-4" /> Auto rule
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(transaction.amount_in)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(transaction.amount_out)}</td>
                    <td className="px-4 py-3 min-w-[12rem]">
                      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${
                        transaction.status === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : transaction.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : transaction.status === 'auto_completed'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-200 text-gray-700'
                      }`}>
                        {transaction.status === 'completed' && <CheckCircleIcon className="h-4 w-4" />}
                        {transaction.status === 'pending' && <XCircleIcon className="h-4 w-4" />}
                        {statusLabels[transaction.status]}
                      </span>
                      {transaction.marked_by_email && (
                        <p className="mt-1 text-xs text-gray-500">
                          By {transaction.marked_by_name ?? transaction.marked_by_email}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 space-y-2">
                      {files.length === 0 && <p className="text-xs text-gray-500">No receipts</p>}
                      {files.map((file) => {
                        const friendlyName = file.file_name || buildReceiptName(transaction.details, amount)
                        return (
                          <div key={file.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 px-2 py-1">
                            <button
                              type="button"
                              onClick={() => handleReceiptDownload(file.id)}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                              title={friendlyName}
                            >
                              <MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">View receipt</span>
                            </button>
                            <button
                              type="button"
                              className="text-xs text-red-500 hover:text-red-600"
                              onClick={() => handleReceiptDelete(file.id, transaction.id)}
                              disabled={isProcessing}
                            >
                              Remove
                            </button>
                          </div>
                        )
                      })}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        ref={(element) => handleFileInputRef(transaction.id, element)}
                        onChange={(event) => handleReceiptUpload(transaction.id, event)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:items-center sm:gap-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleUploadClick(transaction.id)}
                          disabled={isProcessing}
                        >
                          Upload
                        </Button>
                        {transaction.status !== 'completed' && (
                          <Button
                            variant="success"
                            size="sm"
                            onClick={() => handleStatusUpdate(transaction.id, 'completed')}
                            disabled={isProcessing}
                          >
                            Done
                          </Button>
                        )}
                        {transaction.status !== 'no_receipt_required' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleStatusUpdate(transaction.id, 'no_receipt_required')}
                            disabled={isProcessing}
                          >
                            Skip
                          </Button>
                        )}
                        {transaction.status !== 'pending' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStatusUpdate(transaction.id, 'pending')}
                            disabled={isProcessing}
                          >
                            Reopen
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          currentPage={pagination.page}
          totalPages={totalPages}
          totalItems={pagination.total}
          itemsPerPage={pagination.pageSize}
          onPageChange={handlePageChange}
        />
      </Card>

      <Card header={<div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Automation rules</h2>
          <p className="text-sm text-gray-500">Automatically tick off known transactions (e.g. card settlements).</p>
        </div>
        <Badge variant="secondary">{rules.length} rules</Badge>
      </div>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            variant="bordered"
            header={<h3 className="text-md font-semibold text-gray-900">New rule</h3>}
          >
            <form onSubmit={(event) => handleRuleSubmit(event)} className="space-y-3">
              <Input name="name" placeholder="Rule name" required />
              <Input name="match_description" placeholder="Match description (comma separated keywords)" />
              <Input name="match_transaction_type" placeholder="Match transaction type" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="match_min_amount" placeholder="Min amount" type="number" step="0.01" />
                <Input name="match_max_amount" placeholder="Max amount" type="number" step="0.01" />
              </div>
              <Select name="match_direction" defaultValue="both">
                <option value="both">Any direction</option>
                <option value="out">Money out</option>
                <option value="in">Money in</option>
              </Select>
              <Select name="auto_status" defaultValue="no_receipt_required">
                <option value="no_receipt_required">Mark as not required</option>
                <option value="auto_completed">Mark as auto completed</option>
                <option value="completed">Mark as completed</option>
                <option value="pending">Leave pending</option>
              </Select>
              <Button type="submit" disabled={isRulePending && activeRuleId === 'new'}>
                {isRulePending && activeRuleId === 'new' && <Spinner className="mr-2 h-4 w-4" />}Create rule
              </Button>
            </form>
          </Card>

          <div className="space-y-3">
            {rules.length === 0 && (
              <p className="text-sm text-gray-500">No automation rules yet. Start by adding keywords for things like card settlements.</p>
            )}
            {rules.map((rule) => (
              <Card
                key={rule.id}
                variant="bordered"
                header={<div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-gray-900">{rule.name}</h3>
                    <p className="text-xs text-gray-500">{rule.description ?? 'Matches: ' + (rule.match_description ?? 'any')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingRuleId((current) => current === rule.id ? null : rule.id)}
                      disabled={isRulePending && activeRuleId === rule.id}
                    >
                      Edit
                    </Button>
                    <Button
                      variant={rule.is_active ? 'success' : 'ghost'}
                      size="sm"
                      onClick={() => handleRuleToggle(rule)}
                      disabled={isRulePending && activeRuleId === rule.id}
                    >
                      {isRulePending && activeRuleId === rule.id ? <Spinner className="h-4 w-4" /> : rule.is_active ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRuleDelete(rule.id)}
                      disabled={isRulePending && activeRuleId === rule.id}
                    >
                      Delete
                    </Button>
                  </div>
                </div>}
              >
                {editingRuleId === rule.id && (
                  <form onSubmit={(event) => handleRuleSubmit(event, rule.id)} className="space-y-3">
                    <Input name="name" defaultValue={rule.name} required />
                    <Input name="match_description" defaultValue={rule.match_description ?? ''} />
                    <Input name="match_transaction_type" defaultValue={rule.match_transaction_type ?? ''} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input name="match_min_amount" type="number" step="0.01" defaultValue={rule.match_min_amount ?? ''} />
                      <Input name="match_max_amount" type="number" step="0.01" defaultValue={rule.match_max_amount ?? ''} />
                    </div>
                    <Select name="match_direction" defaultValue={rule.match_direction}>
                      <option value="both">Any direction</option>
                      <option value="out">Money out</option>
                      <option value="in">Money in</option>
                    </Select>
                    <Select name="auto_status" defaultValue={rule.auto_status}>
                      <option value="no_receipt_required">Mark as not required</option>
                      <option value="auto_completed">Mark as auto completed</option>
                      <option value="completed">Mark as completed</option>
                      <option value="pending">Leave pending</option>
                    </Select>
                    <Button type="submit" disabled={isRulePending && activeRuleId === rule.id}>
                      {isRulePending && activeRuleId === rule.id && <Spinner className="mr-2 h-4 w-4" />}Save changes
                    </Button>
                  </form>
                )}
                {editingRuleId !== rule.id && (
                  <div className="space-y-1 text-xs text-gray-500">
                    <p>Direction: {rule.match_direction}</p>
                    {rule.match_min_amount != null && <p>Min amount: £{rule.match_min_amount.toFixed(2)}</p>}
                    {rule.match_max_amount != null && <p>Max amount: £{rule.match_max_amount.toFixed(2)}</p>}
                    <p>Outcome: {statusLabels[rule.auto_status]}</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

interface SummaryCardProps {
  title: string
  value: number
  tone: 'success' | 'warning' | 'info' | 'neutral'
}

function SummaryCard({ title, value, tone }: SummaryCardProps) {
  const toneClasses: Record<SummaryCardProps['tone'], string> = {
    success: 'bg-emerald-50 text-emerald-700',
    warning: 'bg-amber-50 text-amber-700',
    info: 'bg-blue-50 text-blue-700',
    neutral: 'bg-gray-50 text-gray-700',
  }

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-2">
        <p className="text-sm text-gray-500">{title}</p>
        <p className="text-3xl font-semibold text-gray-900">{value}</p>
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${toneClasses[tone]}`}>
          {value === 0 ? 'All clear' : value === 1 ? '1 item' : `${value} items`}
        </span>
      </div>
    </Card>
  )
}
