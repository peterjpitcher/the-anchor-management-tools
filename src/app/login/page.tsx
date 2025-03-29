'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function LoginPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/bookings')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">Redirecting...</div>
    </div>
  )
} 