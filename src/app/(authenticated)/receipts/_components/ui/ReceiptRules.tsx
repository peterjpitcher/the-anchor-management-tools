'use client'

import { useEffect, useMemo, useState, useTransition, FormEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button, Input, SearchInput, Select, Card, Badge, Spinner } from '@/ds'
import { Accordion } from '@/ds'
import {
  toggleReceiptRule,
  createReceiptRule,
  updateReceiptRule,
  deleteReceiptRule,
  previewReceiptRule,
  approveReceiptRuleSuggestion,
  approveReceiptRuleSuggestions,
  declineReceiptRuleSuggestion,
  getReceiptRuleSuggestionsPage,
  type ClassificationRuleSuggestion,
  type RulePreviewResult,
} from '@/app/actions/receipts'
import { receiptExpenseCategorySchema, receiptRuleKindSchema } from '@/lib/validation'
import { useRetroRuleRunner } from '@/hooks/useRetroRuleRunner'
import { usePermissions } from '@/contexts/PermissionContext'
import type { ReceiptRule, ReceiptRuleConflict, ReceiptRuleSuggestion, ReceiptTransaction } from '@/types/database'

interface ReceiptRulesProps {
  rules: ReceiptRule[]
  ruleConflicts: ReceiptRuleConflict[]
  ruleSuggestions: ReceiptRuleSuggestion[]
  /** Server count of all pending suggestions (drives the count badge and pagination). */
  suggestionsTotal: number
  canGovernRules: boolean
  pendingSuggestion: ClassificationRuleSuggestion | null
  onApplySuggestion: (suggestion: ClassificationRuleSuggestion) => void
  onDismissSuggestion: () => void
}

const SUGGESTIONS_PAGE_SIZE = 20

function suggestionEvidenceCount(suggestion: ReceiptRuleSuggestion): number {
  const evidence = (suggestion.evidence ?? {}) as Record<string, unknown>
  const count = evidence.transaction_count
  if (typeof count === 'number') return count
  return Array.isArray(suggestion.evidence_transaction_ids) ? suggestion.evidence_transaction_ids.length : 0
}

function suggestionAiConfidence(suggestion: ReceiptRuleSuggestion): number | null {
  const evidence = (suggestion.evidence ?? {}) as Record<string, unknown>
  return typeof evidence.ai_confidence === 'number' ? evidence.ai_confidence : null
}

