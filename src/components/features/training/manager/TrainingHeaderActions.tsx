'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, LinkButton, toast } from '@/ds'
import { syncTrainingNow } from '@/app/actions/training'
import type { SyncResult } from '@/lib/training/types'
import { AssignTrainingDialog } from './AssignTrainingDialog'
import { TrainingViewSwitch } from './TrainingViewSwitch'
import { runTrainingAction } from './run-action'
import { useTrainingPermissions } from './use-training-permissions'
import { TRAINING_EXPORT_HREF, type TrainingView } from './views'

interface TrainingHeaderActionsProps {
  view: TrainingView
}

function describeSync(result: SyncResult): string {
  const total = result.created + result.cancelled + result.updated
  if (total === 0) return 'Training is up to date. Nothing changed.'
  return `Training updated: ${result.created} added, ${result.cancelled} cancelled, ${result.updated} changed.`
}

/**
 * Header actions of Employees, Training: the view switch, Export CSV (anyone who can see the
 * page), and Sync Now and Assign Training for managers.
 */
export function TrainingHeaderActions({ view }: TrainingHeaderActionsProps): React.JSX.Element {
  const router = useRouter()
  const { canManage } = useTrainingPermissions()
  const [syncing, startSync] = useTransition()
  const [assigning, setAssigning] = useState(false)

  const sync = (): void => {
    startSync(async () => {
      const result = await runTrainingAction(() => syncTrainingNow(), 'Training could not be synced. Try again.')
      if (result.error || !result.data) {
        toast.error(result.error ?? 'Training could not be synced. Try again.')
        return
      }
      toast.success(describeSync(result.data))
      router.refresh()
    })
  }

  return (
    <>
      <TrainingViewSwitch view={view} />
      <LinkButton href={TRAINING_EXPORT_HREF} size="sm" variant="secondary" download>
        Export CSV
      </LinkButton>
      {canManage ? (
        <>
          <Button type="button" size="sm" variant="secondary" loading={syncing} onClick={sync}>
            Sync Now
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={() => setAssigning(true)}>
            Assign Training
          </Button>
          <AssignTrainingDialog open={assigning} onClose={() => setAssigning(false)} onAssigned={() => router.refresh()} />
        </>
      ) : null}
    </>
  )
}
