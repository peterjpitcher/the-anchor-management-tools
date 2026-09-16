'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
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

type RetroRunnerReturn = {
  runRetro: (options: RetroOptions) => void
  isRunning: boolean
  activeRuleId: string | null
}

export function useRetroRuleRunner(): RetroRunnerReturn {
  const router = useRouter()
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null)
  const [isRetroPending, startRetroTransition] = useTransition()

  function runRetro({ ruleId, scope }: RetroOptions) {
    setActiveRuleId(ruleId)
    startRetroTransition(async () => {
      try {
        // Keyset cursor, not an offset: applying a rule moves rows out of the pending set, so an
        // offset would skip the rows that shifted up under it. Null asks for the first chunk.
        let cursor: string | null = null
        let iterations = 0
        let lastSamples: Array<Record<string, unknown>> = []
        const totals = {
          reviewed: 0,
          matched: 0,
          statusAutoUpdated: 0,
          classificationUpdated: 0,
          vendorIntended: 0,
          expenseIntended: 0,
        }

        while (iterations < MAX_ITERATIONS) {
          const step = await runReceiptRuleRetroactivelyStep({
            ruleId,
            scope,
            cursor,
            offset: totals.reviewed,
            chunkSize: CHUNK_SIZE,
          })

          if (!step.success) {
            toast.error(step.error)
            break
          }

          totals.reviewed += step.reviewed
          totals.matched += step.matched
          totals.statusAutoUpdated += step.statusAutoUpdated
          totals.classificationUpdated += step.classificationUpdated
          totals.vendorIntended += step.vendorIntended
          totals.expenseIntended += step.expenseIntended

          if (step.samples.length) {
            lastSamples = step.samples
          }

          iterations += 1

          if (step.done) {
            await finalizeReceiptRuleRetroRun({
              ruleId,
              scope,
              reviewed: totals.reviewed,
              statusAutoUpdated: totals.statusAutoUpdated,
              classificationUpdated: totals.classificationUpdated,
              matched: totals.matched,
              vendorIntended: totals.vendorIntended,
              expenseIntended: totals.expenseIntended,
            })

            const scopeLabel = scope === 'all' ? 'transactions' : 'pending transactions'
            toast.success(
              `Rule processed ${totals.matched} / ${totals.reviewed} ${scopeLabel} · ${totals.statusAutoUpdated} status updates · ${totals.classificationUpdated} classifications`
            )

            if (lastSamples.length) {
              // eslint-disable-next-line no-console
              console.groupCollapsed(`Receipt rule analysis (${lastSamples.length} sample transactions)`)
              // eslint-disable-next-line no-console
              console.table(lastSamples)
              // eslint-disable-next-line no-console
              console.groupEnd()
            }

            router.refresh()
            return
          }

          // The cursor must move on every unfinished step, or the next request would read the
          // same chunk again. Stop rather than loop.
          if (!step.nextCursor || step.nextCursor === cursor || step.reviewed === 0) {
            break
          }

          cursor = step.nextCursor
        }

        toast.error('Stopped before completion. Please run again to continue.')
      } catch (error) {
        console.error('Failed to run receipt rule retroactively', error)
        toast.error('Failed to run the rule. Please try again.')
      } finally {
        setActiveRuleId(null)
      }
    })
  }

  return {
    runRetro,
    isRunning: isRetroPending,
    activeRuleId,
  }
}
