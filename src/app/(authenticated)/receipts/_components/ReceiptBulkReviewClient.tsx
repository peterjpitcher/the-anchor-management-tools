'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Empty,
  Fieldset,
  FormFooter,
  Icon,
  Input,
  Modal,
  Select,
  SubHeading,
  toast,
} from '@/ds'
import type { ReceiptBulkReviewData } from '@/app/actions/receipts'
import {
  applyReceiptGroupClassification,
  createReceiptRuleFromGroup,
} from '@/app/actions/receipts'
import { useRetroRuleRunner } from '@/hooks/useRetroRuleRunner'
import { receiptExpenseCategorySchema, receiptTransactionStatusSchema } from '@/lib/validation'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'
import { usePermissions } from '@/contexts/PermissionContext'
import { RECEIPT_STATUS_LABEL, RECEIPT_SUGGESTION_SOURCE_LABEL, RECEIPT_SUGGESTION_SOURCE_TONE } from '../_shared/status-ui'
import { NewVendorDialog, type VendorConfirmationPrompt } from './ui/NewVendorDialog'
import { RuleRunDialog } from './ui/RuleRunDialog'
import { escapeRuleKeyword } from '@/lib/receipts/rule-matching'
import { NO_CATEGORY_LABEL, NO_CATEGORY_VALUE } from '@/lib/receipts/no-category'
import type { BulkApplyPreview } from '@/services/receipts/receiptBulkApply'
import type { RuleRunPreview } from '@/services/receipts/receiptRuleRuns'

const STATUS_LABELS = RECEIPT_STATUS_LABEL

const EXPENSE_OPTIONS = receiptExpenseCategorySchema.options
// "Leave pending" comes first and is the default: a rule that only names a vendor must not stop
// receipts being chased for it.
// A rule can leave a transaction pending or mark it as needing no receipt, and nothing else.
const RULE_STATUS_OPTIONS: ReceiptTransaction['status'][] = ['pending', 'no_receipt_required']
const RULE_DIRECTION_OPTIONS: Array<{ value: 'in' | 'out' | 'both'; label: string }> = [
  { value: 'out', label: 'Money out' },
  { value: 'in', label: 'Money in' },
  { value: 'both', label: 'Any direction' },
]

type BulkStatus = ReceiptTransaction['status']

/** What is sent for one group: its transactions and what to set on them. */
type BulkApplyRequest = {
  details: string
  transactionIds: string[]
  vendorName?: string | null
  expenseCategory?: ReceiptExpenseCategory | null
  noCategoryApplies?: boolean
  createVendor?: boolean
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

type RuleDraft = {
  name: string
  matchDescription: string
  direction: 'in' | 'out' | 'both'
  autoStatus: BulkStatus
  setVendor: boolean
  setExpense: boolean
}

type BulkReviewFilters = {
  limit: number
  statuses: BulkStatus[]
  onlyUnclassified: boolean
}

type Props = {
  initialData: ReceiptBulkReviewData
  initialFilters: BulkReviewFilters
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'UTC' })
}

function defaultRuleName(details: string) {
  const trimmed = details.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed
}

function defaultRuleDirection(totalIn: number, totalOut: number): 'in' | 'out' | 'both' {
  if (totalOut > totalIn) return 'out'
  if (totalIn > totalOut) return 'in'
  return 'both'
}

