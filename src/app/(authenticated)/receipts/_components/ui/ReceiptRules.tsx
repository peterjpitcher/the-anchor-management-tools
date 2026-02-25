'use client'

import { useEffect, useMemo, useState, useTransition, FormEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { SearchInput } from '@/components/ui-v2/forms/SearchInput'
import { Select } from '@/components/ui-v2/forms/Select'
import { Card } from '@/components/ui-v2/layout/Card'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Accordion } from '@/components/ui-v2/display/Accordion'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import {
  toggleReceiptRule,
  createReceiptRule,
  updateReceiptRule,
  deleteReceiptRule,
  previewReceiptRule,
  type ClassificationRuleSuggestion,
  type RulePreviewResult,
} from '@/app/actions/receipts'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import { useRetroRuleRunner } from '@/hooks/useRetroRuleRunner'
import { usePermissions } from '@/contexts/PermissionContext'
import type { ReceiptRule, ReceiptTransaction } from '@/types/database'

interface ReceiptRulesProps {
  rules: ReceiptRule[]
  pendingSuggestion: ClassificationRuleSuggestion | null
  onApplySuggestion: (suggestion: ClassificationRuleSuggestion) => void
  onDismissSuggestion: () => void
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options
const statusLabels: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

function MatchDescriptionTokenPreview({ value }: { value: string }) {
  if (!value.trim()) return null
  const tokens = value.split(',').map((t) => t.trim()).filter(Boolean)
  const hasEmpty = value.split(',').some((t) => t.trim() === '' && value.includes(','))
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tokens.map((token, index) => (
        <span
          key={index}
          className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200"
        >
          {token}
        </span>
      ))}
      {hasEmpty && (
        <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
          empty token — remove double commas
        </span>
      )}
    </div>
  )
}

