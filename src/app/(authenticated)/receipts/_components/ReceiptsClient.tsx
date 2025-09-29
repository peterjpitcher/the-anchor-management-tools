'use client'

import Link from 'next/link'
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
  updateReceiptClassification,
  runReceiptRuleRetroactivelyStep,
  finalizeReceiptRuleRetroRun,
  type ReceiptWorkspaceData,
  type ReceiptWorkspaceFilters,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import type {
  ReceiptRule,
  ReceiptTransaction,
  ReceiptFile,
  ReceiptClassificationSource,
  ReceiptExpenseCategory,
} from '@/types/database'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import { DocumentArrowDownIcon, ArrowPathIcon, CheckCircleIcon, XCircleIcon, MagnifyingGlassIcon, SparklesIcon } from '@heroicons/react/24/outline'

interface ReceiptsClientProps {
  initialData: ReceiptWorkspaceData
  initialFilters: ReceiptWorkspaceFilters & {
    status: ReceiptWorkspaceFilters['status'] | 'all'
    direction: 'in' | 'out' | 'all'
    showOnlyOutstanding: boolean
    missingVendorOnly: boolean
    missingExpenseOnly: boolean
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

function formatCurrencyStrict(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value ?? 0)
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
  const [isClassificationPending, startClassificationTransition] = useTransition()
  const [isRetroPending, startRetroTransition] = useTransition()
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'vendor' | 'expense' } | null>(null)
  const [classificationDraft, setClassificationDraft] = useState('')
  const [classificationTargetId, setClassificationTargetId] = useState<string | null>(null)
  const [pendingRuleSuggestion, setPendingRuleSuggestion] = useState<ClassificationRuleSuggestion | null>(null)
  const [retroPrompt, setRetroPrompt] = useState<{ id: string; name: string } | null>(null)
  const fileInputsRef = useRef<Record<string, HTMLInputElement | null>>({})
  const newRuleFormRef = useRef<HTMLFormElement | null>(null)
  const [isCustomVendor, setIsCustomVendor] = useState(false)
  const [retroScope, setRetroScope] = useState<'pending' | 'all'>('pending')
  const [retroRuleId, setRetroRuleId] = useState<string | null>(null)

