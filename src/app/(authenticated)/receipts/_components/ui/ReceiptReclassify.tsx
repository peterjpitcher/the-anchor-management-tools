'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@/ds'
import { requeueUnclassifiedTransactions } from '@/app/actions/receipts'
import { usePermissions } from '@/contexts/PermissionContext'

export function ReceiptReclassify() {
  const { hasPermission } = usePermissions()
  const canManage = hasPermission('receipts', 'manage')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (!canManage) return null

  function handleRequeue() {
    startTransition(async () => {
      const result = await requeueUnclassifiedTransactions()
      if (!result.success) {
        toast.error(result.error ?? 'Failed to queue classifications')
        return
      }
      const count = result.queued ?? 0
      const alreadyAsked = result.alreadyAsked ?? 0
      // A payment is only sent once per version of the question, so a second click no longer
      // pays to ask the same thing again. Say so, or "nothing queued" reads like a fault.
      const asked =
        alreadyAsked > 0
          ? ` ${alreadyAsked} already asked and not sent again.`
          : ''
      toast.success(
        count > 0
          ? `Queued ${count} transaction${count !== 1 ? 's' : ''} for AI classification.${asked}`
          : alreadyAsked > 0
            ? `Nothing new to send.${asked}`
            : 'No untagged transactions found'
      )
      if (count > 0) {
        router.refresh()
      }
    })
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleRequeue}
      loading={isPending}
    >
      Re-classify Untagged
    </Button>
  )
}
