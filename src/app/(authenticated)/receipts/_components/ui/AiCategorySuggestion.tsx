'use client'

import { useTransition } from 'react'
import { Button, Icon, toast } from '@/ds'
import { decideReceiptAiCategory } from '@/app/actions/receipt-ai'
import type { ReceiptTransaction } from '@/types/database'
import { suggestionChoiceLabel, type WorkspaceTransaction } from './expenseChoice'

interface AiCategorySuggestionProps {
  transaction: WorkspaceTransaction
  canManage: boolean
  /** The row is busy with something else. */
  disabled?: boolean
  /** The suggestion is closed. `updated` is the payment as it now stands, when it changed. */
  onClosed: (updated?: ReceiptTransaction) => void
  /** Open the category picker, starting on the suggested category. */
  onChange: () => void
}

/**
 * A category the AI has suggested for one payment. Nothing is written to the payment until a
 * person accepts it or picks a different one; dismissing it leaves the payment as it was.
 */
export function AiCategorySuggestion({ transaction, canManage, disabled, onClosed, onChange }: AiCategorySuggestionProps) {
  const [isPending, startTransition] = useTransition()
  const suggestion = transaction.aiSuggestion
  if (!suggestion) return null

  function decide(decision: 'accept' | 'dismiss') {
    if (!canManage) return
    startTransition(async () => {
      const result = await decideReceiptAiCategory({ transactionId: transaction.id, decision })
      if (result.error) {
        toast.error(result.error)
        // Overtaken by a rule or a person: the suggestion is gone, so show the payment as it is.
        if (result.superseded) onClosed(result.transaction)
        return
      }
      onClosed(result.transaction)
      toast.success(decision === 'accept' ? 'Category accepted' : 'Suggestion dismissed')
    })
  }

  const label = suggestionChoiceLabel(suggestion)
  const busy = isPending || Boolean(disabled)

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5">
      <p className="flex items-center gap-1 text-xs text-text-muted" title={suggestion.reasoning ?? undefined}>
        <Icon name="sparkles" size={12} className="shrink-0 text-info" />
        <span>
          Suggested: <span className="font-medium text-text-strong">{label}</span>
        </span>
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-1">
          <Button size="xs" variant="primary" onClick={() => decide('accept')} loading={isPending} disabled={busy}>
            Accept
          </Button>
          <Button size="xs" variant="ghost" onClick={onChange} disabled={busy}>
            Change
          </Button>
          <Button size="xs" variant="ghost" onClick={() => decide('dismiss')} disabled={busy}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  )
}