export default function ReceiptBulkReviewClient({ initialData, initialFilters }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')
  const managePermissionMessage = 'You do not have permission to manage receipts.'
  const [isApplying, startApply] = useTransition()
  const [isCreatingRule, startCreateRule] = useTransition()
  const {
    previewRetro,
    runRetro,
    isRunning: isRunningRetro,
    isPreviewing: isPreviewingRetro,
    activeRuleId: retroRunningRuleId,
  } = useRetroRuleRunner()
  // A rule run that has been worked out and is waiting for a yes. Nothing is written until then.
  const [retroRun, setRetroRun] = useState<{ ruleId: string; preview: RuleRunPreview & { runId: string } } | null>(null)

  const [activeApplyGroup, setActiveApplyGroup] = useState<string | null>(null)
  const [activeRuleGroup, setActiveRuleGroup] = useState<string | null>(null)
  const [localStatuses, setLocalStatuses] = useState<BulkStatus[]>(initialFilters.statuses)
  const [localLimit, setLocalLimit] = useState(initialFilters.limit)
  const [localOnlyUnclassified, setLocalOnlyUnclassified] = useState(initialFilters.onlyUnclassified)
  const [localFuzzyGrouping, setLocalFuzzyGrouping] = useState(initialData.config.useFuzzyGrouping)

  const [vendorDrafts, setVendorDrafts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    initialData.groups.forEach((group) => {
      map[group.details] = group.suggestion.vendorName ?? ''
    })
    return map
  })

  const [expenseDrafts, setExpenseDrafts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    initialData.groups.forEach((group) => {
      map[group.details] = group.suggestion.expenseCategory ?? ''
    })
    return map
  })

  const [applyVendor, setApplyVendor] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    initialData.groups.forEach((group) => {
      map[group.details] = group.needsVendorCount > 0 || Boolean(group.suggestion.vendorName)
    })
    return map
  })

  const [applyExpense, setApplyExpense] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    initialData.groups.forEach((group) => {
      map[group.details] = group.needsExpenseCount > 0 || Boolean(group.suggestion.expenseCategory)
    })
    return map
  })

  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>(() => {
    const map: Record<string, RuleDraft> = {}
    initialData.groups.forEach((group) => {
      map[group.details] = {
        name: defaultRuleName(group.details),
        // The whole description is one keyword: its commas must not split it into several.
        matchDescription: escapeRuleKeyword(group.details),
        direction: defaultRuleDirection(group.totalIn, group.totalOut),
        autoStatus: 'pending',
        setVendor: Boolean(group.suggestion.vendorName),
        setExpense: Boolean(group.suggestion.expenseCategory),
      }
    })
    return map
  })

  const [createdRules, setCreatedRules] = useState<Record<string, { id: string; name: string }>>({})
  // A bulk apply that has been worked out and is waiting for a yes. Nothing is written until then.
  const [applyPrompt, setApplyPrompt] = useState<{
    details: string
    request: BulkApplyRequest
    preview: BulkApplyPreview
    includeDecided: boolean
  } | null>(null)
  // A typed vendor that is not on the list: which action asked, for which group.
  const [vendorPrompt, setVendorPrompt] = useState<{
    action: 'apply' | 'rule'
    details: string
    confirmation: VendorConfirmationPrompt
  } | null>(null)

  useEffect(() => {
    setLocalStatuses(initialFilters.statuses)
    setLocalLimit(initialFilters.limit)
    setLocalOnlyUnclassified(initialFilters.onlyUnclassified)
    setLocalFuzzyGrouping(initialData.config.useFuzzyGrouping)
  }, [
    initialFilters.statuses,
    initialFilters.limit,
    initialFilters.onlyUnclassified,
    initialData.config.useFuzzyGrouping,
  ])

  useEffect(() => {
    const vendorMap: Record<string, string> = {}
    const expenseMap: Record<string, string> = {}
    const applyVendorMap: Record<string, boolean> = {}
    const applyExpenseMap: Record<string, boolean> = {}
    const ruleMap: Record<string, RuleDraft> = {}

    initialData.groups.forEach((group) => {
      vendorMap[group.details] = group.suggestion.vendorName ?? ''
      expenseMap[group.details] = group.suggestion.expenseCategory ?? ''
      applyVendorMap[group.details] = group.needsVendorCount > 0 || Boolean(group.suggestion.vendorName)
      applyExpenseMap[group.details] = group.needsExpenseCount > 0 || Boolean(group.suggestion.expenseCategory)
      ruleMap[group.details] = {
        name: defaultRuleName(group.details),
        // The whole description is one keyword: its commas must not split it into several.
        matchDescription: escapeRuleKeyword(group.details),
        direction: defaultRuleDirection(group.totalIn, group.totalOut),
        autoStatus: 'pending',
        setVendor: Boolean(group.suggestion.vendorName),
        setExpense: Boolean(group.suggestion.expenseCategory),
      }
    })

    setVendorDrafts(vendorMap)
    setExpenseDrafts(expenseMap)
    setApplyVendor(applyVendorMap)
    setApplyExpense(applyExpenseMap)
    setRuleDrafts(ruleMap)
    setActiveRuleGroup(null)
    setCreatedRules({})
  }, [initialData.generatedAt])

  const limitOptions = useMemo(() => [10, 25, 50, 100, 150, 200, 300, 500], [])
  const statusOrder: BulkStatus[] = useMemo(
    () => ['pending', 'cant_find', 'auto_completed', 'completed', 'no_receipt_required'],
    []
  )

  function updateQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    })
    const query = params.toString()
    router.push(`/receipts/bulk${query ? `?${query}` : ''}`)
  }

  const currentStatuses = useMemo(() => new Set(localStatuses), [localStatuses])

  const handleStatusToggle = (status: BulkStatus) => {
    const next = new Set(currentStatuses)
    if (next.has(status)) {
      next.delete(status)
    } else {
      next.add(status)
    }
    if (next.size === 0) {
      toast.error('Select at least one status to include')
      return
    }
    setLocalStatuses(Array.from(next))
    updateQuery({ statuses: Array.from(next).join(',') })
  }

  const handleLimitChange = (value: string) => {
    setLocalLimit(Number.parseInt(value, 10))
    updateQuery({ limit: value })
  }

  const handleOnlyUnclassifiedToggle = (checked: boolean) => {
    setLocalOnlyUnclassified(checked)
    updateQuery({ all: checked ? null : '1' })
  }

  const handleFuzzyToggle = (checked: boolean) => {
    setLocalFuzzyGrouping(checked)
    updateQuery({ fuzzy: checked ? '1' : null })
  }

  const statusesLabel = localStatuses.map((status) => STATUS_LABELS[status]).join(', ')

  // Step one: work out what would change. Nothing is written.
  // `vendorName` and `createVendor` come from the new-vendor dialog.
  const handleApplyGroup = (details: string, vendorChoice: { vendorName?: string; createVendor?: boolean } = {}) => {
    if (!canManageReceipts) {
      toast.error(managePermissionMessage)
      return
    }
    const group = initialData.groups.find((item) => item.details === details)
    if (!group) return

    const vendorEnabled = applyVendor[details]
    const expenseEnabled = applyExpense[details]
    if (!vendorEnabled && !expenseEnabled) {
      toast.error('Choose at least one field to apply')
      return
    }

    // The group's own transactions are sent, not its description: a fuzzy group's transactions
    // do not all share one description, and used to be missed.
    const request: BulkApplyRequest = { details, transactionIds: group.transactionIds }

    // An empty vendor box, or "Leave unset", means leave it as it is. Both boxes start ticked for
    // a group that needs them, and an empty one used to be sent as "clear it" on every
    // transaction in the group.
    if (vendorEnabled) {
      const value = (vendorChoice.vendorName ?? vendorDrafts[details] ?? '').trim()
      if (value.length) {
        request.vendorName = value
        if (vendorChoice.createVendor) request.createVendor = true
      }
    }

    if (expenseEnabled) {
      const value = (expenseDrafts[details] ?? '').trim()
      if (value === NO_CATEGORY_VALUE) {
        request.expenseCategory = null
        request.noCategoryApplies = true
      } else if (value.length) {
        request.expenseCategory = value as ReceiptExpenseCategory
      }
    }

    if (request.vendorName === undefined && request.expenseCategory === undefined) {
      toast.error('Enter a vendor or choose a category to apply')
      return
    }

    setActiveApplyGroup(details)
    startApply(async () => {
      const result = await applyReceiptGroupClassification(request)
      setActiveApplyGroup(null)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      // The name is not on the vendor list. Nothing was changed: ask before adding a vendor.
      if (result.vendorConfirmation) {
        setVendorPrompt({ action: 'apply', details, confirmation: result.vendorConfirmation })
        return
      }
      setVendorPrompt(null)
      if (vendorChoice.vendorName) {
        setVendorDrafts((prev) => ({ ...prev, [details]: vendorChoice.vendorName as string }))
      }
      if (!result.preview) {
        toast.error('The group could not be checked. Nothing was changed.')
        return
      }
      if (result.preview.willChange === 0 && result.preview.decidedByPerson === 0) {
        toast.success('Nothing to change: these transactions already have this.')
        return
      }
      // The vendor now exists, so the confirmed call does not ask again.
      setApplyPrompt({ details, request: { ...request, createVendor: false }, preview: result.preview, includeDecided: false })
    })
  }

  // Step two: the person has seen the numbers and said yes.
  const handleConfirmApply = () => {
    if (!applyPrompt || !canManageReceipts) return
    const { details, request, includeDecided } = applyPrompt

    setActiveApplyGroup(details)
    startApply(async () => {
      const result = await applyReceiptGroupClassification({ ...request, includeDecided, confirm: true })
      setActiveApplyGroup(null)
      setApplyPrompt(null)

      const applied = result.applied ?? 0
      const left: string[] = []
      if ((result.skippedChanged ?? 0) > 0) left.push(`${result.skippedChanged} had changed and were left`)
      if ((result.skippedLocked ?? 0) > 0) left.push(`${result.skippedLocked} are on or before the lock date`)
      const detail = left.length ? ` ${left.join('; ')}.` : ''

      if (result.error) {
        toast.error(applied > 0 ? `${result.error} ${applied} were changed first.${detail}` : result.error)
      } else if (applied === 0) {
        toast.success(`Nothing was changed.${detail}`)
      } else {
        toast.success(`Changed ${plural(applied, 'transaction', 'transactions')}.${detail} Undo it from Recent runs in the rules section.`)
      }
      router.refresh()
    })
  }

  const handleResetGroup = (details: string) => {
    const group = initialData.groups.find((item) => item.details === details)
    if (!group) return
    setVendorDrafts((prev) => ({
      ...prev,
      [details]: group.suggestion.vendorName ?? '',
    }))
    setExpenseDrafts((prev) => ({
      ...prev,
      [details]: group.suggestion.expenseCategory ?? '',
    }))
    setApplyVendor((prev) => ({
      ...prev,
      [details]: group.needsVendorCount > 0 || Boolean(group.suggestion.vendorName),
    }))
    setApplyExpense((prev) => ({
      ...prev,
      [details]: group.needsExpenseCount > 0 || Boolean(group.suggestion.expenseCategory),
    }))
    toast.success('Reset to suggested values')
  }

  const handleCreateRule = (details: string, vendorChoice: { vendorName?: string; createVendor?: boolean } = {}) => {
    if (!canManageReceipts) {
      toast.error(managePermissionMessage)
      return
    }
    const draft = ruleDrafts[details]
    if (!draft) return

    const payload: Parameters<typeof createReceiptRuleFromGroup>[0] = {
      name: draft.name,
      details,
      matchDescription: draft.matchDescription,
      direction: draft.direction,
      autoStatus: draft.autoStatus,
    }

    if (draft.setVendor) {
      const value = (vendorChoice.vendorName ?? vendorDrafts[details] ?? '').trim()
      if (value.length) {
        payload.vendorName = value
        if (vendorChoice.createVendor) payload.createVendor = true
      }
    }

    if (draft.setExpense) {
      const value = (expenseDrafts[details] ?? '').trim()
      if (value.length) {
        payload.expenseCategory = value as ReceiptExpenseCategory
      }
    }

    setActiveRuleGroup(details)
    startCreateRule(async () => {
      const result = await createReceiptRuleFromGroup(payload)
      setActiveRuleGroup(null)
      if (!result || 'error' in result) {
        toast.error(result?.error ?? 'Failed to create rule')
        return
      }
      // The rule names a vendor that is not on the list. Nothing was saved: ask first.
      if ('vendorConfirmation' in result) {
        setVendorPrompt({ action: 'rule', details, confirmation: result.vendorConfirmation })
        return
      }
      setVendorPrompt(null)
      if (vendorChoice.vendorName) {
        setVendorDrafts((prev) => ({ ...prev, [details]: vendorChoice.vendorName as string }))
      }
      toast.success('Rule created, you can run it against recent transactions now')
      setCreatedRules((prev) => ({
        ...prev,
        [details]: { id: result.rule.id, name: result.rule.name },
      }))
      router.refresh()
    })
  }

  const handleRunRetro = (details: string) => {
    if (!canManageReceipts) {
      toast.error(managePermissionMessage)
      return
    }
    const rule = createdRules[details]
    if (!rule) return
    void previewRetro({ ruleId: rule.id, scope: 'pending' }).then((preview) => {
      if (!preview) return
      if (!preview.runId || preview.planned === 0) {
        toast.success('Nothing to change. Every matching pending transaction is already as this rule would set it.')
        return
      }
      setRetroRun({ ruleId: rule.id, preview: { ...preview, runId: preview.runId } })
    })
  }

  const updateRuleDraft = (details: string, changes: Partial<RuleDraft>) =>
    setRuleDrafts((prev) => ({
      ...prev,
      [details]: {
        ...prev[details],
        ...changes,
      },
    }))

  // Each block is a direct child of the page's 24px stack.
  return (
    <>
      <Card>
        <CardHeader title="Filters" subtitle="Fine-tune which transactions are grouped before you approve them" />
        <CardBody>
          <div className="grid gap-4 md:grid-cols-3">
            <Fieldset legend="Statuses">
              <div className="flex flex-wrap gap-x-3">
                {statusOrder.map((status) => (
                  <Checkbox
                    key={status}
                    label={STATUS_LABELS[status]}
                    checked={currentStatuses.has(status)}
                    onChange={() => handleStatusToggle(status)}
                  />
                ))}
              </div>
            </Fieldset>
            <Select
              label="Group limit"
              value={String(localLimit)}
              onChange={(event) => handleLimitChange(event.target.value)}
              options={limitOptions.map((option) => ({
                value: String(option),
                label: `${option} rows`,
              }))}
            />
            <Fieldset legend="Scope" hint={`Currently reviewing: ${statusesLabel || 'pending transactions'}`}>
              <Checkbox
                label="Only show transactions missing vendor and expense tags"
                checked={localOnlyUnclassified}
                onChange={(checked) => handleOnlyUnclassifiedToggle(checked)}
              />
              <Checkbox
                label="Fuzzy group similar transactions"
                checked={localFuzzyGrouping}
                onChange={(checked) => handleFuzzyToggle(checked)}
              />
            </Fieldset>
          </div>
        </CardBody>
      </Card>

      {initialData.groups.length === 0 ? (
        <Card>
          <Empty
            size="sm"
            icon={<Icon name="clock" size={40} />}
            title="No transactions match these filters"
            description="Change the filters above or import more transactions."
          />
        </Card>
      ) : (
        initialData.groups.map((group) => {
          const vendorValue = vendorDrafts[group.details] ?? ''
          const expenseValue = expenseDrafts[group.details] ?? ''
          const ruleDraft = ruleDrafts[group.details]
          const suggestion = group.suggestion
          const isApplyingGroup = isApplying && activeApplyGroup === group.details
          const isCreatingForGroup = isCreatingRule && activeRuleGroup === group.details
          const isRetroPending = (isRunningRetro || isPreviewingRetro) && retroRunningRuleId === createdRules[group.details]?.id
          const createdRule = createdRules[group.details]
          const sample = group.sampleTransaction

          return (
            <Card key={group.details}>
              <CardHeader
                title={group.details}
                action={
                  <div className="flex items-center gap-2">
                    {suggestion.source !== 'none' && (
                      <Badge tone={RECEIPT_SUGGESTION_SOURCE_TONE[suggestion.source]}>
                        {RECEIPT_SUGGESTION_SOURCE_LABEL[suggestion.source]}
                      </Badge>
                    )}
                    {suggestion.model && (
                      <Badge tone="neutral">{suggestion.model}</Badge>
                    )}
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span className="inline-flex items-center gap-1"><Icon name="users" size={16} /> {group.transactionCount} transactions</span>
                  <span className="inline-flex items-center gap-1"><Icon name="store" size={16} /> {group.needsVendorCount} need vendor</span>
                  <span className="inline-flex items-center gap-1"><Icon name="store" size={16} /> {group.needsExpenseCount} need expense</span>
                  <span className="inline-flex items-center gap-1"><Icon name="clock" size={16} /> {formatDate(group.firstDate)} → {formatDate(group.lastDate)}</span>
                  <span className="inline-flex items-center gap-1">In: {formatCurrency(group.totalIn)}</span>
                  <span className="inline-flex items-center gap-1">Out: {formatCurrency(group.totalOut)}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-end gap-3">
                      <Checkbox
                        aria-label={`Apply vendor suggestion for ${group.details}`}
                        checked={applyVendor[group.details] ?? false}
                        onChange={(checked) => setApplyVendor((prev) => ({ ...prev, [group.details]: checked }))}
                        disabled={!canManageReceipts}
                        className="mb-2.5"
                      />
                      <div className="min-w-0 flex-1">
                        <Input
                          label="Vendor"
                          value={vendorValue}
                          onChange={(event) => setVendorDrafts((prev) => ({ ...prev, [group.details]: event.target.value }))}
                          disabled={!applyVendor[group.details] || !canManageReceipts}
                          placeholder="Suggested vendor"
                        />
                      </div>
                    </div>
                    {suggestion.vendorName && (
                      <p className="text-xs text-text-muted inline-flex items-center gap-1"><Icon name="sparkles" size={16} className="text-info" /> {suggestion.vendorName}{suggestion.reasoning ? `: ${suggestion.reasoning}` : ''}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-end gap-3">
                      <Checkbox
                        aria-label={`Apply expense category suggestion for ${group.details}`}
                        checked={applyExpense[group.details] ?? false}
                        onChange={(checked) => setApplyExpense((prev) => ({ ...prev, [group.details]: checked }))}
                        disabled={!canManageReceipts}
                        className="mb-2.5"
                      />
                      <div className="min-w-0 flex-1">
                        <Select
                          label="Expense category"
                          value={expenseValue}
                          onChange={(event) => setExpenseDrafts((prev) => ({ ...prev, [group.details]: event.target.value }))}
                          disabled={!applyExpense[group.details] || !canManageReceipts}
                          options={[
                            { value: '', label: 'Leave unset' },
                            ...EXPENSE_OPTIONS.map((option) => ({
                              value: option,
                              label: option,
                            })),
                            { value: NO_CATEGORY_VALUE, label: NO_CATEGORY_LABEL },
                          ]}
                        />
                      </div>
                    </div>
                    {suggestion.expenseCategory && (
                      <p className="text-xs text-text-muted inline-flex items-center gap-1"><Icon name="sparkles" size={16} className="text-info" /> {suggestion.expenseCategory}</p>
                    )}
                  </div>
                </div>

                {sample && (
                  <div className="border-t border-border pt-4 text-xs text-text-muted">
                    <SubHeading className="mb-2">Sample Transaction</SubHeading>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <span className="font-medium text-text">Date:</span> {formatDate(sample.transactionDate)}
                      </div>
                      <div>
                        <span className="font-medium text-text">Amount:</span> {formatCurrency(sample.amountOut && sample.amountOut > 0 ? sample.amountOut : sample.amountIn ?? 0)}
                      </div>
                      <div>
                        <span className="font-medium text-text">Current vendor:</span> {sample.vendorName ?? 'Not set'}
                      </div>
                      <div>
                        <span className="font-medium text-text">Current expense:</span> {sample.expenseCategory ?? 'Not set'}
                      </div>
                      <div>
                        <span className="font-medium text-text">Source:</span> {sample.vendorSource ?? sample.expenseCategorySource ?? 'Not set'}
                      </div>
                    </div>
                  </div>
                )}

                <FormFooter>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleResetGroup(group.details)}
                    disabled={isApplyingGroup || !canManageReceipts}
                  >
                    Reset to Suggestion
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => handleApplyGroup(group.details)}
                    loading={isApplyingGroup}
                    disabled={!canManageReceipts}
                  >
                    Apply Classification
                  </Button>
                </FormFooter>

                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setActiveRuleGroup((current) => current === group.details ? null : group.details)}
                    disabled={!canManageReceipts}
                  >
                    New Rule
                  </Button>
                  {createdRule && (
                    <Badge tone="success">Rule created: {createdRule.name}</Badge>
                  )}
                  {createdRule && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleRunRetro(group.details)}
                      loading={isRetroPending}
                      disabled={!canManageReceipts}
                    >
                      Run Rule Retro
                    </Button>
                  )}
                </div>

                {activeRuleGroup === group.details && ruleDraft && (
                  <div className="space-y-4">
                    <SubHeading className="flex items-center gap-2">
                      <Icon name="rocket" size={20} className="text-success" />
                      New Rule
                    </SubHeading>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input
                        label="Rule name"
                        value={ruleDraft.name}
                        onChange={(event) => updateRuleDraft(group.details, { name: event.target.value })}
                      />
                      <Input
                        label="Match keywords"
                        value={ruleDraft.matchDescription}
                        onChange={(event) => updateRuleDraft(group.details, { matchDescription: event.target.value })}
                      />
                      <Select
                        label="Direction"
                        value={ruleDraft.direction}
                        onChange={(event) => updateRuleDraft(group.details, { direction: event.target.value as 'in' | 'out' | 'both' })}
                        options={RULE_DIRECTION_OPTIONS.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))}
                      />
                      <Select
                        label="Auto status"
                        value={ruleDraft.autoStatus}
                        onChange={(event) => updateRuleDraft(group.details, { autoStatus: event.target.value as BulkStatus })}
                        options={RULE_STATUS_OPTIONS.map((status) => ({
                          value: status,
                          label: STATUS_LABELS[status],
                        }))}
                      />
                      <Checkbox
                        label="Set vendor automatically"
                        checked={ruleDraft.setVendor}
                        onChange={(checked) => updateRuleDraft(group.details, { setVendor: checked })}
                      />
                      <Checkbox
                        label="Set expense category automatically"
                        checked={ruleDraft.setExpense}
                        onChange={(checked) => updateRuleDraft(group.details, { setExpense: checked })}
                      />
                    </div>
                    <FormFooter start="We’ll still ask before running this rule retroactively so you stay in control.">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => handleCreateRule(group.details)}
                        loading={isCreatingForGroup}
                        disabled={!canManageReceipts}
                      >
                        Create Rule
                      </Button>
                    </FormFooter>
                  </div>
                )}
              </CardBody>
            </Card>
          )
        })
      )}
      <RuleRunDialog
        preview={retroRun?.preview ?? null}
        running={isRunningRetro}
        onClose={() => setRetroRun(null)}
        onRun={() => {
          if (!retroRun) return
          const { ruleId, preview } = retroRun
          setRetroRun(null)
          runRetro(preview, ruleId)
        }}
      />
      {applyPrompt && (
        <Modal
          open
          onClose={isApplying ? () => undefined : () => setApplyPrompt(null)}
          title="Apply classification"
          description={applyPrompt.details}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setApplyPrompt(null)} disabled={isApplying}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmApply}
                loading={isApplying}
                disabled={applyPrompt.preview.willChange === 0 && !applyPrompt.includeDecided}
              >
                Apply
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p>
              <span className="font-medium text-text-strong">
                {plural(applyPrompt.preview.willChange, 'transaction', 'transactions')} will change
              </span>{' '}
              out of {applyPrompt.preview.total}.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {applyPrompt.preview.unchanged > 0 && (
                <li>{plural(applyPrompt.preview.unchanged, 'already has', 'already have')} this and will be left.</li>
              )}
              {applyPrompt.preview.decidedByPerson > 0 && (
                <li>
                  {plural(applyPrompt.preview.decidedByPerson, 'was', 'were')} decided by a person and will not change.
                </li>
              )}
              {applyPrompt.preview.locked > 0 && (
                <li>{plural(applyPrompt.preview.locked, 'is', 'are')} on or before the lock date and will not change.</li>
              )}
              {applyPrompt.preview.incomingSkipped > 0 && (
                <li>
                  {plural(applyPrompt.preview.incomingSkipped, 'is', 'are')} money in, which takes no expense category.
                </li>
              )}
            </ul>
            {applyPrompt.preview.decidedByPerson > 0 && (
              <Checkbox
                label={`Also change the ${applyPrompt.preview.decidedByPerson} a person decided`}
                checked={applyPrompt.includeDecided}
                onChange={(checked) => setApplyPrompt((current) => (current ? { ...current, includeDecided: checked } : current))}
                disabled={isApplying}
              />
            )}
            <p className="text-sm text-text-muted">
              Statuses are not changed. This is recorded as a run, and can be undone from Recent runs in the rules
              section.
            </p>
          </div>
        </Modal>
      )}
      <NewVendorDialog
        prompt={vendorPrompt?.confirmation ?? null}
        pending={isApplying || isCreatingRule}
        onUseExisting={(vendorName) => {
          if (!vendorPrompt) return
          const run = vendorPrompt.action === 'apply' ? handleApplyGroup : handleCreateRule
          run(vendorPrompt.details, { vendorName })
        }}
        onCreate={() => {
          if (!vendorPrompt) return
          const run = vendorPrompt.action === 'apply' ? handleApplyGroup : handleCreateRule
          run(vendorPrompt.details, { createVendor: true })
        }}
        onClose={() => setVendorPrompt(null)}
      />
    </>
  )
}
