'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SparklesIcon, ClockIcon, UsersIcon, BuildingStorefrontIcon, RocketLaunchIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import type { ReceiptBulkReviewData } from '@/app/actions/receipts'
import {
  applyReceiptGroupClassification,
  createReceiptRuleFromGroup,
  runReceiptRuleRetroactively,
} from '@/app/actions/receipts'
import { receiptExpenseCategorySchema, receiptTransactionStatusSchema } from '@/lib/validation'
import type { ReceiptExpenseCategory, ReceiptTransaction } from '@/types/database'

const STATUS_LABELS: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
}

const EXPENSE_OPTIONS = receiptExpenseCategorySchema.options
const RULE_STATUS_OPTIONS: ReceiptTransaction['status'][] = ['no_receipt_required', 'auto_completed', 'completed', 'pending']
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
  if (!value) return '—'
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
  const [isApplying, startApply] = useTransition()
  const [isCreatingRule, startCreateRule] = useTransition()
  const [isRunningRetro, startRunRetro] = useTransition()

  const [activeApplyGroup, setActiveApplyGroup] = useState<string | null>(null)
  const [activeRuleGroup, setActiveRuleGroup] = useState<string | null>(null)
  const [retroGroupId, setRetroGroupId] = useState<string | null>(null)

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
  const statusOrder: BulkStatus[] = useMemo(() => ['pending', 'auto_completed', 'completed', 'no_receipt_required'], [])

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

  const currentStatuses = useMemo(() => new Set(initialFilters.statuses), [initialFilters.statuses])

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
    updateQuery({ statuses: Array.from(next).join(',') })
  }

  const handleLimitChange = (value: string) => {
    updateQuery({ limit: value })
  }

  const handleOnlyUnclassifiedToggle = (checked: boolean) => {
    updateQuery({ all: checked ? null : '1' })
  }

  const statusesLabel = initialFilters.statuses.map((status) => STATUS_LABELS[status]).join(', ')

  const handleApplyGroup = (details: string) => {
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
    const rule = createdRules[details]
    if (!rule) return
    console.log('[retro-ui] bulk handleRunRetro', { ruleId: rule.id, details })
    setRetroGroupId(details)
    startRunRetro(async () => {
      const result = await runReceiptRuleRetroactively(rule.id)
      setRetroGroupId(null)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        `Rule reviewed ${result.matched ?? 0}/${result.reviewed ?? 0} transactions · ${result.autoApplied ?? 0} status updates · ${result.classified ?? 0} classifications · vendor intents ${result.vendorIntended ?? 0} · expense intents ${result.expenseIntended ?? 0}`
      )
      if (result.samples && result.samples.length) {
        console.groupCollapsed(`Bulk rule analysis (${result.samples.length} sample transactions)`)
        console.table(result.samples)
        console.groupEnd()
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Card
        variant="bordered"
        header={<div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
            <p className="text-sm text-gray-500">Fine-tune which transactions are grouped before you approve them.</p>
          </div>
        </div>}
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Statuses</label>
            <div className="mt-2 flex flex-wrap gap-3">
              {statusOrder.map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm text-gray-700">
                  <Checkbox
                    checked={currentStatuses.has(status)}
                    onChange={() => handleStatusToggle(status)}
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Group limit</label>
            <Select
              className="mt-2"
              value={String(initialFilters.limit)}
              onChange={(event) => handleLimitChange(event.target.value)}
            >
              {limitOptions.map((option) => (
                <option key={option} value={option}>{option} rows</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Scope</label>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
              <Checkbox
                checked={initialFilters.onlyUnclassified}
                onChange={(event) => handleOnlyUnclassifiedToggle(event.target.checked)}
              />
              Only show transactions missing vendor or expense tags
            </div>
            <p className="mt-2 text-xs text-gray-500">Currently reviewing: {statusesLabel || 'pending transactions'}.</p>
          </div>
        </div>
      </Card>

      {initialData.groups.length === 0 ? (
        <Card variant="bordered">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <ClockIcon className="h-5 w-5 text-gray-400" />
            Nothing to review with your current filters. Adjust the filters above or import more transactions.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {initialData.groups.map((group) => {
            const vendorValue = vendorDrafts[group.details] ?? ''
            const expenseValue = expenseDrafts[group.details] ?? ''
            const ruleDraft = ruleDrafts[group.details]
            const suggestion = group.suggestion
            const isApplyingGroup = isApplying && activeApplyGroup === group.details
            const isCreatingForGroup = isCreatingRule && activeRuleGroup === group.details
            const isRetroPending = isRunningRetro && retroGroupId === group.details
            const createdRule = createdRules[group.details]
            const sample = group.sampleTransaction

            return (
              <Card
                key={group.details}
                variant="bordered"
                header={<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold text-gray-900">{group.details}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1"><UsersIcon className="h-4 w-4" /> {group.transactionCount} transactions</span>
                      <span className="inline-flex items-center gap-1"><BuildingStorefrontIcon className="h-4 w-4" /> {group.needsVendorCount} need vendor</span>
                      <span className="inline-flex items-center gap-1"><BuildingStorefrontIcon className="h-4 w-4" /> {group.needsExpenseCount} need expense</span>
                      <span className="inline-flex items-center gap-1"><ClockIcon className="h-4 w-4" /> {formatDate(group.firstDate)} → {formatDate(group.lastDate)}</span>
                      <span className="inline-flex items-center gap-1">In: {formatCurrency(group.totalIn)}</span>
                      <span className="inline-flex items-center gap-1">Out: {formatCurrency(group.totalOut)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {suggestion.source !== 'none' && (
                      <Badge variant={suggestion.source === 'ai' ? 'info' : 'secondary'} size="sm">
                        {suggestion.source === 'ai' ? 'AI suggestion' : 'Based on existing data'}
                      </Badge>
                    )}
                    {suggestion.model && (
                      <Badge variant="default" size="sm">{suggestion.model}</Badge>
                    )}
                  </div>
                </div>}
              >
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Vendor</label>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={applyVendor[group.details] ?? false}
                          onChange={(event) => setApplyVendor((prev) => ({ ...prev, [group.details]: event.target.checked }))}
                        />
                        <Input
                          value={vendorValue}
                          onChange={(event) => setVendorDrafts((prev) => ({ ...prev, [group.details]: event.target.value }))}
                          disabled={!applyVendor[group.details]}
                          placeholder="Suggested vendor"
                        />
                      </div>
                      {suggestion.vendorName && (
                        <p className="text-xs text-gray-500 inline-flex items-center gap-1"><SparklesIcon className="h-4 w-4 text-blue-500" /> {suggestion.vendorName}{suggestion.reasoning ? ` — ${suggestion.reasoning}` : ''}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Expense category</label>
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={applyExpense[group.details] ?? false}
                          onChange={(event) => setApplyExpense((prev) => ({ ...prev, [group.details]: event.target.checked }))}
                        />
                        <Select
                          value={expenseValue}
                          onChange={(event) => setExpenseDrafts((prev) => ({ ...prev, [group.details]: event.target.value }))}
                          disabled={!applyExpense[group.details]}
                        >
                          <option value="">Leave unset</option>
                          {EXPENSE_OPTIONS.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </Select>
                      </div>
                      {suggestion.expenseCategory && (
                        <p className="text-xs text-gray-500 inline-flex items-center gap-1"><SparklesIcon className="h-4 w-4 text-blue-500" /> {suggestion.expenseCategory}</p>
                      )}
                    </div>
                  </div>

                  {sample && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                      <p className="font-medium text-gray-700">Sample transaction</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <div>
                          <span className="font-medium text-gray-700">Date:</span> {formatDate(sample.transactionDate)}
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Amount:</span> {formatCurrency(sample.amountOut && sample.amountOut > 0 ? sample.amountOut : sample.amountIn ?? 0)}
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Current vendor:</span> {sample.vendorName ?? '—'}
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Current expense:</span> {sample.expenseCategory ?? '—'}
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">Source:</span> {sample.vendorSource ?? sample.expenseCategorySource ?? '—'}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => handleApplyGroup(group.details)}
                      disabled={isApplyingGroup}
                    >
                      {isApplyingGroup && <Spinner className="mr-2 h-4 w-4" />}Apply classification
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleResetGroup(group.details)}
                      disabled={isApplyingGroup}
                    >
                      Reset to suggestion
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setActiveRuleGroup((current) => current === group.details ? null : group.details)}
                    >
                      Configure rule
                    </Button>
                    {createdRule && (
                      <Badge variant="success" size="sm">Rule created: {createdRule.name}</Badge>
                    )}
                    {createdRule && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => handleRunRetro(group.details)}
                        disabled={isRetroPending}
                      >
                        {isRetroPending && <Spinner className="mr-2 h-4 w-4" />}Run rule retro
                      </Button>
                    )}
                  </div>

                  {activeRuleGroup === group.details && ruleDraft && (
                    <div className="mt-4 space-y-3 rounded-md border border-emerald-100 bg-emerald-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                        <RocketLaunchIcon className="h-5 w-5" />
                        Create automation rule
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="text-xs font-medium text-emerald-900">Rule name</label>
                          <Input
                            className="mt-1"
                            value={ruleDraft.name}
                            onChange={(event) => setRuleDrafts((prev) => ({
                              ...prev,
                              [group.details]: {
                                ...prev[group.details],
                                name: event.target.value,
                              },
                            }))}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-emerald-900">Match keywords</label>
                          <Input
                            className="mt-1"
                            value={ruleDraft.matchDescription}
                            onChange={(event) => setRuleDrafts((prev) => ({
                              ...prev,
                              [group.details]: {
                                ...prev[group.details],
                                matchDescription: event.target.value,
                              },
                            }))}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-emerald-900">Direction</label>
                          <Select
                            className="mt-1"
                            value={ruleDraft.direction}
                            onChange={(event) => setRuleDrafts((prev) => ({
                              ...prev,
                              [group.details]: {
                                ...prev[group.details],
                                direction: event.target.value as 'in' | 'out' | 'both',
                              },
                            }))}
                          >
                            {RULE_DIRECTION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </Select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-emerald-900">Auto status</label>
                          <Select
                            className="mt-1"
                            value={ruleDraft.autoStatus}
                            onChange={(event) => setRuleDrafts((prev) => ({
                              ...prev,
                              [group.details]: {
                                ...prev[group.details],
                                autoStatus: event.target.value as BulkStatus,
                              },
                            }))}
                          >
                            {RULE_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                            ))}
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={ruleDraft.setVendor}
                            onChange={(event) => setRuleDrafts((prev) => ({
                              ...prev,
                              [group.details]: {
                                ...prev[group.details],
                                setVendor: event.target.checked,
                              },
                            }))}
                          />
                          <span className="text-xs text-emerald-900">Set vendor automatically</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={ruleDraft.setExpense}
                            onChange={(event) => setRuleDrafts((prev) => ({
                              ...prev,
                              [group.details]: {
                                ...prev[group.details],
                                setExpense: event.target.checked,
                              },
                            }))}
                          />
                          <span className="text-xs text-emerald-900">Set expense category automatically</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleCreateRule(group.details)}
                          disabled={isCreatingForGroup}
                        >
                          {isCreatingForGroup && <Spinner className="mr-2 h-4 w-4" />}Save rule
                        </Button>
                        <p className="text-xs text-emerald-900">We&rsquo;ll still ask before running this rule retroactively so you stay in control.</p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
