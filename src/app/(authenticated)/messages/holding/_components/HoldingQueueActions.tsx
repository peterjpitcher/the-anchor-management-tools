'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/ds'
import CustomerSearchInput from '@/components/features/customers/CustomerSearchInput'
import {
  ignoreUnmatchedCommunicationAction,
  linkUnmatchedCommunicationAction,
} from '@/app/actions/communications'

type Customer = {
  id: string
  first_name: string
  last_name: string | null
  mobile_number: string | null
  email: string | null
}

interface HoldingQueueActionsProps {
  unmatchedId: string
  candidateCustomerIds?: string[]
}

export function HoldingQueueActions({
  unmatchedId,
  candidateCustomerIds = [],
}: HoldingQueueActionsProps): React.ReactElement {
  const router = useRouter()
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleLink(): void {
    setMessage(null)
    if (!selectedCustomer) {
      setMessage('Choose a customer first.')
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('unmatchedId', unmatchedId)
      formData.set('customerId', selectedCustomer.id)
      const result = await linkUnmatchedCommunicationAction(formData)

      if (result.error) {
        setMessage(result.error)
        return
      }

      router.refresh()
    })
  }

  function handleIgnore(): void {
    setMessage(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.set('unmatchedId', unmatchedId)
      const result = await ignoreUnmatchedCommunicationAction(formData)

      if (result.error) {
        setMessage(result.error)
        return
      }

      router.refresh()
    })
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="max-w-xl">
        <p className="mb-1 text-[13px] font-medium text-text">Customer</p>
        <CustomerSearchInput
          onCustomerSelect={setSelectedCustomer}
          selectedCustomerId={selectedCustomer?.id ?? null}
          placeholder="Search customers..."
          highlightCustomerIds={candidateCustomerIds}
          highlightLabel="Suggested"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={handleLink} loading={isPending}>
          Link
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleIgnore} loading={isPending}>
          Ignore
        </Button>
        {message && <p className="text-sm text-danger">{message}</p>}
      </div>
    </div>
  )
}
