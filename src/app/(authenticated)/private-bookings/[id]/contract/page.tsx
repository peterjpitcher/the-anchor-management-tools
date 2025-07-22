'use client'

import { useEffect } from 'react'
import { use } from 'react'
import { Page } from '@/components/ui-v2/layout/Page'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

export default function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  useEffect(() => {
    // Redirect to the contract API endpoint
    window.location.href = `/api/private-bookings/contract?bookingId=${id}`
  }, [id])

  return (
    <Page title="Generating Contract">
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
        <p className="mt-4 text-gray-600">Generating contract...</p>
      </div>
    </Page>
  )
}