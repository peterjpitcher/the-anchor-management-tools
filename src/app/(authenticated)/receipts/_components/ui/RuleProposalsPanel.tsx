'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Badge, Button, Checkbox, TablePagination, toast } from '@/ds'
import {
  approveReceiptRuleSuggestion,
  approveReceiptRuleSuggestions,
  declineReceiptRuleSuggestion,
  getReceiptRuleSuggestionsPage,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import type { ReceiptRuleSuggestion } from '@/types/database'

const PAGE_SIZE = 20

function evidenceOf(suggestion: ReceiptRuleSuggestion): Record<string, unknown> {
  return (suggestion.evidence ?? {}) as Record<string, unknown>
}

function numberFrom(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export type RuleProposalView = {
  /** A new rule, or a category to add to a rule that already names the vendor. */
  kind: 'new_rule' | 'add_category'
  targetRuleName: string | null
  evidenceCount: number
  /** Payments the keyword matches today. Null when it has not been worked out. */
  matchCount: number | null
  /** Of those, payments that belong to a different vendor. */
  collisions: number
  samples: string[]
  /** The figures were worked out when the panel opened, not when the suggestion was raised. */
  checkedLive: boolean
}

/** What a suggestion would do, read from the evidence stored with it. */
export function describeRuleProposal(suggestion: ReceiptRuleSuggestion): RuleProposalView {
  const evidence = evidenceOf(suggestion)
  const samples = Array.isArray(evidence.details_samples)
    ? evidence.details_samples.filter((sample): sample is string => typeof sample === 'string').slice(0, 3)
    : []
  return {
    kind: evidence.kind === 'add_category' ? 'add_category' : 'new_rule',
    targetRuleName: typeof evidence.target_rule_name === 'string' ? evidence.target_rule_name : null,
    evidenceCount:
      numberFrom(evidence.transaction_count) ??
      (Array.isArray(suggestion.evidence_transaction_ids) ? suggestion.evidence_transaction_ids.length : 0),
    matchCount: numberFrom(evidence.preview_match_count),
    collisions: numberFrom(evidence.collision_count) ?? 0,
    samples,
    checkedLive: evidence.checked_live === true,
  }
}

interface RuleProposalsPanelProps {
  /** The first page as the workspace loaded it, with the figures stored when each was raised. */
  initialSuggestions: ReceiptRuleSuggestion[]
  suggestionsTotal: number
  canGovernRules: boolean
  /** Put the suggestion into the new rule form, to be changed before it is saved. */
  onEditFirst: (suggestion: ClassificationRuleSuggestion) => void
}

/**
 * Rules the system suggests, each with what it would match today. A suggestion whose keyword
 * also matches payments belonging to another vendor cannot be approved as it stands: it is
 * edited into a more specific rule first.
 */
export function RuleProposalsPanel({ initialSuggestions, suggestionsTotal, canGovernRules, onEditFirst }: RuleProposalsPanelProps) {
  const router = useRouter()
  const [suggestions, setSuggestions] = useState<ReceiptRuleSuggestion[]>(initialSuggestions)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isActing, startActing] = useTransition()
  const [isBulkApproving, startBulkApproving] = useTransition()
  const totalPages = Math.max(1, Math.ceil(suggestionsTotal / PAGE_SIZE))

  function loadPage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages) return
    startLoading(async () => {
      const result = await getReceiptRuleSuggestionsPage(nextPage, PAGE_SIZE, { liveChecks: true })
      if (result.error) {
        toast.error(result.error)
        return
      }
      setSuggestions(result.suggestions)
      setPage(nextPage)
      setSelectedIds([])
    })
  }

  // The workspace hands over the stored figures. Opening the panel checks every keyword against
  // the payments as they are now, and does so again whenever the workspace reloads the list.
  useEffect(() => {
    setSuggestions(initialSuggestions)
    setPage(1)
    setSelectedIds([])
    if (initialSuggestions.length > 0) loadPage(1)
    // Only a new list from the workspace starts a fresh check; `loadPage` changes every render.
  }, [initialSuggestions])

  if (suggestionsTotal <= 0) return null

  const approvable = suggestions.filter((suggestion) => describeRuleProposal(suggestion).collisions === 0)
  const allSelected = approvable.length > 0 && selectedIds.length === approvable.length

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }

  function approve(suggestionId: string, active: boolean) {
    if (!canGovernRules) return
    setBusyId(suggestionId)
    startActing(async () => {
      const result = await approveReceiptRuleSuggestion(suggestionId, { active })
      setBusyId(null)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      if (result && 'warning' in result && result.warning) {
        toast.error(result.warning)
      } else {
        toast.success(active ? 'Suggested rule approved' : 'Suggested rule approved as disabled')
      }
      router.refresh()
    })
  }

  function approveSelected(active: boolean) {
    if (!canGovernRules || selectedIds.length === 0) return
    const ids = [...selectedIds]
    startBulkApproving(async () => {
      const result = await approveReceiptRuleSuggestions(ids, { active })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      const approved = result.approved ?? 0
      const failed = result.failed ?? 0
      if (failed > 0) {
        toast.error(`Approved ${plural(approved, 'suggestion', 'suggestions')}, ${failed} failed`)
      } else if (result.warning) {
        toast.error(result.warning)
      } else {
        toast.success(`Approved ${plural(approved, 'suggestion', 'suggestions')}`)
      }
      setSelectedIds([])
      router.refresh()
    })
  }

  function decline(suggestionId: string) {
    if (!canGovernRules) return
    setBusyId(suggestionId)
    startActing(async () => {
      const result = await declineReceiptRuleSuggestion(suggestionId)
      setBusyId(null)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      toast.success('Suggested rule declined')
      router.refresh()
    })
  }

  function editFirst(suggestion: ReceiptRuleSuggestion) {
    const category = receiptExpenseCategorySchema.safeParse(suggestion.set_expense_category)
    onEditFirst({
      suggestedName: suggestion.suggested_name,
      matchDescription: suggestion.match_description,
      direction: suggestion.match_direction === 'in' ? 'in' : 'out',
      amountValue: 0,
      details: suggestion.match_description ?? '',
      setVendorName: suggestion.set_vendor_name,
      setExpenseCategory: category.success ? category.data : null,
    })
  }

  return (
    <Alert tone="warning" size="sm" role="status" title={`System suggestions (${suggestionsTotal})`}>
      <div className="space-y-2">
        <p>
          Each suggestion is checked against every transaction when this panel opens.
          {isLoading ? ' Checking now.' : ''}
        </p>

        {canGovernRules && approvable.length > 0 && (
          <Checkbox
            label="Select all that can be approved"
            checked={allSelected}
            onChange={() => setSelectedIds(allSelected ? [] : approvable.map((suggestion) => suggestion.id))}
            disabled={isLoading}
          />
        )}

        {canGovernRules && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{selectedIds.length} selected</span>
            <Button size="sm" variant="ghost" disabled={isBulkApproving} onClick={() => setSelectedIds([])}>
              Clear
            </Button>
            <Button size="sm" variant="ghost" disabled={isBulkApproving} onClick={() => approveSelected(false)}>
              Approve Selected as Disabled
            </Button>
            <Button size="sm" variant="secondary" loading={isBulkApproving} onClick={() => approveSelected(true)}>
              Approve Selected
            </Button>
          </div>
        )}

        {suggestions.map((suggestion) => {
          const view = describeRuleProposal(suggestion)
          const blocked = view.collisions > 0
          const busy = !canGovernRules || isLoading || (isActing && busyId === suggestion.id)
          return (
            <div
              key={suggestion.id}
              className="flex flex-wrap items-start justify-between gap-2 border-t border-warning-border pt-2 first:border-t-0 first:pt-0"
            >
              <div className="flex min-w-0 items-start gap-2">
                {canGovernRules && !blocked && (
                  <Checkbox
                    checked={selectedIds.includes(suggestion.id)}
                    onChange={() => toggleSelected(suggestion.id)}
                    aria-label={`Select suggestion ${suggestion.suggested_name}`}
                  />
                )}
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{suggestion.suggested_name}</p>
                  {view.kind === 'add_category' ? (
                    <p>
                      Add the category {suggestion.set_expense_category} to the rule
                      {view.targetRuleName ? ` "${view.targetRuleName}"` : ''}. Its payments already agree on it.
                    </p>
                  ) : (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                      <dt>Keyword</dt>
                      <dd className="font-medium break-words">{suggestion.match_description ?? 'None'}</dd>
                      <dt>Vendor</dt>
                      <dd className="font-medium break-words">{suggestion.set_vendor_name ?? 'None'}</dd>
                      <dt>Category</dt>
                      <dd className="font-medium break-words">{suggestion.set_expense_category ?? 'None'}</dd>
                    </dl>
                  )}
                  {view.samples.length > 0 && (
                    <ul className="list-disc pl-4 text-text-muted">
                      {view.samples.map((sample) => (
                        <li key={sample} className="break-words">{sample}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="neutral">{plural(view.evidenceCount, 'example', 'examples')}</Badge>
                    {view.matchCount != null && (
                      <Badge tone="info">matches {plural(view.matchCount, 'transaction', 'transactions')}</Badge>
                    )}
                    {blocked && (
                      <Badge tone="danger">
                        {view.collisions} {view.collisions === 1 ? 'belongs' : 'belong'} to another vendor
                      </Badge>
                    )}
                    {!view.checkedLive && !isLoading && view.kind === 'new_rule' && (
                      <Badge tone="neutral">figures from when it was raised</Badge>
                    )}
                  </div>
                  {blocked && (
                    <p className="text-danger-fg">
                      This cannot be approved as it stands. Use Edit first to make the keyword more specific, save it as
                      a new rule, then decline this suggestion.
                    </p>
                  )}
                </div>
              </div>
              {canGovernRules && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => decline(suggestion.id)}>
                    Decline
                  </Button>
                  {view.kind === 'new_rule' && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => editFirst(suggestion)}>
                      Edit first
                    </Button>
                  )}
                  {view.kind === 'new_rule' && (
                    <Button size="sm" variant="ghost" disabled={busy || blocked} onClick={() => approve(suggestion.id, false)}>
                      Approve Disabled
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" disabled={busy || blocked} onClick={() => approve(suggestion.id, true)}>
                    Approve
                  </Button>
                </div>
              )}
            </div>
          )
        })}

        {totalPages > 1 && (
          <TablePagination
            page={page}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            totalItems={suggestionsTotal}
            onPageChange={(nextPage) => {
              if (!isLoading) loadPage(nextPage)
            }}
            className="px-0"
          />
        )}

        {!canGovernRules && <p>Super admin approval is required before a suggestion can become a rule.</p>}
      </div>
    </Alert>
  )
}
