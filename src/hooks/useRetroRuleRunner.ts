'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/ds'
import {
  runReceiptRuleRetroactivelyStep,
  finalizeReceiptRuleRetroRun,
} from '@/app/actions/receipts'

const CHUNK_SIZE = 100
const MAX_ITERATIONS = 300

type RetroOptions = {
  ruleId: string
  scope: 'pending' | 'all'
}

/** What a run did, or in a preview what it would do. */
export type RetroTotals = {
  reviewed: number
  matched: number
  statusAutoUpdated: number
  classificationUpdated: number
  vendorIntended: number
  expenseIntended: number
  /** Matched transactions left alone because a person, the import or invoice pairing decided them. */
  protectedCount: number
  /** Transactions that changed while the run was in flight, so the rule left them alone. */
  conflicts: number
  failed: number
}

type RetroRunnerReturn = {
  /** Works out what a run would change and writes nothing. Null when it could not finish. */
  previewRetro: (options: RetroOptions) => Promise<RetroTotals | null>
  runRetro: (options: RetroOptions) => void
  isRunning: boolean
  isPreviewing: boolean
  activeRuleId: string | null
}

function emptyTotals(): RetroTotals {
  return {
    reviewed: 0,
    matched: 0,
    statusAutoUpdated: 0,
    classificationUpdated: 0,
    vendorIntended: 0,
    expenseIntended: 0,
    protectedCount: 0,
    conflicts: 0,
    failed: 0,
  }
}

type LoopResult = {
  finished: boolean
  totals: RetroTotals
  samples: Array<Record<string, unknown>>
  /** Why the walk stopped early, when the server said. */
  error?: string
}

/**
 * Walks the whole set in steps. Keyset cursor, not an offset: applying a rule moves rows out of
 * the pending set, so an offset would skip the rows that shifted up under it. Null asks for the
 * first chunk.
 */
async function walkRetroRun({ ruleId, scope }: RetroOptions, dryRun: boolean): Promise<LoopResult> {
  let cursor: string | null = null
  let iterations = 0
  let samples: Array<Record<string, unknown>> = []
  const totals = emptyTotals()

  while (iterations < MAX_ITERATIONS) {
    const step = await runReceiptRuleRetroactivelyStep({
      ruleId,
      scope,
      cursor,
      offset: totals.reviewed,
      chunkSize: CHUNK_SIZE,
      dryRun,
    })

    if (!step.success) {
      return { finished: false, totals, samples, error: step.error }
    }

    totals.reviewed += step.reviewed
    totals.matched += step.matched
    totals.statusAutoUpdated += step.statusAutoUpdated
    totals.classificationUpdated += step.classificationUpdated
    totals.vendorIntended += step.vendorIntended
    totals.expenseIntended += step.expenseIntended
    totals.protectedCount += step.protectedCount
    totals.conflicts += step.conflicts
    totals.failed += step.failed

    if (step.samples.length) {
      samples = step.samples
    }

    iterations += 1

    if (step.done) {
      return { finished: true, totals, samples }
    }

    // The cursor must move on every unfinished step, or the next request would read the same
    // chunk again. Stop rather than loop.
    if (!step.nextCursor || step.nextCursor === cursor || step.reviewed === 0) {
      break
    }

    cursor = step.nextCursor
  }

  return { finished: false, totals, samples }
}

export function useRetroRuleRunner(): RetroRunnerReturn {
  const router = useRouter()
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isRetroPending, startRetroTransition] = useTransition()

  async function previewRetro(options: RetroOptions): Promise<RetroTotals | null> {
    setActiveRuleId(options.ruleId)
    setIsPreviewing(true)
    try {
      const result = await walkRetroRun(options, true)
      if (!result.finished) {
        toast.error(result.error ?? 'Could not work out what the rule would change. Please try again.')
        return null
      }
      return result.totals
    } catch (error) {
      console.error('Failed to preview receipt rule run', error)
      toast.error('Could not work out what the rule would change. Please try again.')
      return null
    } finally {
      setIsPreviewing(false)
      setActiveRuleId(null)
    }
  }

  function runRetro(options: RetroOptions) {
    setActiveRuleId(options.ruleId)
    startRetroTransition(async () => {
      try {
        const result = await walkRetroRun(options, false)

        if (!result.finished) {
          // One message, not two: the server's reason when it gave one.
          toast.error(result.error ?? 'Stopped before completion. Please run again to continue.')
          router.refresh()
          return
        }

        await finalizeReceiptRuleRetroRun()

        const { totals } = result
        const scopeLabel = options.scope === 'all' ? 'transactions' : 'pending transactions'
        const parts = [
          `Rule matched ${totals.matched} of ${totals.reviewed} ${scopeLabel}`,
          `${totals.statusAutoUpdated} status updates`,
          `${totals.classificationUpdated} classifications`,
        ]
        if (totals.protectedCount > 0) parts.push(`${totals.protectedCount} left as a person set them`)
        if (totals.conflicts > 0) parts.push(`${totals.conflicts} changed meanwhile and were skipped`)

        if (totals.failed > 0) {
          toast.error(`${parts.join(' · ')} · ${totals.failed} could not be updated`)
        } else {
          toast.success(parts.join(' · '))
        }

        if (result.samples.length) {
          // eslint-disable-next-line no-console
          console.groupCollapsed(`Receipt rule analysis (${result.samples.length} sample transactions)`)
          // eslint-disable-next-line no-console
          console.table(result.samples)
          // eslint-disable-next-line no-console
          console.groupEnd()
        }

        router.refresh()
      } catch (error) {
        console.error('Failed to run receipt rule retroactively', error)
        toast.error('Failed to run the rule. Please try again.')
      } finally {
        setActiveRuleId(null)
      }
    })
  }

  return {
    previewRetro,
    runRetro,
    isRunning: isRetroPending,
    isPreviewing,
    activeRuleId,
  }
}
