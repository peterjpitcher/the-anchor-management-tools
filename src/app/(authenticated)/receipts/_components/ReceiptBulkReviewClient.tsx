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

const STATUS_LABELS = RECEIPT_STATUS_LABEL

const EXPENSE_OPTIONS = receiptExpenseCategorySchema.options
const RULE_STATUS_OPTIONS: ReceiptTransaction['status'][] = [
  'no_receipt_required',
  'auto_completed',
  'completed',
  'pending',
  'cant_find',
]
const RULE_DIRECTION_OPTIONS: Array<{ value: 'in' | 'out' | 'both'; label: string }> = [
  { value: 'out', label: 'Money out' },
  { value: 'in', label: 'Money in' },
  { value: 'both', label: 'Any direction' },
]

type BulkStatus = ReceiptTransaction['status']

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
  const { runRetro, isRunning: isRunningRetro, activeRuleId: retroRunningRuleId } = useRetroRuleRunner()

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
        matchDescription: group.details,
        direction: defaultRuleDirection(group.totalIn, group.totalOut),
        autoStatus: 'no_receipt_required',
        setVendor: Boolean(group.suggestion.vendorName),
        setExpense: Boolean(group.suggestion.expenseCategory),
      }
    })
    return map
  })

  const [createdRules, setCreatedRules] = useState<Record<string, { id: string; name: string }>>({})

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
        matchDescription: group.details,
        direction: defaultRuleDirection(group.totalIn, group.totalOut),
        autoStatus: 'no_receipt_required',
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

  const handleApplyGroup = (details: string) => {
    if (!canManageReceipts) {
      toast.error(managePermissionMessage)
      return
    }
    const vendorEnabled = applyVendor[details]
    const expenseEnabled = applyExpense[details]
    if (!vendorEnabled && !expenseEnabled) {
      toast.error('Choose at least one field to apply')
      return
    }

    const payload: {
      details: string
      statuses?: BulkStatus[]
      vendorName?: string | null
      expenseCategory?: ReceiptExpenseCategory | null
    } = {
      details,
    }

    if (initialData.config.statuses?.length) {
      payload.statuses = initialData.config.statuses
    }

    if (vendorEnabled) {
      const value = (vendorDrafts[details] ?? '').trim()
      payload.vendorName = value.length ? value : null
    }

    if (expenseEnabled) {
      const value = (expenseDrafts[details] ?? '').trim()
      payload.expenseCategory = value.length ? (value as ReceiptExpenseCategory) : null
    }

    setActiveApplyGroup(details)
    startApply(async () => {
      const result = await applyReceiptGroupClassification(payload)
      setActiveApplyGroup(null)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success(`Applied to ${result.updated ?? 0} transactions`)
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

  const handleCreateRule = (details: string) => {
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
      const value = (vendorDrafts[details] ?? '').trim()
      if (value.length) {
        payload.vendorName = value
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
    runRetro({ ruleId: rule.id, scope: 'pending' })
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
            title="Nothing to review with your current filters"
            description="Adjust the filters above or import more transactions."
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
          const isRetroPending = isRunningRetro && retroRunningRuleId === createdRules[group.details]?.id
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

                {localFuzzyGrouping && (
                  <Alert tone="warning" size="sm" role="status">
                    Fuzzy mode is on: &ldquo;Apply Classification&rdquo; will only update transactions whose description matches exactly &ldquo;{group.details}&rdquo;.
                  </Alert>
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
                    Configure Rule
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
                      Create Automation Rule
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
                        Save Rule
                      </Button>
                    </FormFooter>
                  </div>
                )}
              </CardBody>
            </Card>
          )
        })
      )}
    </>
  )
}
