'use client'

import { useEffect, useMemo, useState, useTransition, FormEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Empty,
  FormFooter,
  Input,
  SearchInput,
  Select,
  TablePagination,
  toast,
} from '@/ds'
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
import { useRetroRuleRunner, type RetroTotals } from '@/hooks/useRetroRuleRunner'
import { usePermissions } from '@/contexts/PermissionContext'
import type { ReceiptRule, ReceiptRuleConflict, ReceiptRuleSuggestion } from '@/types/database'
import { RECEIPT_RULE_STATE_TONE, RECEIPT_STATUS_LABEL } from '@/app/(authenticated)/receipts/_shared/status-ui'
import { NewVendorDialog, type VendorConfirmationPrompt } from './NewVendorDialog'

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
const statusLabels = RECEIPT_STATUS_LABEL

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
        <Badge key={index} tone="info">
          {token}
        </Badge>
      ))}
      {hasEmpty && (
        <Badge tone="danger">
          empty token: remove double commas
        </Badge>
      )}
    </div>
  )
}

function RulePreviewPanel({ preview }: { preview: RulePreviewResult }) {
  return (
    <Alert tone="info" size="sm" role="status" title="Rule preview (every transaction)">
      <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span>Total matching</span><span className="font-medium">{preview.totalMatching}</span>
        <span>Pending matching</span><span className="font-medium">{preview.pendingMatching}</span>
        <span>Would change status</span><span className="font-medium">{preview.wouldChangeStatus}</span>
        <span>Would change vendor</span><span className="font-medium">{preview.wouldChangeVendor}</span>
        <span>Would change expense</span><span className="font-medium">{preview.wouldChangeExpense}</span>
      </div>
      {preview.overlappingRules.length > 0 && (
        <div>
          <p className="font-medium text-warning-fg">Overlapping rules:</p>
          {preview.overlappingRules.map((r) => (
            <p key={r.id} className="text-warning-fg">
              {r.name}: {r.overlapCount} overlap{r.overlapCount !== 1 ? 's' : ''}
            </p>
          ))}
        </div>
      )}
      </div>
    </Alert>
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
  const {
    previewRetro,
    runRetro,
    isRunning: isRetroRunning,
    isPreviewing: isRetroPreviewing,
    activeRuleId: retroRuleId,
  } = useRetroRuleRunner()
  // Busy from the first click: working out what would change, then changing it.
  const isRetroPending = isRetroRunning || isRetroPreviewing

  const [isSectionOpen, setIsSectionOpen] = useState(false)
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [isRulePending, startRuleTransition] = useTransition()
  const [isPreviewPending, startPreviewTransition] = useTransition()
  const [retroPrompt, setRetroPrompt] = useState<{ id: string; name: string } | null>(null)
  const [retroScope, setRetroScope] = useState<'pending' | 'all'>('pending')
  const [retroConfirmRuleId, setRetroConfirmRuleId] = useState<string | null>(null)
  const [retroConfirmScope, setRetroConfirmScope] = useState<'pending' | 'all'>('pending')
  // A run that has been worked out and is waiting for a yes. Nothing is written until then.
  const [retroRun, setRetroRun] = useState<{
    ruleId: string
    ruleName: string
    scope: 'pending' | 'all'
    totals: RetroTotals
  } | null>(null)
  // Reaching closed transactions is a super-admin decision; the server refuses it otherwise.
  const retroScopeOptions = canGovernRules
    ? [
        { value: 'pending', label: 'Pending only' },
        { value: 'all', label: 'All historical' },
      ]
    : [{ value: 'pending', label: 'Pending only' }]
  const [ruleSearch, setRuleSearch] = useState('')
  const [expandedRuleKeys, setExpandedRuleKeys] = useState<string[]>([])
  const [newMatchDescription, setNewMatchDescription] = useState('')
  const [editMatchDescription, setEditMatchDescription] = useState('')
  const [rulePreview, setRulePreview] = useState<RulePreviewResult | null>(null)
  const [isPreviewVisible, setIsPreviewVisible] = useState(false)
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null)
  const newRuleFormRef = useRef<HTMLFormElement | null>(null)
  // Controlled, so clearing the form after a rule is created clears the tick too: the DS
  // Checkbox draws its own tick, which a native form reset does not reach.
  const [newRuleReviewed, setNewRuleReviewed] = useState(false)

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

    // Suggestions are description-only now: never prefill a bank transaction type.
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
  
  // Works out what the run would change, then asks. The run itself starts from the dialog.
  async function handleRetroRun(ruleId: string, scope: 'pending' | 'all') {
    if (!canManageReceipts) {
      toast.error('You do not have permission to manage receipts.')
      return
    }
    const ruleName = rules.find((rule) => rule.id === ruleId)?.name ?? retroPrompt?.name ?? 'this rule'
    const safeScope = canGovernRules ? scope : 'pending'
    setRetroPrompt(null)
    setRetroScope('pending')
    const totals = await previewRetro({ ruleId, scope: safeScope })
    if (!totals) return
    if (totals.statusAutoUpdated + totals.classificationUpdated === 0) {
      toast.success(
        totals.protectedCount > 0
          ? `Nothing to change. ${totals.protectedCount} matching transactions were set by a person and stay as they are.`
          : 'Nothing to change. Every matching transaction is already as this rule would set it.'
      )
      return
    }
    setRetroRun({ ruleId, ruleName, scope: safeScope, totals })
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
      if (result?.warning) {
        toast.error(result.warning)
      } else {
        toast.success(`Rule ${rule.is_active ? 'disabled' : 'enabled'}`)
      }
      router.refresh()
      setActiveRuleId(null)
    })
  }

  async function handleRuleDelete(ruleId: string) {
    if (!canManageReceipts) return
    setDeleteRuleId(null)
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
      if (result && 'warning' in result && result.warning) {
        toast.error(result.warning)
      } else {
        toast.success(active ? 'Suggested rule approved' : 'Suggested rule approved as disabled')
      }
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
      } else if (result.warning) {
        toast.error(result.warning)
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

  // A rule form waiting on the new-vendor question, kept so it can be sent again with the answer.
  const [ruleVendorPrompt, setRuleVendorPrompt] = useState<{
    formElement: HTMLFormElement
    formData: FormData
    ruleId?: string
    confirmation: VendorConfirmationPrompt
  } | null>(null)

  async function handleRuleSubmit(event: FormEvent<HTMLFormElement>, ruleId?: string) {
    event.preventDefault()
    if (!canManageReceipts) return

    const formElement = event.currentTarget
    submitRuleForm(formElement, new FormData(formElement), ruleId)
  }

  // Also called by the new-vendor dialog, with the vendor swapped for an existing one or with
  // `create_vendor` set once the person has confirmed the name is a new vendor.
  function submitRuleForm(formElement: HTMLFormElement, formData: FormData, ruleId?: string) {
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
      // The rule names a vendor that is not on the list. Nothing was saved: ask first.
      if ('vendorConfirmation' in result) {
        setRuleVendorPrompt({ formElement, formData, ruleId, confirmation: result.vendorConfirmation })
        setActiveRuleId(null)
        return
      }
      setRuleVendorPrompt(null)
      const savedVendorName = formData.get('set_vendor_name')
      const vendorInput = formElement.elements.namedItem('set_vendor_name')
      if (typeof savedVendorName === 'string' && vendorInput instanceof HTMLInputElement) {
        vendorInput.value = result.rule.set_vendor_name ?? savedVendorName
      }
      toast.success(`Rule ${ruleId ? 'updated' : 'created'}`)
      const createdRule = result.rule
      if (result.canPromptRetro && createdRule) {
        setRetroPrompt({ id: createdRule.id, name: createdRule.name })
        setRetroScope('pending')
      }
      setEditingRuleId(null)
      if (!ruleId) {
        formElement.reset()
        setNewRuleReviewed(false)
      }
      router.refresh()
      setActiveRuleId(null)
    })
  }

  const pendingBusy = (id: string) => isRulePending && activeRuleId === id

  return (
    <Card className="hidden md:block">
      <CardHeader
        title="Automation Rules"
        subtitle="Automatically tick off known transactions (e.g. card settlements)"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {pendingSuggestion && <Badge tone="success">Suggestion</Badge>}
            {suggestionsTotal > 0 && <Badge tone="success">{suggestionsTotal} pending suggestions</Badge>}
            {ruleConflicts.length > 0 && <Badge tone="warning">{ruleConflicts.length} conflicts</Badge>}
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
        }
      />

      {isSectionOpen && (
        <CardBody>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="New Rule" />
              <CardBody className="space-y-4">
                {pendingSuggestion && (
                  <Alert
                    tone="success"
                    size="sm"
                    role="status"
                    title={`Suggestion ready for ${pendingSuggestion.setVendorName ?? pendingSuggestion.setExpenseCategory}`}
                  >
                    <p>Prefill the form to auto-tag similar transactions next time.</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={onDismissSuggestion}>
                        Dismiss
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => applySuggestion(pendingSuggestion)}>
                        Apply
                      </Button>
                    </div>
                  </Alert>
                )}
                {suggestionsTotal > 0 && (
                  <Alert tone="warning" size="sm" role="status" title={`System suggestions (${suggestionsTotal})`}>
                    <div className="space-y-2">
                      {canGovernRules && suggestions.length > 0 && (
                        <Checkbox
                          label="Select all on page"
                          checked={allSuggestionsSelected}
                          onChange={toggleSelectAllSuggestions}
                          disabled={isSuggestionsPending}
                        />
                      )}

                      {canGovernRules && selectedSuggestionIds.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{selectedSuggestionIds.length} selected</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isBulkApproving}
                            onClick={() => setSelectedSuggestionIds([])}
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isBulkApproving}
                            onClick={() => handleApproveSelected(false)}
                          >
                            Approve Selected as Disabled
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={isBulkApproving}
                            onClick={() => handleApproveSelected(true)}
                          >
                            Approve Selected
                          </Button>
                        </div>
                      )}

                      {suggestions.map((suggestion) => {
                        const evidenceCount = suggestionEvidenceCount(suggestion)
                        const aiConfidence = suggestionAiConfidence(suggestion)
                        const previewCount = suggestionPreviewCount(suggestion)
                        const busy = !canGovernRules || pendingBusy(suggestion.id)
                        return (
                          <div key={suggestion.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-warning-border pt-2 first:border-t-0 first:pt-0">
                            <div className="flex min-w-0 items-start gap-2">
                              {canGovernRules && (
                                <Checkbox
                                  checked={selectedSuggestionIds.includes(suggestion.id)}
                                  onChange={() => toggleSuggestionSelected(suggestion.id)}
                                  aria-label={`Select suggestion ${suggestion.suggested_name}`}
                                />
                              )}
                              <div className="min-w-0">
                                <p className="font-medium">{suggestion.suggested_name}</p>
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
                                variant="ghost"
                                disabled={busy}
                                onClick={() => handleDeclineSuggestion(suggestion.id)}
                              >
                                Decline
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => handleApproveSuggestion(suggestion.id, false)}
                              >
                                Approve Disabled
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => handleApproveSuggestion(suggestion.id, true)}
                              >
                                Approve
                              </Button>
                            </div>
                          </div>
                        )
                      })}

                      {totalSuggestionPages > 1 && (
                        <TablePagination
                          page={suggestionPage}
                          totalPages={totalSuggestionPages}
                          pageSize={SUGGESTIONS_PAGE_SIZE}
                          totalItems={suggestionsTotal}
                          onPageChange={(nextPage) => {
                            if (!isSuggestionsPending) loadSuggestionsPage(nextPage)
                          }}
                          className="px-0"
                        />
                      )}

                      {!canGovernRules && (
                        <p>Super admin approval is required before a suggestion can become a rule.</p>
                      )}
                    </div>
                  </Alert>
                )}
                {retroPrompt && (
                  <Alert
                    tone="info"
                    size="sm"
                    role="status"
                    title={`Run rule \u201c${retroPrompt.name}\u201d on ${retroScope === 'all' ? 'all transactions' : 'pending transactions'}?`}
                  >
                    <p>
                      Pending transactions get the rule in full. Closed transactions keep their status:
                      the rule only fills in or refreshes their vendor and category, and anything set by
                      hand is left alone. You will see what would change before anything is saved.
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Select
                        aria-label="Which transactions to run the rule on"
                        value={retroScope}
                        onChange={(event) => setRetroScope(event.target.value as 'pending' | 'all')}
                        className="w-44"
                        options={retroScopeOptions}
                      />
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
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleRetroRun(retroPrompt.id, retroScope)}
                        loading={isRetroPending}
                        disabled={isRetroPending}
                      >
                        Check What Changes
                      </Button>
                    </div>
                  </Alert>
                )}
                <form ref={newRuleFormRef} onSubmit={(event) => handleRuleSubmit(event)} className="space-y-4">
                  <Input label="Rule name" name="name" placeholder="Rule name" required />
                  {canGovernRules && (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Input label="Priority" name="priority" placeholder="Priority" type="number" min={0} step={1} defaultValue={1000} />
                        <Select label="Kind" name="kind" defaultValue="standard" options={ruleKindOptions.map((option) => ({
                          value: option,
                          label: kindLabels[option],
                        }))} />
                      </div>
                      <Checkbox
                        name="reviewed"
                        label="Mark reviewed"
                        checked={newRuleReviewed}
                        onChange={setNewRuleReviewed}
                      />
                    </div>
                  )}
                  <div>
                    <Input
                      label="Match description"
                      name="match_description"
                      placeholder="Comma separated keywords"
                      hint="Matches transactions if ANY of these words appear in the description (comma-separated)"
                      value={newMatchDescription}
                      onChange={(e) => { setNewMatchDescription(e.target.value); setIsPreviewVisible(false) }}
                    />
                    <MatchDescriptionTokenPreview value={newMatchDescription} />
                  </div>
                  <Input label="Match transaction type" name="match_transaction_type" placeholder="Match transaction type" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Min amount" name="match_min_amount" placeholder="Min amount" type="number" step="0.01" />
                    <Input label="Max amount" name="match_max_amount" placeholder="Max amount" type="number" step="0.01" />
                  </div>
                  <Select label="Direction" name="match_direction" defaultValue="both" options={[
                    { value: 'both', label: 'Any direction' },
                    { value: 'out', label: 'Money out' },
                    { value: 'in', label: 'Money in' },
                  ]} />
                  <Select label="Outcome" name="auto_status" defaultValue="pending" options={[
                    { value: 'pending', label: 'Leave pending' },
                    { value: 'no_receipt_required', label: 'Mark as not required' },
                    { value: 'auto_completed', label: 'Mark as auto completed' },
                    { value: 'completed', label: 'Mark as completed' },
                  ]} />
                  <Input label="Set vendor name" name="set_vendor_name" placeholder="Set vendor name (optional)" />
                  <Select label="Set expense" name="set_expense_category" defaultValue="" options={[
                    { value: '', label: 'Leave expense unset' },
                    ...expenseCategoryOptions.map((option) => ({ value: option, label: option })),
                  ]} />
                  {isPreviewVisible && rulePreview && (
                    <RulePreviewPanel preview={rulePreview} />
                  )}
                  <FormFooter>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!canManageReceipts}
                      loading={isPreviewPending}
                      onClick={() => handlePreviewRule(newRuleFormRef)}
                    >
                      Preview
                    </Button>
                    <Button type="submit" variant="primary" disabled={!canManageReceipts} loading={pendingBusy('new')}>
                      Create Rule
                    </Button>
                  </FormFooter>
                </form>
              </CardBody>
            </Card>

            <div className="space-y-4">
              <SearchInput
                value={ruleSearch}
                onChange={setRuleSearch}
                placeholder="Search rules..."
                aria-label="Search rules"
              />

              <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-text-muted">
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
                    Collapse All
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={expandAllVisibleRules}
                    disabled={filteredRules.length === 0 || expandedVisibleRuleCount === filteredRules.length}
                  >
                    Expand All
                  </Button>
                </div>
              </div>

              {rules.length === 0 ? (
                <Empty
                  size="sm"
                  title="No automation rules yet"
                  description="Start by adding keywords for things like card settlements."
                />
              ) : filteredRules.length === 0 ? (
                <Empty size="sm" title="No rules match this search" description="Change or clear the search to see more rules." />
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
                        <span className="block truncate text-sm font-semibold text-text-strong">{rule.name}</span>
                        <span className="mt-0.5 block truncate text-xs font-normal text-text-muted">
                          {rule.description ?? `Matches: ${rule.match_description ?? 'any'}`}
                        </span>
                      </>
                    ),
                    extra: (
                      <div className="flex items-center gap-2">
                        {conflictsByRule.get(rule.id)?.length ? (
                          <Badge tone="warning">Conflict</Badge>
                        ) : null}
                        <Badge tone={RECEIPT_RULE_STATE_TONE[rule.is_active ? 'active' : 'disabled']}>
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
                            disabled={pendingBusy(rule.id) || !canManageReceipts}
                          >
                            {editingRuleId === rule.id ? 'Close Editor' : 'Edit'}
                          </Button>
                          {retroConfirmRuleId === rule.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Select
                                aria-label="Which transactions to run the rule on"
                                value={retroConfirmScope}
                                onChange={(e) => setRetroConfirmScope(e.target.value as 'pending' | 'all')}
                                className="w-40"
                                options={retroScopeOptions}
                              />
                              <Button size="sm" variant="ghost" onClick={() => setRetroConfirmRuleId(null)}>Cancel</Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => { setRetroConfirmRuleId(null); handleRetroRun(rule.id, retroConfirmScope) }}
                                loading={isRetroPending && retroRuleId === rule.id}
                                disabled={isRetroPending}
                              >
                                Check What Changes
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setRetroConfirmRuleId(rule.id); setRetroConfirmScope('pending') }}
                              disabled={!rule.is_active || isRetroPending || !canManageReceipts}
                              title={rule.is_active ? 'Run this rule across historical transactions' : 'Enable the rule before running it'}
                            >
                              Run Historical
                            </Button>
                          )}
                          <Button
                            variant={rule.is_active ? 'primary' : 'ghost'}
                            size="sm"
                            onClick={() => handleRuleToggle(rule)}
                            loading={pendingBusy(rule.id)}
                            disabled={!canManageReceipts}
                          >
                            {rule.is_active ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteRuleId(rule.id)}
                            disabled={pendingBusy(rule.id) || !canManageReceipts}
                          >
                            Deactivate
                          </Button>
                        </div>

                        {editingRuleId === rule.id ? (
                          <form onSubmit={(event) => handleRuleSubmit(event, rule.id)} className="space-y-4">
                            <Input label="Rule name" name="name" defaultValue={rule.name} required />
                            {canGovernRules && (
                              <div className="space-y-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <Input label="Priority" name="priority" type="number" min={0} step={1} defaultValue={rule.priority ?? 1000} />
                                  <Select label="Kind" name="kind" defaultValue={rule.kind ?? 'standard'} options={ruleKindOptions.map((option) => ({
                                    value: option,
                                    label: kindLabels[option],
                                  }))} />
                                </div>
                                <Checkbox name="reviewed" label="Mark reviewed" defaultChecked={Boolean(rule.reviewed_at)} />
                              </div>
                            )}
                            <Input label="Match description" name="match_description" defaultValue={rule.match_description ?? ''} />
                            <Input label="Match transaction type" name="match_transaction_type" defaultValue={rule.match_transaction_type ?? ''} />
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Input label="Min amount" name="match_min_amount" type="number" step="0.01" defaultValue={rule.match_min_amount ?? ''} />
                              <Input label="Max amount" name="match_max_amount" type="number" step="0.01" defaultValue={rule.match_max_amount ?? ''} />
                            </div>
                            <Select label="Direction" name="match_direction" defaultValue={rule.match_direction} options={[
                              { value: 'both', label: 'Any direction' },
                              { value: 'out', label: 'Money out' },
                              { value: 'in', label: 'Money in' },
                            ]} />
                            <Select label="Outcome" name="auto_status" defaultValue={rule.auto_status} options={[
                              { value: 'no_receipt_required', label: 'Mark as not required' },
                              { value: 'auto_completed', label: 'Mark as auto completed' },
                              { value: 'completed', label: 'Mark as completed' },
                              { value: 'pending', label: 'Leave pending' },
                            ]} />
                            <Input label="Set vendor name" name="set_vendor_name" defaultValue={rule.set_vendor_name ?? ''} placeholder="Set vendor name (optional)" />
                            <Select label="Set expense" name="set_expense_category" defaultValue={rule.set_expense_category ?? ''} options={[
                              { value: '', label: 'Leave expense unset' },
                              ...expenseCategoryOptions.map((option) => ({ value: option, label: option })),
                            ]} />
                            <FormFooter>
                              <Button type="button" variant="secondary" onClick={() => setEditingRuleId(null)}>
                                Cancel
                              </Button>
                              <Button type="submit" variant="primary" loading={pendingBusy(rule.id)}>
                                Save Changes
                              </Button>
                            </FormFooter>
                          </form>
                        ) : (
                          <div className="space-y-1 text-xs text-text-muted">
                            <p>Priority: {rule.priority ?? 1000}</p>
                            <p>Kind: {formatRuleKind(rule.kind)}</p>
                            <p>Direction: {rule.match_direction}</p>
                            {rule.match_min_amount != null && <p>Min amount: £{rule.match_min_amount.toFixed(2)}</p>}
                            {rule.match_max_amount != null && <p>Max amount: £{rule.match_max_amount.toFixed(2)}</p>}
                            <p>Outcome: {statusLabels[rule.auto_status]}</p>
                            {rule.set_vendor_name && <p>Sets vendor: {rule.set_vendor_name}</p>}
                            {rule.set_expense_category && <p>Sets expense: {rule.set_expense_category}</p>}
                            {conflictsByRule.get(rule.id)?.map((conflict) => (
                              <p key={conflict.id} className="text-warning-fg">
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
        </CardBody>
      )}

      <NewVendorDialog
        prompt={ruleVendorPrompt?.confirmation ?? null}
        pending={isRulePending}
        onUseExisting={(vendorName) => {
          if (!ruleVendorPrompt) return
          const { formElement, formData, ruleId } = ruleVendorPrompt
          formData.set('set_vendor_name', vendorName)
          formData.delete('create_vendor')
          submitRuleForm(formElement, formData, ruleId)
        }}
        onCreate={() => {
          if (!ruleVendorPrompt) return
          const { formElement, formData, ruleId } = ruleVendorPrompt
          formData.set('create_vendor', 'true')
          submitRuleForm(formElement, formData, ruleId)
        }}
        onClose={() => setRuleVendorPrompt(null)}
      />
      <ConfirmDialog
        open={Boolean(deleteRuleId)}
        onClose={() => setDeleteRuleId(null)}
        onConfirm={() => deleteRuleId ? handleRuleDelete(deleteRuleId) : undefined}
        title="Deactivate Rule"
        message="This rule will stop matching new transactions. Transactions it has already classified are left as they are."
        confirmLabel="Deactivate"
        tone="primary"
      />
      <ConfirmDialog
        open={Boolean(retroRun)}
        onClose={() => setRetroRun(null)}
        onConfirm={() => {
          if (!retroRun) return
          const { ruleId, scope } = retroRun
          setRetroRun(null)
          runRetro({ ruleId, scope })
        }}
        title={retroRun ? `Run \u201c${retroRun.ruleName}\u201d` : 'Run rule'}
        message={retroRun ? (
          <div className="space-y-2">
            <p>
              Checked {retroRun.totals.reviewed}{' '}
              {retroRun.scope === 'all' ? 'transactions' : 'pending transactions'}. This rule matches{' '}
              {retroRun.totals.matched} of them and would:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>set the vendor on {retroRun.totals.vendorIntended}</li>
              <li>set the expense category on {retroRun.totals.expenseIntended}</li>
              <li>change the status of {retroRun.totals.statusAutoUpdated} pending transactions</li>
            </ul>
            {retroRun.totals.protectedCount > 0 && (
              <p>
                {retroRun.totals.protectedCount} matching transactions were set by a person, the import
                or invoice matching and will be left as they are.
              </p>
            )}
            {retroRun.scope === 'all' && (
              <p>Closed transactions keep their status. Only their vendor and category can change.</p>
            )}
          </div>
        ) : undefined}
        confirmLabel="Run Rule"
        tone="primary"
      />
    </Card>
  )
}
