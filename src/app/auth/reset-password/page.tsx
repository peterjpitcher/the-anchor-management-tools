'use client'

import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Loader2, ArrowLeft } from 'lucide-react'
import Image from 'next/image'

// ResetPasswordForm component - Client Component
function ResetPasswordForm() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!email) {
      toast.error('Please enter your email address')
      return
    }
    
    setIsLoading(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/profile/change-password`,
      })

      if (error) throw error

      setIsSubmitted(true)
      toast.success('Password reset email sent!')
    } catch (error: any) {
      console.error('Error:', error)
      toast.error('Failed to send reset email. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto w-64 mb-2">
            <Image 
              src="/logo.png" 
              alt="The Anchor Logo" 
              width={256}
              height={256}
              className="w-full h-auto"
              priority 
            />
          </div>
          
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Check your email
          </h1>
          <p className="text-sm sm:text-base text-green-100 mb-8">
            We&apos;ve sent a password reset link to {email}
          </p>
          
          <Link
            href="/auth/login"
            className="inline-flex items-center text-white underline hover:text-green-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-sidebar rounded"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* Logo */}
          <div className="mx-auto w-64 mb-2">
            <Image 
              src="/logo.png" 
              alt="The Anchor Logo" 
              width={256}
              height={256}
              className="w-full h-auto"
              priority 
            />
          </div>
          
          {/* Title */}
          <h1 className="text-2xl sm:text-3xl font-bold text-white">
            Reset your password
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-green-100">
            Enter your email address and we&apos;ll send you a reset link
          </p>
        </div>

        <form 
          onSubmit={handleSubmit} 
          method="POST" 
          action="#" 
          autoComplete="on"
          className="space-y-6"
        >
          {/* Email Field */}
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium text-white">
              Email address
            </label>
            <input
              id="reset-email"
              name="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-green-800/50 bg-white/10 backdrop-blur px-4 py-3 text-base text-white placeholder-green-200 shadow-sm focus:border-white focus:ring-white min-h-[44px]"
              placeholder="you@example.com"
            />
          </div>

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex w-full items-center justify-center rounded-lg bg-white px-6 py-3 text-base font-medium text-sidebar shadow-sm hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-sidebar disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] transition-colors duration-150 touch-manipulation"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending reset email...
                </>
              ) : (
                'Send reset email'
              )}
            </button>
          </div>

          {/* Back to Login Link */}
          <div className="text-center">
            <Link
              href="/auth/login"
              className="inline-flex items-center text-sm text-white underline hover:text-green-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-sidebar rounded"
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back to login
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

// Page Component
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}