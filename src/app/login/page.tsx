'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Container } from '@/components/ui-v2/layout/Container'
import { Card } from '@/components/ui-v2/layout/Card'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to the actual login page
    router.replace('/auth/login')
  }, [router])

  return (
    <Container className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm text-center py-10">
        <div className="flex items-center justify-center gap-3">
          <Spinner />
          <span>Redirecting to login…</span>
        </div>
      </Card>
    </Container>
  )
}
