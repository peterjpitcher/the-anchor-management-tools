import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { PageLoading } from '@/ds'
import { MessagesClient } from './_components/MessagesClient'

export default async function MessagesPage() {
  const canViewMessages = await checkUserPermission('messages', 'view')
  if (!canViewMessages) {
    redirect('/unauthorized')
  }

  // MessagesClient reads the selected conversation from `?customer=`, and
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={<PageLoading />}>
      <MessagesClient />
    </Suspense>
  )
}
