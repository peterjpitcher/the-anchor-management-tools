'use client'

import { Suspense } from 'react'
import LoginClient from './_components/LoginClient'
import { Spinner } from '@/ds'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth">
          <Spinner size="lg" />
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  )
}
