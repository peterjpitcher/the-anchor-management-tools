'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
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
      toast.success(
        count > 0
          ? `Queued ${count} transaction${count !== 1 ? 's' : ''} for AI classification`
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
      disabled={isPending}
    >
      {isPending ? 'Queueing...' : 'Re-classify untagged'}
    </Button>
  )
}
