'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/ds'
import {
  applyReceiptRuleRunStep,
  previewReceiptRuleRun,
  undoReceiptRuleRunStep,
} from '@/app/actions/receipt-rules'
import type { RuleRunPreview } from '@/services/receipts/receiptRuleRuns'

/** A run is applied 200 changes at a time; this is far more steps than any run needs. */
const MAX_STEPS = 500

type RetroOptions = {
  ruleId: string
  scope: 'pending' | 'all'
}

type RetroRunnerReturn = {
  /**
   * Works out exactly what a run would change and stores it. Nothing is changed. Null when it
   * could not be worked out (the reason is shown).
   */
  previewRetro: (options: RetroOptions) => Promise<RuleRunPreview | null>
  /** Applies a stored preview. Only what the preview showed is written. */
  runRetro: (preview: RuleRunPreview & { runId: string }, ruleId: string) => void
  /** Puts back what a run changed. */
  undoRun: (runId: string, onDone?: () => void) => void
  isRunning: boolean
  isPreviewing: boolean
  isUndoing: boolean
  activeRuleId: string | null
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function useRetroRuleRunner(): RetroRunnerReturn {
  const router = useRouter()
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isRetroPending, startRetroTransition] = useTransition()
  const [isUndoPending, startUndoTransition] = useTransition()

  async function previewRetro(options: RetroOptions): Promise<RuleRunPreview | null> {
    setActiveRuleId(options.ruleId)
    setIsPreviewing(true)
    try {
      const result = await previewReceiptRuleRun(options)
      if (!result.success) {
        toast.error(result.error ?? 'Could not work out what the rule would change. Please try again.')
        return null
      }
      return result
    } catch (error) {
      console.error('Failed to preview receipt rule run', error)
      toast.error('Could not work out what the rule would change. Please try again.')
      return null
    } finally {
      setIsPreviewing(false)
      setActiveRuleId(null)
    }
  }

  function runRetro(preview: RuleRunPreview & { runId: string }, ruleId: string) {
    setActiveRuleId(ruleId)
    startRetroTransition(async () => {
      try {
        let steps = 0
        while (steps < MAX_STEPS) {
          const step = await applyReceiptRuleRunStep(preview.runId)
          steps += 1

          if (!step.success) {
            // One message: the server's reason. What was applied before it stopped is recorded.
            toast.error(step.error)
            router.refresh()
            return
          }

          if (step.done) {
            const parts = [`${plural(step.appliedTotal, 'transaction', 'transactions')} updated`]
            if (step.skippedChangedTotal > 0) {
              parts.push(`${step.skippedChangedTotal} changed since the preview and were left alone`)
            }
            if (step.skippedLockedTotal > 0) {
              parts.push(`${step.skippedLockedTotal} are locked and were left alone`)
            }
            if (step.skippedChangedTotal > 0 || step.skippedLockedTotal > 0) {
              toast.warning(parts.join(' · '))
            } else {
              toast.success(parts.join(' · '))
            }
            router.refresh()
            return
          }

          // Each unfinished step must write or skip something, or the loop would never end.
          if (step.applied + step.skippedChanged + step.skippedLocked === 0) break
        }

        toast.error('The run stopped before it finished. What it changed is recorded and can be undone.')
        router.refresh()
      } catch (error) {
        console.error('Failed to run receipt rule', error)
        toast.error('The run did not finish. What it changed is recorded and can be undone.')
        router.refresh()
      } finally {
        setActiveRuleId(null)
      }
    })
  }

  function undoRun(runId: string, onDone?: () => void) {
    startUndoTransition(async () => {
      try {
        let steps = 0
        while (steps < MAX_STEPS) {
          const step = await undoReceiptRuleRunStep(runId)
          steps += 1

          if (!step.success) {
            toast.error(step.error)
            router.refresh()
            return
          }

          if (step.done) {
            const restored = `${plural(step.restoredTotal, 'transaction', 'transactions')} put back`
            if (step.conflictTotal > 0) {
              toast.warning(`${restored} · ${step.conflictTotal} had been changed since and were left as they are`)
            } else {
              toast.success(restored)
            }
            onDone?.()
            router.refresh()
            return
          }

          if (step.restored + step.conflicts === 0) break
        }

        toast.error('The undo stopped before it finished. Run it again to continue.')
        router.refresh()
      } catch (error) {
        console.error('Failed to undo receipt rule run', error)
        toast.error('The undo did not finish. Run it again to continue.')
        router.refresh()
      }
    })
  }

  return {
    previewRetro,
    runRetro,
    undoRun,
    isRunning: isRetroPending,
    isPreviewing,
    isUndoing: isUndoPending,
    activeRuleId,
  }
}