function suggestionPreviewCount(suggestion: ReceiptRuleSuggestion): number | null {
  const evidence = (suggestion.evidence ?? {}) as Record<string, unknown>
  return typeof evidence.preview_match_count === 'number' ? evidence.preview_match_count : null
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options
const ruleKindOptions = receiptRuleKindSchema.options
const statusLabels: Record<ReceiptTransaction['status'], string> = {
  pending: 'Pending',
  completed: 'Completed',
  auto_completed: 'Auto completed',
  no_receipt_required: 'No receipt required',
  cant_find: "Can't find",
}

const kindLabels: Record<ReceiptRule['kind'], string> = {
  standard: 'Standard',
  payroll: 'Payroll',
  tax: 'Tax',
  income_settlement: 'Income settlement',
  utility: 'Utility',
  bank_fee: 'Bank fee',
  receipt_not_required: 'Receipt not required',
}

function formatRuleKind(kind: ReceiptRule['kind'] | null | undefined): string {
  return kind ? kindLabels[kind] ?? kind : 'Standard'
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

export function ReceiptRules({
  rules,
  ruleConflicts,
  ruleSuggestions,
  suggestionsTotal,
  canGovernRules,
  pendingSuggestion,
  onApplySuggestion,
  onDismissSuggestion,
}: ReceiptRulesProps) {
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

  // Suggestions: server count + paging. Seed the loaded page from props; fetch more pages
  // via getReceiptRuleSuggestionsPage. The selection drives the bulk "Approve selected".
  const [suggestions, setSuggestions] = useState<ReceiptRuleSuggestion[]>(ruleSuggestions)
  const [suggestionPage, setSuggestionPage] = useState(1)
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([])
  const [isSuggestionsPending, startSuggestionsTransition] = useTransition()
  const [isBulkApproving, startBulkApproveTransition] = useTransition()
  const totalSuggestionPages = Math.max(1, Math.ceil(suggestionsTotal / SUGGESTIONS_PAGE_SIZE))

  useEffect(() => {
    if (pendingSuggestion) {
      setIsSectionOpen(true)
    }
  }, [pendingSuggestion])

  // Keep the loaded suggestions in sync when the server re-supplies the first page
  // (e.g. after router.refresh()), and reset paging/selection.
  useEffect(() => {
    setSuggestions(ruleSuggestions)
    setSuggestionPage(1)
    setSelectedSuggestionIds([])
  }, [ruleSuggestions])

  const allSuggestionsSelected = suggestions.length > 0 && selectedSuggestionIds.length === suggestions.length

  function toggleSuggestionSelected(id: string) {
    setSelectedSuggestionIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    )
  }

  function toggleSelectAllSuggestions() {
    setSelectedSuggestionIds((current) => (current.length === suggestions.length ? [] : suggestions.map((s) => s.id)))
  }

  function loadSuggestionsPage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalSuggestionPages) return
    startSuggestionsTransition(async () => {
      const result = await getReceiptRuleSuggestionsPage(nextPage, SUGGESTIONS_PAGE_SIZE)
      if (result.error) {
        toast.error(result.error)
        return
      }
      setSuggestions(result.suggestions)
      setSuggestionPage(nextPage)
      setSelectedSuggestionIds([])
    })
  }

  const filteredRules = useMemo(() => {
    const trimmedQuery = ruleSearch.trim().toLowerCase()
    if (!trimmedQuery) return rules

    const tokens = trimmedQuery.split(/\s+/).filter(Boolean)
    return rules.filter((rule) => {
      const haystack = [
        rule.name,
        rule.description,
        String(rule.priority ?? 1000),
        formatRuleKind(rule.kind),
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
  const conflictsByRule = useMemo(() => {
    const map = new Map<string, ReceiptRuleConflict[]>()
    ruleConflicts.forEach((conflict) => {
      const left = map.get(conflict.rule_id) ?? []
      left.push(conflict)
      map.set(conflict.rule_id, left)

      const right = map.get(conflict.overlapping_rule_id) ?? []
      right.push(conflict)
      map.set(conflict.overlapping_rule_id, right)
    })
    return map
  }, [ruleConflicts])

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

    // Suggestions are description-only now — never prefill a bank transaction type.
    const matchTypeInput = getInput<HTMLInputElement>('match_transaction_type')
    if (matchTypeInput) matchTypeInput.value = ''

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
    if (!confirm('Deactivate this rule?')) return
    setActiveRuleId(ruleId)
    startRuleTransition(async () => {
      const result = await deleteReceiptRule(ruleId)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success('Rule deactivated')
      router.refresh()
      setActiveRuleId(null)
    })
  }

  async function handleApproveSuggestion(suggestionId: string, active = true) {
    if (!canGovernRules) return
    setActiveRuleId(suggestionId)
    startRuleTransition(async () => {
      const result = await approveReceiptRuleSuggestion(suggestionId, { active })
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success(active ? 'Suggested rule approved' : 'Suggested rule approved as disabled')
      router.refresh()
      setActiveRuleId(null)
    })
  }

  function handleApproveSelected(active = true) {
    if (!canGovernRules || selectedSuggestionIds.length === 0) return
    const ids = [...selectedSuggestionIds]
    startBulkApproveTransition(async () => {
      const result = await approveReceiptRuleSuggestions(ids, { active })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      const approved = result.approved ?? 0
      const failed = result.failed ?? 0
      if (failed > 0) {
        toast.error(`Approved ${approved} suggestion${approved === 1 ? '' : 's'}, ${failed} failed`)
      } else {
        toast.success(`Approved ${approved} suggestion${approved === 1 ? '' : 's'}`)
      }
      setSelectedSuggestionIds([])
      router.refresh()
    })
  }

  async function handleDeclineSuggestion(suggestionId: string) {
    if (!canGovernRules) return
    setActiveRuleId(suggestionId)
    startRuleTransition(async () => {
      const result = await declineReceiptRuleSuggestion(suggestionId)
      if (result?.error) {
        toast.error(result.error)
        setActiveRuleId(null)
        return
      }
      toast.success('Suggested rule declined')
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
    <Card className="hidden md:block">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Automation rules</h2>
            {pendingSuggestion && <Badge tone="success">Suggestion</Badge>}
            {suggestionsTotal > 0 && <Badge tone="success">{suggestionsTotal} pending suggestions</Badge>}
            {ruleConflicts.length > 0 && <Badge tone="warning">{ruleConflicts.length} conflicts</Badge>}
          </div>
          <p className="text-sm text-gray-500">Automatically tick off known transactions (e.g. card settlements).</p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge tone="neutral">{rules.length} rules</Badge>
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
              <Card>
                <h3 className="text-md font-semibold text-gray-900 mb-3">New rule</h3>
                {pendingSuggestion && (
                  <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-emerald-800">
                        Suggestion ready for {pendingSuggestion.setVendorName ?? pendingSuggestion.setExpenseCategory}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => applySuggestion(pendingSuggestion)}
                        >
                          Apply
                        </Button>
                        <Button size="sm" variant="ghost" onClick={onDismissSuggestion}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1">Prefill the form to auto-tag similar transactions next time.</p>
                  </div>
                )}
                {suggestionsTotal > 0 && (
                  <div className="mb-3 space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">System suggestions ({suggestionsTotal})</p>
                      {canGovernRules && suggestions.length > 0 && (
                        <label className="flex items-center gap-1.5 text-amber-900">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-amber-300"
                            checked={allSuggestionsSelected}
                            onChange={toggleSelectAllSuggestions}
                            disabled={isSuggestionsPending}
                            aria-label="Select all suggestions on this page"
                          />
                          Select all on page
                        </label>
                      )}
                    </div>

                    {canGovernRules && selectedSuggestionIds.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-100 px-2 py-1.5">
                        <span className="font-medium text-amber-900">{selectedSuggestionIds.length} selected</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isBulkApproving}
                          onClick={() => handleApproveSelected(true)}
                        >
                          {isBulkApproving && <Spinner className="mr-2 h-3 w-3" />}Approve selected
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBulkApproving}
                          onClick={() => handleApproveSelected(false)}
                        >
                          Approve selected as disabled
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={isBulkApproving}
                          onClick={() => setSelectedSuggestionIds([])}
                        >
                          Clear
                        </Button>
                      </div>
                    )}

                    {suggestions.map((suggestion) => {
                      const evidenceCount = suggestionEvidenceCount(suggestion)
                      const aiConfidence = suggestionAiConfidence(suggestion)
                      const previewCount = suggestionPreviewCount(suggestion)
                      return (
                        <div key={suggestion.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-amber-200 pt-2 first:border-t-0 first:pt-0">
                          <div className="flex min-w-0 items-start gap-2">
                            {canGovernRules && (
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 rounded border-amber-300"
                                checked={selectedSuggestionIds.includes(suggestion.id)}
                                onChange={() => toggleSuggestionSelected(suggestion.id)}
                                aria-label={`Select suggestion ${suggestion.suggested_name}`}
                              />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-amber-900">{suggestion.suggested_name}</p>
                              <p>
                                Match {suggestion.match_description ?? 'rule evidence'}; set {suggestion.set_vendor_name ?? suggestion.set_expense_category ?? 'classification'}.
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <Badge tone="neutral">{evidenceCount} evidence</Badge>
                                {aiConfidence != null && <Badge tone="info">AI {aiConfidence}%</Badge>}
                                {previewCount != null && (
                                  <Badge tone="warning">would match {previewCount} transaction{previewCount === 1 ? '' : 's'}</Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!canGovernRules || (isRulePending && activeRuleId === suggestion.id)}
                              onClick={() => handleApproveSuggestion(suggestion.id, true)}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canGovernRules || (isRulePending && activeRuleId === suggestion.id)}
                              onClick={() => handleApproveSuggestion(suggestion.id, false)}
                            >
                              Approve disabled
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canGovernRules || (isRulePending && activeRuleId === suggestion.id)}
                              onClick={() => handleDeclineSuggestion(suggestion.id)}
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      )
                    })}

                    {totalSuggestionPages > 1 && (
                      <div className="flex items-center justify-between gap-2 border-t border-amber-200 pt-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={suggestionPage <= 1 || isSuggestionsPending}
                          onClick={() => loadSuggestionsPage(suggestionPage - 1)}
                        >
                          Previous
                        </Button>
                        <span className="text-amber-900">
                          {isSuggestionsPending ? 'Loading…' : `Page ${suggestionPage} of ${totalSuggestionPages}`}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={suggestionPage >= totalSuggestionPages || isSuggestionsPending}
                          onClick={() => loadSuggestionsPage(suggestionPage + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    )}

                    {!canGovernRules && (
                      <p>Super admin approval is required before a suggestion can become a rule.</p>
                    )}
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
                        options={[
                          { value: 'pending', label: 'Pending only' },
                          { value: 'all', label: 'All historical' },
                        ]}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRetroRun(retroPrompt.id, retroScope)}
                        disabled={isRetroPending}
                      >
                        {isRetroPending && <Spinner className="mr-2 h-3 w-3" />}Run now
                      </Button>
                      <Button
                        size="sm"
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
                  {canGovernRules && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Input name="priority" placeholder="Priority" type="number" min={0} step={1} defaultValue={1000} />
                        <Select name="kind" defaultValue="standard" options={ruleKindOptions.map((option) => ({
                          value: option,
                          label: kindLabels[option],
                        }))} />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input type="checkbox" name="reviewed" className="h-4 w-4 rounded border-gray-300" />
                        Mark reviewed
                      </label>
                    </div>
                  )}
                  <div>
                    <Input
                      name="match_description"
                      placeholder="Match description (comma separated keywords)"
                      value={newMatchDescription}
                      onChange={(e) => { setNewMatchDescription(e.target.value); setIsPreviewVisible(false) }}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Matches transactions if ANY of these words appear in the description (comma-separated)
                    </p>
                    <MatchDescriptionTokenPreview value={newMatchDescription} />
                  </div>
                  <Input name="match_transaction_type" placeholder="Match transaction type" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="match_min_amount" placeholder="Min amount" type="number" step="0.01" />
                    <Input name="match_max_amount" placeholder="Max amount" type="number" step="0.01" />
                  </div>
                  <Select name="match_direction" defaultValue="both" options={[
                    { value: 'both', label: 'Any direction' },
                    { value: 'out', label: 'Money out' },
                    { value: 'in', label: 'Money in' },
                  ]} />
                  <Select name="auto_status" defaultValue="no_receipt_required" options={[
                    { value: 'no_receipt_required', label: 'Mark as not required' },
                    { value: 'auto_completed', label: 'Mark as auto completed' },
                    { value: 'completed', label: 'Mark as completed' },
                    { value: 'pending', label: 'Leave pending' },
                  ]} />
                  <Input name="set_vendor_name" placeholder="Set vendor name (optional)" />
                  <Select name="set_expense_category" defaultValue="" options={[
                    { value: '', label: 'Leave expense unset' },
                    ...expenseCategoryOptions.map((option) => ({ value: option, label: option })),
                  ]} />
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
                  onChange={setRuleSearch}
                  placeholder="Search rules..."
                />

                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-gray-500">
                    {ruleSearch.trim()
                      ? <>Showing {filteredRules.length} of {rules.length} rules</>
                      : <>{rules.length} rules</>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={collapseAllVisibleRules}
                      disabled={expandedVisibleRuleCount === 0}
                    >
                      Collapse all
                    </Button>
                    <Button
                      size="sm"
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
                          {conflictsByRule.get(rule.id)?.length ? (
                            <Badge tone="warning">Conflict</Badge>
                          ) : null}
                          <Badge tone={rule.is_active ? 'success' : 'neutral'}>
                            {rule.is_active ? 'Active' : 'Disabled'}
                          </Badge>
                          <Badge tone="neutral">
                            P{rule.priority ?? 1000}
                          </Badge>
                          <Badge tone="info">
                            {formatRuleKind(rule.kind)}
                          </Badge>
                          <Badge tone="neutral">
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
                                  className="w-40"
                                  options={[
                                    { value: 'pending', label: 'Pending only' },
                                    { value: 'all', label: 'All historical' },
                                  ]}
                                />
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
                              variant={rule.is_active ? 'primary' : 'ghost'}
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
                              Deactivate
                            </Button>
                          </div>

                          {editingRuleId === rule.id ? (
                            <form onSubmit={(event) => handleRuleSubmit(event, rule.id)} className="space-y-3">
                              <Input name="name" defaultValue={rule.name} required />
                              {canGovernRules && (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input name="priority" type="number" min={0} step={1} defaultValue={rule.priority ?? 1000} />
                                    <Select name="kind" defaultValue={rule.kind ?? 'standard'} options={ruleKindOptions.map((option) => ({
                                      value: option,
                                      label: kindLabels[option],
                                    }))} />
                                  </div>
                                  <label className="flex items-center gap-2 text-xs text-gray-600">
                                    <input type="checkbox" name="reviewed" className="h-4 w-4 rounded border-gray-300" defaultChecked={Boolean(rule.reviewed_at)} />
                                    Mark reviewed
                                  </label>
                                </div>
                              )}
                              <Input name="match_description" defaultValue={rule.match_description ?? ''} />
                              <Input name="match_transaction_type" defaultValue={rule.match_transaction_type ?? ''} />
                              <div className="grid grid-cols-2 gap-2">
                                <Input name="match_min_amount" type="number" step="0.01" defaultValue={rule.match_min_amount ?? ''} />
                                <Input name="match_max_amount" type="number" step="0.01" defaultValue={rule.match_max_amount ?? ''} />
                              </div>
                              <Select name="match_direction" defaultValue={rule.match_direction} options={[
                                { value: 'both', label: 'Any direction' },
                                { value: 'out', label: 'Money out' },
                                { value: 'in', label: 'Money in' },
                              ]} />
                              <Select name="auto_status" defaultValue={rule.auto_status} options={[
                                { value: 'no_receipt_required', label: 'Mark as not required' },
                                { value: 'auto_completed', label: 'Mark as auto completed' },
                                { value: 'completed', label: 'Mark as completed' },
                                { value: 'pending', label: 'Leave pending' },
                              ]} />
                              <Input name="set_vendor_name" defaultValue={rule.set_vendor_name ?? ''} placeholder="Set vendor name (optional)" />
                              <Select name="set_expense_category" defaultValue={rule.set_expense_category ?? ''} options={[
                                { value: '', label: 'Leave expense unset' },
                                ...expenseCategoryOptions.map((option) => ({ value: option, label: option })),
                              ]} />
                              <Button type="submit" disabled={isRulePending && activeRuleId === rule.id}>
                                {isRulePending && activeRuleId === rule.id && <Spinner className="mr-2 h-4 w-4" />}Save changes
                              </Button>
                            </form>
                          ) : (
                            <div className="space-y-1 text-xs text-gray-500">
                              <p>Priority: {rule.priority ?? 1000}</p>
                              <p>Kind: {formatRuleKind(rule.kind)}</p>
                              <p>Direction: {rule.match_direction}</p>
                              {rule.match_min_amount != null && <p>Min amount: £{rule.match_min_amount.toFixed(2)}</p>}
                              {rule.match_max_amount != null && <p>Max amount: £{rule.match_max_amount.toFixed(2)}</p>}
                              <p>Outcome: {statusLabels[rule.auto_status]}</p>
                              {rule.set_vendor_name && <p>Sets vendor: {rule.set_vendor_name}</p>}
                              {rule.set_expense_category && <p>Sets expense: {rule.set_expense_category}</p>}
                              {conflictsByRule.get(rule.id)?.map((conflict) => (
                                <p key={conflict.id} className="text-amber-700">
                                  Conflict warning: overlaps {conflict.overlap_count} sampled transaction{conflict.overlap_count === 1 ? '' : 's'}.
                                </p>
                              ))}
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
