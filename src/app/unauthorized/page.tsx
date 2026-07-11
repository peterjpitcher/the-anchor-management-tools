'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Icon, Button } from '@/ds'

function UnauthorizedContent() {
  const searchParams = useSearchParams()
  const attemptedPath = searchParams.get('path') || searchParams.get('from') || '/'

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center">
            <Icon name="alertTriangle" size={28} className="text-warning" />
          </div>
        </div>

        <h1 className="auth__h1 text-center">Access Denied</h1>
        <p className="auth__lead text-center">
          You do not have permission to view this page. Contact your manager if you believe this is an error.
        </p>

        <div className="bg-surface-hover rounded-lg p-3 font-mono text-sm text-text-muted text-center mb-4 break-words">
          {attemptedPath}
        </div>

        <p className="text-xs text-text-subtle text-center mb-4">
          Your current role does not include access to this section. Ask an administrator to update your permissions if needed.
        </p>

        <div className="flex flex-col gap-2">
          <Link href="/dashboard" className="w-full">
            <Button variant="primary" size="lg" className="w-full" type="button">
              Go to Dashboard
            </Button>
          </Link>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => window.history.back()}
          >
            Go Back
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function UnauthorizedPage() {
  return (
    <Suspense
      fallback={
        <div className="auth">
          <div className="auth__card">
            <h1 className="auth__h1 text-center">Access Denied</h1>
          </div>
        </div>
      }
    >
      <UnauthorizedContent />
    </Suspense>
  )
}