function RulePreviewPanel({ preview }: { preview: RulePreviewResult }) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 space-y-2">
      <p className="font-semibold">Rule preview (sample of up to 2000 transactions)</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span>Total matching</span><span className="font-medium">{preview.totalMatching}</span>
        <span>Pending matching</span><span className="font-medium">{preview.pendingMatching}</span>
        <span>Would change status</span><span className="font-medium">{preview.wouldChangeStatus}</span>
        <span>Would change vendor</span><span className="font-medium">{preview.wouldChangeVendor}</span>
        <span>Would change expense</span><span className="font-medium">{preview.wouldChangeExpense}</span>
      </div>
      {preview.overlappingRules.length > 0 && (
        <div>
          <p className="font-medium text-amber-700">Overlapping rules:</p>
          {preview.overlappingRules.map((r) => (
            <p key={r.id} className="text-amber-700">
              {r.name} — {r.overlapCount} overlap{r.overlapCount !== 1 ? 's' : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReceiptRules({ rules, pendingSuggestion, onApplySuggestion, onDismissSuggestion }: ReceiptRulesProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')
  const { runRetro, isRunning: isRetroPending, activeRuleId: retroRuleId } = useRetroRuleRunner()

  const [isSectionOpen, setIsSectionOpen] = useState(false)
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [isRulePending, startRuleTransition] = useTransition()
  const [isPreviewPending, startPreviewTransition] = useTransition()
  const [retroPrompt, setRetroPrompt] = useState<{ id: string; name: string } | null>(null)
  const [retroScope, setRetroScope] = useState<'pending' | 'all'>('all')
  const [retroConfirmRuleId, setRetroConfirmRuleId] = useState<string | null>(null)
  const [retroConfirmScope, setRetroConfirmScope] = useState<'pending' | 'all'>('all')
  const [ruleSearch, setRuleSearch] = useState('')
  const [expandedRuleKeys, setExpandedRuleKeys] = useState<string[]>([])
  const [newMatchDescription, setNewMatchDescription] = useState('')
  const [editMatchDescription, setEditMatchDescription] = useState('')
  const [rulePreview, setRulePreview] = useState<RulePreviewResult | null>(null)
  const [isPreviewVisible, setIsPreviewVisible] = useState(false)
  const newRuleFormRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    if (pendingSuggestion) {
      setIsSectionOpen(true)
    }
  }, [pendingSuggestion])

  const filteredRules = useMemo(() => {
    const trimmedQuery = ruleSearch.trim().toLowerCase()
    if (!trimmedQuery) return rules

    const tokens = trimmedQuery.split(/\s+/).filter(Boolean)
    return rules.filter((rule) => {
      const haystack = [
        rule.name,
        rule.description,
        rule.match_description,
        rule.match_transaction_type,
        rule.match_direction,
        rule.auto_status,
        statusLabels[rule.auto_status],
        rule.set_vendor_name,
        rule.set_expense_category,
        rule.match_min_amount == null ? null : String(rule.match_min_amount),
        rule.match_max_amount == null ? null : String(rule.match_max_amount),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return tokens.every((token) => haystack.includes(token))
    })
  }, [ruleSearch, rules])

  const visibleRuleIds = useMemo(() => new Set(filteredRules.map((rule) => rule.id)), [filteredRules])
  const expandedVisibleRuleCount = useMemo(
    () => expandedRuleKeys.filter((key) => visibleRuleIds.has(key)).length,
    [expandedRuleKeys, visibleRuleIds]
  )

  function expandAllVisibleRules() {
    setExpandedRuleKeys((current) => {
      const next = new Set(current)
      filteredRules.forEach((rule) => next.add(rule.id))
      return Array.from(next)
    })
  }

  function collapseAllVisibleRules() {
    setExpandedRuleKeys((current) => current.filter((key) => !visibleRuleIds.has(key)))
  }

  // Expose the form ref to parent if needed, or handle suggestion application internally if passed as prop
  // For now, we'll assume the parent handles the "prefill" logic by passing a key or we handle it here.
  // Wait, the `applyRuleSuggestion` in the original code manipulated the DOM directly using the ref.
  // We should probably replicate that or use controlled inputs. Controlled inputs are better but more verbose.
  // Given the refactor, I'll stick to the DOM manipulation for now to match the original behavior, 
  // but I need to expose the ref or move the `applyRuleSuggestion` logic HERE.
  // Yes, moving it here makes sense.

  function applySuggestion(suggestion: ClassificationRuleSuggestion) {
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
    onApplySuggestion(suggestion) // Notify parent to clear suggestion
  }
  
  // If the parent passes a pending suggestion, we can try to apply it if we want, 
  // but usually it's triggered by a user action. 
  // The original code had a "Apply" button in a banner.
  
  function handleRetroRun(ruleId: string, scope: 'pending' | 'all') {
    if (!canManageReceipts) {
      toast.error('You do not have permission to manage receipts.')
      return
    }
    setRetroPrompt(null)
    setRetroScope('pending')
    runRetro({ ruleId, scope })
  }

  function handlePreviewRule(formRef: React.RefObject<HTMLFormElement | null>) {
    const form = formRef.current
    if (!form) return
    startPreviewTransition(async () => {
      const formData = new FormData(form)
      const result = await previewReceiptRule(formData)
      if (!result.success || !result.preview) {
        toast.error(result.error ?? 'Failed to preview rule')
        return
      }
      setRulePreview(result.preview)
      setIsPreviewVisible(true)
    })
  }

  async function handleRuleToggle(rule: ReceiptRule) {
    if (!canManageReceipts) return
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
    if (!canManageReceipts) return
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
    if (!canManageReceipts) return
    
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
      }
      setEditingRuleId(null)
      if (!ruleId) formElement.reset()
      router.refresh()
      setActiveRuleId(null)
    })
  }

  return (
    <Card className="hidden md:block" padding="none">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Automation rules</h2>
            {pendingSuggestion && <Badge size="sm" variant="success">Suggestion</Badge>}
          </div>
          <p className="text-sm text-gray-500">Automatically tick off known transactions (e.g. card settlements).</p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge variant="secondary">{rules.length} rules</Badge>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={isSectionOpen}
            onClick={() => setIsSectionOpen((current) => !current)}
          >
            {isSectionOpen ? 'Hide' : 'Show'}
          </Button>
        </div>
      </div>

      {isSectionOpen && (
        <>
          <div className="border-t border-gray-200" />
          <div className="p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card
                variant="bordered"
                header={<h3 className="text-md font-semibold text-gray-900">New rule</h3>}
              >
                {pendingSuggestion && (
                  <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-emerald-800">
                        Suggestion ready for {pendingSuggestion.setVendorName ?? pendingSuggestion.setExpenseCategory}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => applySuggestion(pendingSuggestion)}
                        >
                          Apply
                        </Button>
                        <Button size="xs" variant="ghost" onClick={onDismissSuggestion}>
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
                  <div>
                    <Input
                      name="match_description"
                      placeholder="Match description (comma separated keywords)"
                      value={newMatchDescription}
                      onChange={(e) => { setNewMatchDescription(e.target.value); setIsPreviewVisible(false) }}
                    />
                    <MatchDescriptionTokenPreview value={newMatchDescription} />
                  </div>
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
                  {isPreviewVisible && rulePreview && (
                    <RulePreviewPanel preview={rulePreview} />
                  )}
                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={!canManageReceipts || (isRulePending && activeRuleId === 'new')}>
                      {isRulePending && activeRuleId === 'new' && <Spinner className="mr-2 h-4 w-4" />}Create rule
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isPreviewPending || !canManageReceipts}
                      onClick={() => handlePreviewRule(newRuleFormRef)}
                    >
                      {isPreviewPending ? <><Spinner className="mr-2 h-4 w-4" />Previewing…</> : 'Preview'}
                    </Button>
                  </div>
                </form>
              </Card>

              <div className="space-y-3">
                <SearchInput
                  value={ruleSearch}
                  onSearch={setRuleSearch}
                  placeholder="Search rules..."
                  inputSize="sm"
                />

                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-gray-500">
                    {ruleSearch.trim()
                      ? <>Showing {filteredRules.length} of {rules.length} rules</>
                      : <>{rules.length} rules</>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={collapseAllVisibleRules}
                      disabled={expandedVisibleRuleCount === 0}
                    >
                      Collapse all
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={expandAllVisibleRules}
                      disabled={filteredRules.length === 0 || expandedVisibleRuleCount === filteredRules.length}
                    >
                      Expand all
                    </Button>
                  </div>
                </div>

                {rules.length === 0 ? (
                  <p className="text-sm text-gray-500">No automation rules yet. Start by adding keywords for things like card settlements.</p>
                ) : filteredRules.length === 0 ? (
                  <p className="text-sm text-gray-500">No rules match &quot;{ruleSearch.trim()}&quot;.</p>
                ) : (
                  <Accordion
                    multiple
                    variant="bordered"
                    size="sm"
                    activeKeys={expandedRuleKeys}
                    onChange={setExpandedRuleKeys}
                    items={filteredRules.map((rule) => ({
                      key: rule.id,
                      title: (
                        <>
                          <span className="block truncate text-sm font-semibold text-gray-900">{rule.name}</span>
                          <span className="mt-0.5 block truncate text-xs font-normal text-gray-500">
                            {rule.description ?? `Matches: ${rule.match_description ?? 'any'}`}
                          </span>
                        </>
                      ),
                      extra: (
                        <div className="flex items-center gap-2">
                          <Badge size="sm" variant={rule.is_active ? 'success' : 'secondary'}>
                            {rule.is_active ? 'Active' : 'Disabled'}
                          </Badge>
                          <Badge size="sm" variant="neutral">
                            {statusLabels[rule.auto_status]}
                          </Badge>
                        </div>
                      ),
                      content: (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditingRuleId((current) => current === rule.id ? null : rule.id)}
                              disabled={(isRulePending && activeRuleId === rule.id) || !canManageReceipts}
                            >
                              {editingRuleId === rule.id ? 'Close editor' : 'Edit'}
                            </Button>
                            {retroConfirmRuleId === rule.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <Select
                                  value={retroConfirmScope}
                                  onChange={(e) => setRetroConfirmScope(e.target.value as 'pending' | 'all')}
                                  selectSize="sm"
                                  className="w-40"
                                >
                                  <option value="pending">Pending only</option>
                                  <option value="all">All historical</option>
                                </Select>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => { setRetroConfirmRuleId(null); handleRetroRun(rule.id, retroConfirmScope) }}
                                  disabled={isRetroPending}
                                >
                                  {isRetroPending && retroRuleId === rule.id ? <><Spinner className="mr-1 h-4 w-4" />Running…</> : 'Run now'}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setRetroConfirmRuleId(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => { setRetroConfirmRuleId(rule.id); setRetroConfirmScope('all') }}
                                disabled={!rule.is_active || isRetroPending || !canManageReceipts}
                                title={rule.is_active ? 'Run this rule across historical transactions' : 'Enable the rule before running it'}
                              >
                                Run historical
                              </Button>
                            )}
                            <Button
                              variant={rule.is_active ? 'success' : 'ghost'}
                              size="sm"
                              onClick={() => handleRuleToggle(rule)}
                              disabled={(isRulePending && activeRuleId === rule.id) || !canManageReceipts}
                            >
                              {isRulePending && activeRuleId === rule.id ? <Spinner className="h-4 w-4" /> : rule.is_active ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRuleDelete(rule.id)}
                              disabled={(isRulePending && activeRuleId === rule.id) || !canManageReceipts}
                            >
                              Delete
                            </Button>
                          </div>

                          {editingRuleId === rule.id ? (
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
                          ) : (
                            <div className="space-y-1 text-xs text-gray-500">
                              <p>Direction: {rule.match_direction}</p>
                              {rule.match_min_amount != null && <p>Min amount: £{rule.match_min_amount.toFixed(2)}</p>}
                              {rule.match_max_amount != null && <p>Max amount: £{rule.match_max_amount.toFixed(2)}</p>}
                              <p>Outcome: {statusLabels[rule.auto_status]}</p>
                              {rule.set_vendor_name && <p>Sets vendor: {rule.set_vendor_name}</p>}
                              {rule.set_expense_category && <p>Sets expense: {rule.set_expense_category}</p>}
                            </div>
                          )}
                        </div>
                      ),
                    }))}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
