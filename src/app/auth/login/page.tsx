'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import Image from 'next/image'

// LoginForm component - Client Component
function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirectedFrom') || '/events'
  const supabase = createClient()

  // Security check: Clear URL if credentials are exposed
  useEffect(() => {
    // Check for exposed credentials in URL
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.has('email') || urlParams.has('password') || 
        urlParams.has('login-email') || urlParams.has('login-password')) {
      // Immediately clear the URL without reload
      window.history.replaceState({}, '', '/auth/login')
      console.error('SECURITY WARNING: Credentials detected in URL and cleared')
      
      // Clear form fields as a precaution
      setEmail('')
      setPassword('')
      
      // Show security warning
      toast.error('Security alert: Please enter your credentials again')
    }
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    
    // Security: Ensure we're not exposing credentials
    if (window.location.search.includes('password=') || window.location.search.includes('email=')) {
      window.history.replaceState({}, '', '/auth/login')
      toast.error('Security error: Please try logging in again')
      return
    }

    setIsLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) throw error

      toast.success('Logged in successfully')
      
      // Use replace to prevent back button issues
      router.replace(redirectTo)
      router.refresh()
    } catch (error: any) {
      console.error('Error:', error)
      if (error?.message?.includes('Invalid login credentials')) {
        toast.error('Invalid email or password')
      } else {
        toast.error('Failed to log in. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
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
          <h1 className="text-3xl font-bold text-white">
            Sign in to your account
          </h1>
          <p className="mt-2 text-sm text-green-100">
            This is a private system - authorised users only
          </p>
        </div>

        <form 
          onSubmit={handleSubmit} 
          method="POST" 
          action="#" 
          autoComplete="on"
          className="space-y-6"
        >
          {/* Hidden honeypot field for security */}
          <input 
            type="text" 
            name="username" 
            style={{ display: 'none' }} 
            tabIndex={-1} 
            autoComplete="off"
            onChange={() => {
              console.error('SECURITY: Bot detection triggered')
              toast.error('Security error detected')
            }}
          />
          
          {/* Email Field */}
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-white">
              Email address
            </label>
            <input
              id="login-email"
              name="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-green-800/50 bg-white/10 backdrop-blur px-3 py-2 text-white placeholder-green-200 shadow-sm focus:border-white focus:ring-white sm:text-sm"
              placeholder="you@example.com"
            />
          </div>

          {/* Password Field */}
          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-white">
              Password
            </label>
            <input
              id="login-password"
              name="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-green-800/50 bg-white/10 backdrop-blur px-3 py-2 text-white placeholder-green-200 shadow-sm focus:border-white focus:ring-white sm:text-sm"
              placeholder="Enter your password"
            />
          </div>

          {/* Forgot Password Link */}
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <Link
                href="/auth/reset-password"
                className="text-white underline hover:text-green-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-sidebar rounded"
              >
                Forgot your password?
              </Link>
            </div>
          </div>

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex w-full items-center justify-center rounded-lg bg-white px-6 py-3 md:py-2 text-base md:text-sm font-medium text-sidebar shadow-sm hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-sidebar disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] transition-colors duration-150"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Page Component
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-sidebar p-4">
        <div className="flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
} 