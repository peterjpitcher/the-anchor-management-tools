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
        let offset = 0
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
            offset,
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

          offset = step.nextOffset
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
              console.groupCollapsed(`Receipt rule analysis (${lastSamples.length} sample transactions)`)
              console.table(lastSamples)
              console.groupEnd()
            }

            router.refresh()
            return
          }

          if (step.reviewed === 0) {
            break
          }
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
