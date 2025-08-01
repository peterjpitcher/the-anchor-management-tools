'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import Image from 'next/image'
import { Form, FormActions } from '@/components/ui-v2/forms/Form'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Button } from '@/components/ui-v2/forms/Button'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Container } from '@/components/ui-v2/layout/Container'
import { Card } from '@/components/ui-v2/layout/Card'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'

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
      <Container size="sm">
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
            Sign in to your account
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-white/80">
            This is a private system - authorised users only
          </p>
        </div>

        <Card>
          <Form onSubmit={handleSubmit} autoComplete="on">
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
            <FormGroup
              label="Email address"
              required
            >
              <Input
                id="login-email"
                name="login-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </FormGroup>

            {/* Password Field */}
            <FormGroup
              label="Password"
              required
            >
              <Input
                id="login-password"
                name="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </FormGroup>

            {/* Forgot Password Link */}
            <div className="flex items-center justify-between mb-6">
              <Link
                href="/auth/reset-password"
                className="text-sm text-primary hover:text-primary/80 underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
              >
                Forgot your password?
              </Link>
            </div>

            {/* Submit Button */}
            <FormActions>
              <Button
                type="submit"
                disabled={isLoading}
                loading={isLoading}
                fullWidth
                size="lg"
              >
                Sign in
              </Button>
            </FormActions>
          </Form>
        </Card>
      </Container>
    </div>
  )
}

// Page Component
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