'use client'

import { useEffect } from 'react'
import { use } from 'react'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

import { BackButton } from '@/components/ui-v2/navigation/BackButton';
import { useRouter } from 'next/navigation';

export default function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter();
  const { id } = use(params)

  useEffect(() => {
    // Redirect to the contract API endpoint
    window.location.href = `/api/private-bookings/contract?bookingId=${id}`
  }, [id])

  return (
    <PageLayout
      title="Generating Contract"
      subtitle="We'll redirect you once the contract is ready"
      backButton={{ label: 'Back to Booking', onBack: () => router.back() }}
      loading
      loadingLabel="Generating contract..."
    >
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-gray-600">Hang tight while we prepare the contract...</p>
      </div>
    </PageLayout>
  )
}