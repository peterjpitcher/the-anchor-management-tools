'use client'

import { Suspense } from 'react'
import LoginClient from './_components/LoginClient'
import { PageLoading } from '@/ds'
import { AuthCard } from '../_components/AuthCard'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title="Sign In">
          <PageLoading inline />
        </AuthCard>
      }
    >
      <LoginClient />
    </Suspense>
  )
}
