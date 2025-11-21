import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function resolveRedirectPath(path: string | null | undefined) {
  if (!path) {
    return '/events'
  }

  try {
    const decoded = decodeURIComponent(path)
    if (decoded.startsWith('/')) {
      return decoded
    }
  } catch {
    // fall back to default
  }

  return '/events'
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const nextParam = requestUrl.searchParams.get('next')
  const type = requestUrl.searchParams.get('type')
  const errorDescription = requestUrl.searchParams.get('error_description')

  if (type === 'recovery' && !code) {
    const recoveryUrl = new URL('/auth/recover', requestUrl.origin)
    return NextResponse.redirect(recoveryUrl)
  }

  if (errorDescription) {
    const loginUrl = new URL('/auth/login', requestUrl.origin)
    loginUrl.searchParams.set('error', 'callback')
    return NextResponse.redirect(loginUrl)
  }

  if (code) {
    const supabase = await createClient()

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      const loginUrl = new URL('/auth/login', requestUrl.origin)
      loginUrl.searchParams.set('error', 'callback')
      return NextResponse.redirect(loginUrl)
    }
  }

  const redirectPath = resolveRedirectPath(nextParam)
  return NextResponse.redirect(new URL(redirectPath, requestUrl.origin))
} 