  const { summary, transactions, rules, pagination, knownVendors } = initialData
  const currentSortBy = (initialFilters.sortBy ?? 'transaction_date') as NonNullable<ReceiptWorkspaceFilters['sortBy']>
  const currentSortDirection: 'asc' | 'desc' = initialFilters.sortDirection ?? 'desc'
  const defaultSort: { column: NonNullable<ReceiptWorkspaceFilters['sortBy']>; direction: 'asc' | 'desc' } = {
    column: 'transaction_date',
    direction: 'desc',
  }

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize))

  const vendorOptions = useMemo(() => knownVendors.slice(0, 500), [knownVendors])
  const vendorLookup = useMemo(() => new Set(vendorOptions.map((vendor) => vendor.toLowerCase())), [vendorOptions])

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

  const expenseCategoryOptions = useMemo(() => receiptExpenseCategorySchema.options, [])

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

  function handleClassificationStart(transaction: ReceiptTransaction, field: 'vendor' | 'expense') {
    setEditingCell({ id: transaction.id, field })
    if (field === 'vendor') {
      const vendorValue = transaction.vendor_name?.trim() ?? ''
      setClassificationDraft(vendorValue)
      setIsCustomVendor(vendorValue.length > 0 && !vendorLookup.has(vendorValue.toLowerCase()))
    } else {
      setClassificationDraft(transaction.expense_category ?? '')
    }
  }

  function handleClassificationCancel() {
    setEditingCell(null)
    setClassificationDraft('')
    setClassificationTargetId(null)
    setIsCustomVendor(false)
  }

  function applyRuleSuggestion(suggestion: ClassificationRuleSuggestion) {
    const form = newRuleFormRef.current
    if (!form) return

    const getInput = <T extends HTMLElement>(name: string) => form.elements.namedItem(name) as T | null

    const nameInput = getInput<HTMLInputElement>('name')
    if (nameInput) nameInput.value = suggestion.suggestedName

    const matchDescriptionInput = getInput<HTMLInputElement>('match_description')
    if (matchDescriptionInput) {
      matchDescriptionInput.value = suggestion.matchDescription ?? ''
    }

    const matchTypeInput = getInput<HTMLInputElement>('match_transaction_type')
    if (matchTypeInput) matchTypeInput.value = suggestion.transactionType ?? ''

    const matchDirectionSelect = getInput<HTMLSelectElement>('match_direction')
    if (matchDirectionSelect) matchDirectionSelect.value = suggestion.direction

    const vendorInput = getInput<HTMLInputElement>('set_vendor_name')
    if (vendorInput) vendorInput.value = suggestion.setVendorName ?? ''

    const expenseSelect = getInput<HTMLSelectElement>('set_expense_category')
    if (expenseSelect) expenseSelect.value = suggestion.setExpenseCategory ?? ''

    const autoStatusSelect = getInput<HTMLSelectElement>('auto_status')
    if (autoStatusSelect) autoStatusSelect.value = 'pending'

    const descriptionInput = getInput<HTMLInputElement>('description')
    if (descriptionInput) descriptionInput.value = ''

    const minAmountInput = getInput<HTMLInputElement>('match_min_amount')
    if (minAmountInput) minAmountInput.value = ''

    const maxAmountInput = getInput<HTMLInputElement>('match_max_amount')
    if (maxAmountInput) maxAmountInput.value = ''

    form.scrollIntoView({ behavior: 'smooth', block: 'center' })
    toast.success('Prefilled the new rule form from your classification')
    setPendingRuleSuggestion(null)
  }

  function showRuleSuggestionPrompt(suggestion: ClassificationRuleSuggestion) {
    setPendingRuleSuggestion(suggestion)
    toast((t) => (
      <div className="rounded-md bg-white p-3 shadow-md">
        <p className="text-sm font-semibold text-gray-900">Create a rule for this vendor?</p>
        <p className="mt-1 text-xs text-gray-600">Apply this classification automatically next time.</p>
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="xs"
            onClick={() => {
              applyRuleSuggestion(suggestion)
              toast.dismiss(t.id)
            }}
          >
            Prefill rule
          </Button>
          <Button size="xs" variant="ghost" onClick={() => toast.dismiss(t.id)}>
            Dismiss
          </Button>
        </div>
      </div>
    ), { duration: 8000 })
  }

  function handleClassificationSave(transaction: ReceiptTransaction, field: 'vendor' | 'expense') {
    const draftValue = classificationDraft.trim()
    setClassificationTargetId(transaction.id)
    startClassificationTransition(async () => {
      const payload: {
        transactionId: string
        vendorName?: string | null
        expenseCategory?: ReceiptExpenseCategory | null
      } = { transactionId: transaction.id }

      if (field === 'vendor') {
        payload.vendorName = draftValue.length ? draftValue : null
      } else {
        payload.expenseCategory = draftValue.length ? (draftValue as ReceiptExpenseCategory) : null
      }

      const result = await updateReceiptClassification(payload)

      if (result?.error) {
        toast.error(result.error)
        setClassificationTargetId(null)
        return
      }

      toast.success('Classification updated')
      router.refresh()

      if (result?.ruleSuggestion) {
        showRuleSuggestionPrompt(result.ruleSuggestion)
      }

      handleClassificationCancel()
      setClassificationTargetId(null)
      setIsCustomVendor(false)
    })
  }

  function handleVendorSelectChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value === '__custom__') {
      setClassificationDraft('')
      setIsCustomVendor(true)
      return
    }
    setClassificationDraft(value)
  }

  function showVendorSelect() {
    setIsCustomVendor(false)
    setClassificationDraft('')
  }

  function handleRetroRun(ruleId: string, scope: 'pending' | 'all') {
    console.log('[retro-ui] handleRetroRun click', { ruleId, scope })
    setRetroRuleId(ruleId)
    startRetroTransition(async () => {
      try {
        const CHUNK_SIZE = 100
        const MAX_ITERATIONS = 300

        let offset = 0
        let iterations = 0
        let lastSamples: Array<Record<string, unknown>> = []
        const totals = {
          reviewed: 0,
          matched: 0,
          statusAutoUpdated: 0,
          classificationUpdated: 0,
          vendorIntended: 0,
          expenseIntended: 0,
        }

        while (iterations < MAX_ITERATIONS) {
          const step = await runReceiptRuleRetroactivelyStep({
            ruleId,
            scope,
            offset,
            chunkSize: CHUNK_SIZE,
          })

          if (!step.success) {
            toast.error(step.error)
            console.error('[retro-ui] step failed', { ruleId, scope, offset, error: step.error })
            break
          }

          totals.reviewed += step.reviewed
          totals.matched += step.matched
          totals.statusAutoUpdated += step.statusAutoUpdated
          totals.classificationUpdated += step.classificationUpdated
          totals.vendorIntended += step.vendorIntended
          totals.expenseIntended += step.expenseIntended

          if (step.samples.length) {
            lastSamples = step.samples
          }

          offset = step.nextOffset
          iterations += 1

          if (step.done) {
            await finalizeReceiptRuleRetroRun({
              ruleId,
              scope,
              reviewed: totals.reviewed,
              statusAutoUpdated: totals.statusAutoUpdated,
              classificationUpdated: totals.classificationUpdated,
              matched: totals.matched,
              vendorIntended: totals.vendorIntended,
              expenseIntended: totals.expenseIntended,
            })

            const scopeLabel = scope === 'all' ? 'transactions' : 'pending transactions'
            toast.success(
              `Rule processed ${totals.matched} / ${totals.reviewed} ${scopeLabel} · ${totals.statusAutoUpdated} status updates · ${totals.classificationUpdated} classifications · vendor intents ${totals.vendorIntended} · expense intents ${totals.expenseIntended}`
            )

            if (lastSamples.length) {
              console.groupCollapsed(
                `Receipt rule analysis (${lastSamples.length} sample transactions)`
              )
              console.table(lastSamples)
              console.groupEnd()
            }

            setRetroPrompt(null)
            setRetroScope('pending')
            router.refresh()
            return
          }

          if (step.reviewed === 0) {
            console.warn('[retro-ui] step reviewed 0 transactions', { ruleId, scope, offset })
            break
          }
        }

        toast.error('Stopped before completion. Please run again to continue.')
        console.warn('[retro-ui] retro run incomplete', { ruleId, scope, offset, iterations, totals })
      } catch (error) {
        console.error('Failed to run receipt rule retroactively', error)
        toast.error('Failed to run the rule. Please try again.')
      } finally {
        setRetroPrompt(null)
        setRetroRuleId(null)
      }
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
      const autoApplied = result?.autoApplied ?? 0
      const autoClassified = result?.autoClassified ?? 0
      const parts = [`Imported ${result?.inserted ?? 0} new transactions`]
      if (autoApplied > 0) parts.push(`${autoApplied} auto-matched`)
      if (autoClassified > 0) parts.push(`${autoClassified} auto-classified`)
      toast.success(parts.join(' · '))
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

  function handleMissingVendorToggle(event: ChangeEvent<HTMLInputElement>) {
    updateQuery({ needsVendor: event.target.checked ? '1' : null })
  }

  function handleMissingExpenseToggle(event: ChangeEvent<HTMLInputElement>) {
    updateQuery({ needsExpense: event.target.checked ? '1' : null })
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

      if (!result || 'error' in result) {
        toast.error(result?.error ?? 'Failed to save rule')
        setActiveRuleId(null)
        return
      }
      toast.success(`Rule ${ruleId ? 'updated' : 'created'}`)
      const createdRule = result.rule
      if (result.canPromptRetro && createdRule) {
        setRetroPrompt({ id: createdRule.id, name: createdRule.name })
        setRetroScope('pending')
        toast((t) => (
          <div className="rounded-md bg-white p-3 shadow-md">
            <p className="text-sm font-semibold text-gray-900">Run this rule on existing items?</p>
            <p className="mt-1 text-xs text-gray-600">Apply “{createdRule.name}” to pending transactions now.</p>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="xs"
                onClick={() => {
                  handleRetroRun(createdRule.id, 'pending')
                  toast.dismiss(t.id)
                }}
              >
                Run now
              </Button>
              <Button size="xs" variant="ghost" onClick={() => toast.dismiss(t.id)}>
                Later
              </Button>
            </div>
          </div>
        ), { duration: 8000 })
      }
      setEditingRuleId(null)
      formElement.reset()
      setPendingRuleSuggestion(null)
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <CostSummaryCard cost={summary.openAICost} />
          <SummaryCard title="Pending" value={summary.totals.pending} tone="warning" />
          <SummaryCard title="Completed" value={summary.totals.completed} tone="success" />
          <SummaryCard title="Auto-matched" value={summary.totals.autoCompleted} tone="info" />
        <SummaryCard title="No receipt required" value={summary.totals.noReceiptRequired} tone="neutral" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/receipts/monthly"
          className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
        >
          Monthly overview
        </Link>
        <Link
          href="/receipts/vendors"
          className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
        >
          Vendor trends
        </Link>
        <Link
          href="/receipts/pnl"
          className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
        >
          P&amp;L dashboard
        </Link>
        <Link
          href="/receipts/bulk"
          className="inline-flex items-center rounded-md border border-emerald-100 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50"
        >
          Bulk classification
        </Link>
        <Link
          href="/receipts?needsVendor=1"
          className="inline-flex items-center rounded-md border border-amber-100 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 shadow-sm hover:bg-amber-50"
        >
          Needs vendor
        </Link>
        <Link
          href="/receipts?needsExpense=1"
          className="inline-flex items-center rounded-md border border-blue-100 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 shadow-sm hover:bg-blue-50"
        >
          Needs expense
        </Link>
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
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={initialFilters.showOnlyOutstanding}
                onChange={handleOutstandingToggle}
              />
              Outstanding only
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={initialFilters.missingVendorOnly}
                onChange={handleMissingVendorToggle}
              />
              Missing vendor
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={initialFilters.missingExpenseOnly}
                onChange={handleMissingExpenseToggle}
              />
              Missing expense
            </label>
          </div>
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
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Expense type</th>
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
                  <td colSpan={9} className="px-4 py-6 text-center text-gray-500">No transactions match your filters.</td>
                </tr>
              )}
              {transactions.map((transaction) => {
                const isProcessing = activeTransactionId === transaction.id && isRowPending
                const files = transaction.files as ReceiptFile[]
                const amount = transaction.amount_out ?? transaction.amount_in
                const isEditingVendor = editingCell?.id === transaction.id && editingCell.field === 'vendor'
                const isEditingExpense = editingCell?.id === transaction.id && editingCell.field === 'expense'
                const isClassificationLoading =
                  classificationTargetId === transaction.id && isClassificationPending
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
                    <td className="px-4 py-3 align-top">
                      {isEditingVendor ? (
                        <div className="flex flex-col gap-2">
                          {isCustomVendor ? (
                            <div className="space-y-2">
                              <Input
                                autoFocus
                                value={classificationDraft}
                                onChange={(event) => setClassificationDraft(event.target.value)}
                                placeholder="Enter new vendor"
                                disabled={isClassificationLoading}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={showVendorSelect}
                                disabled={isClassificationLoading}
                              >
                                ⟵ Choose existing vendor
                              </Button>
                            </div>
                          ) : (
                            <Select
                              autoFocus
                              value={classificationDraft}
                              onChange={handleVendorSelectChange}
                              disabled={isClassificationLoading}
                            >
                              <option value="">Clear vendor</option>
                              {vendorOptions.map((vendor) => (
                                <option key={vendor} value={vendor}>
                                  {vendor}
                                </option>
                              ))}
                              <option value="__custom__">+ Add new vendor</option>
                            </Select>
                          )}
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleClassificationSave(transaction, 'vendor')}
                              disabled={isClassificationLoading}
                            >
                              {isClassificationLoading && <Spinner className="mr-2 h-3 w-3" />}Save
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={handleClassificationCancel}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            className={`text-left text-sm ${transaction.vendor_name ? 'font-medium text-gray-900 hover:text-emerald-600' : 'text-gray-400 hover:text-emerald-600'}`}
                            onClick={() => handleClassificationStart(transaction, 'vendor')}
                          >
                            {transaction.vendor_name ?? 'Add vendor'}
                          </button>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <ClassificationBadge source={transaction.vendor_source} />
                            {transaction.vendor_source === 'ai' && (
                              <span className="inline-flex items-center gap-1 text-blue-600">
                                <SparklesIcon className="h-3 w-3" />
                                AI suggested
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {isEditingExpense ? (
                        <div className="flex flex-col gap-2">
                          <Select
                            value={classificationDraft}
                            onChange={(event) => setClassificationDraft(event.target.value)}
                            disabled={isClassificationLoading}
                          >
                            <option value="">Leave unset</option>
                            {expenseCategoryOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </Select>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleClassificationSave(transaction, 'expense')}
                              disabled={isClassificationLoading}
                            >
                              {isClassificationLoading && <Spinner className="mr-2 h-3 w-3" />}Save
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={handleClassificationCancel}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            className={`text-left text-sm ${transaction.expense_category ? 'font-medium text-gray-900 hover:text-emerald-600' : 'text-gray-400 hover:text-emerald-600'}`}
                            onClick={() => handleClassificationStart(transaction, 'expense')}
                          >
                            {transaction.expense_category ?? 'Add expense type'}
                          </button>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <ClassificationBadge source={transaction.expense_category_source} />
                            {transaction.expense_category_source === 'ai' && (
                              <span className="inline-flex items-center gap-1 text-blue-600">
                                <SparklesIcon className="h-3 w-3" />
                                AI suggested
                              </span>
                            )}
                          </div>
                        </div>
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
            {pendingRuleSuggestion && (
              <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-emerald-800">
                    Suggestion ready for {pendingRuleSuggestion.setVendorName ?? pendingRuleSuggestion.setExpenseCategory}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => applyRuleSuggestion(pendingRuleSuggestion)}
                    >
                      Apply
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setPendingRuleSuggestion(null)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
                <p className="mt-1">Prefill the form to auto-tag similar transactions next time.</p>
              </div>
            )}
            {retroPrompt && (
              <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-blue-800">
                    Run rule “{retroPrompt.name}” on {retroScope === 'all' ? 'all transactions' : 'pending transactions'}?
                  </p>
                  <Select
                    value={retroScope}
                    onChange={(event) => setRetroScope(event.target.value as 'pending' | 'all')}
                    className="w-44"
                    selectSize="sm"
                  >
                    <option value="pending">Pending only</option>
                    <option value="all">All historical</option>
                  </Select>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => handleRetroRun(retroPrompt.id, retroScope)}
                    disabled={isRetroPending}
                  >
                    {isRetroPending && <Spinner className="mr-2 h-3 w-3" />}Run now
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setRetroPrompt(null)
                      setRetroScope('pending')
                    }}
                  >
                    Later
                  </Button>
                </div>
                <p className="mt-1">We can re-check historical records without reopening completed items.</p>
              </div>
            )}
            <form ref={newRuleFormRef} onSubmit={(event) => handleRuleSubmit(event)} className="space-y-3">
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
              <Input name="set_vendor_name" placeholder="Set vendor name (optional)" />
              <Select name="set_expense_category" defaultValue="">
                <option value="">Leave expense unset</option>
                {expenseCategoryOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
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
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRetroRun(rule.id, 'all')}
                      disabled={!rule.is_active || isRetroPending}
                      title={rule.is_active ? 'Run this rule across all historical transactions' : 'Enable the rule before running it'}
                      className="flex items-center gap-1"
                    >
                      {isRetroPending && retroRuleId === rule.id ? (
                        <>
                          <Spinner className="h-4 w-4" />
                          <span>Running…</span>
                        </>
                      ) : (
                        'Run historical'
                      )}
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
                    <Input name="set_vendor_name" defaultValue={rule.set_vendor_name ?? ''} placeholder="Set vendor name (optional)" />
                    <Select name="set_expense_category" defaultValue={rule.set_expense_category ?? ''}>
                      <option value="">Leave expense unset</option>
                      {expenseCategoryOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
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
                    {rule.set_vendor_name && <p>Sets vendor: {rule.set_vendor_name}</p>}
                    {rule.set_expense_category && <p>Sets expense: {rule.set_expense_category}</p>}
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

function CostSummaryCard({ cost }: { cost: number }) {
  const badge = cost > 0
    ? { label: 'Includes AI tagging', className: 'bg-blue-50 text-blue-700' }
    : { label: 'No spend yet', className: 'bg-gray-100 text-gray-600' }

  return (
    <Card variant="bordered" className="h-full">
      <div className="space-y-2">
        <p className="text-sm text-gray-500">OpenAI spend</p>
        <p className="text-3xl font-semibold text-gray-900">{formatCurrencyStrict(cost)}</p>
        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </div>
    </Card>
  )
}

function ClassificationBadge({ source }: { source?: ReceiptClassificationSource | null }) {
  if (!source) return null

  const styles: Record<ReceiptClassificationSource, { label: string; className: string }> = {
    ai: { label: 'AI', className: 'bg-blue-50 text-blue-700' },
    manual: { label: 'Manual', className: 'bg-emerald-50 text-emerald-700' },
    rule: { label: 'Rule', className: 'bg-purple-50 text-purple-700' },
    import: { label: 'Import', className: 'bg-gray-100 text-gray-600' },
  }

  const config = styles[source]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}
