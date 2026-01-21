'use client'

import { Suspense } from 'react'
import LoginForm from './page-client'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
