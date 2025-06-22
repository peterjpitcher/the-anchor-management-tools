'use client'

import { useEffect } from 'react'
import { use } from 'react'

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
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-gray-600">Generating contract...</p>
      </div>
    </div>
  )
}