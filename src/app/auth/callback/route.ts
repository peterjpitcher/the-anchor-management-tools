import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
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
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {
              // Server Component context
            }
          },
        },
      }
    )

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
