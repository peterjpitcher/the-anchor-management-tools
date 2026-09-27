'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Button, LinkButton, PageLoading } from '@/ds'
import { AuthCard } from '@/app/auth/_components/AuthCard'

const ACCESS_DENIED = {
  title: 'Access Denied',
  lead: 'You do not have permission to view this page. Contact your manager if you believe this is an error.',
  icon: { name: 'alertTriangle', tone: 'warning' },
} as const

function UnauthorizedContent() {
  const searchParams = useSearchParams()
  const attemptedPath = searchParams.get('path') || searchParams.get('from') || '/'

  return (
    <AuthCard {...ACCESS_DENIED}>
      <p className="mb-4 break-words rounded-default bg-surface-2 p-3 text-center font-mono text-sm text-text-muted">
        {attemptedPath}
      </p>

      <p className="mb-4 text-center text-xs text-text-soft">
        Your current role does not include access to this section. Ask an administrator to update your permissions if needed.
      </p>

      <div className="flex flex-col gap-2">
        <LinkButton href="/dashboard" variant="primary" size="lg" className="w-full">
          Go to Dashboard
        </LinkButton>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => window.history.back()}
        >
          Go Back
        </Button>
      </div>
    </AuthCard>
  )
}

export default function UnauthorizedPage() {
  return (
    <Suspense
      fallback={
        <AuthCard {...ACCESS_DENIED}>
          <PageLoading inline />
        </AuthCard>
      }
    >
      <UnauthorizedContent />
    </Suspense>
  )
}
