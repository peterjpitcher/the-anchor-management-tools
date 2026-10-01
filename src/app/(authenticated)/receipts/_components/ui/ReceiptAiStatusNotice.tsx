'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, toast } from '@/ds'
import { retryFailedReceiptClassification } from '@/app/actions/receipt-ai'
import type { ReceiptWorkspaceData } from '@/app/actions/receipts'
import { usePermissions } from '@/contexts/PermissionContext'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * What the AI could not do, said out loud. Before this, a failed classification left a payment
 * with no vendor and no category and nothing on screen to say why.
 */
export function ReceiptAiStatusNotice({ status }: { status: ReceiptWorkspaceData['aiStatus'] }) {
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('receipts', 'manage')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!status || (status.failed === 0 && status.payrollChecks === 0)) return null

  function retry() {
    startTransition(async () => {
      const result = await retryFailedReceiptClassification()
      if (!result.success) {
        toast.error(result.error ?? 'The transactions could not be queued again.')
        return
      }
      const queued = result.queued ?? 0
      toast.success(
        queued > 0
          ? `Queued ${plural(queued, 'transaction', 'transactions')} to be classified again`
          : 'There was nothing left to send again'
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {status.failed > 0 && (
        <Alert tone="warning" title="Some transactions could not be classified" role="status">
          <p>
            The AI could not classify {plural(status.failed, 'transaction', 'transactions')}. They still need a
            vendor or a category, and each one says so in the list below.
            {status.failedForGood > 0
              ? ` ${plural(status.failedForGood, 'of them has', 'of them have')} been given up on and will only be tried again if you ask.`
              : ''}
          </p>
          {canManage && (
            <Button className="mt-2" size="sm" variant="secondary" onClick={retry} loading={isPending}>
              Try again
            </Button>
          )}
        </Alert>
      )}
      {status.payrollChecks > 0 && (
        <Alert tone="info" title="Possible wage payments to check" role="status">
          <p>
            {plural(status.payrollChecks, 'payment looks', 'payments look')} like wages but could not be matched to
            one person with certainty. Nothing was sent to the AI for {status.payrollChecks === 1 ? 'it' : 'them'}.
            Each one is marked in the list below: set the vendor and category by hand.
          </p>
        </Alert>
      )}
    </div>
  )
}
