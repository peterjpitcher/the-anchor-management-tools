import { Metadata } from 'next'
import { Suspense } from 'react'
import LoginForm from './page-client' // We will create this
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

export const metadata: Metadata = {
  title: 'Sign In | The Anchor Management',
  description: 'Sign in to your account',
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <Spinner size="lg" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}