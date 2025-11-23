import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

type SessionCookie = {
  name: string
  value: string
  options: CookieOptions
}

export async function GET() {
  const cookieStore = await cookies()
  const cookiesToSet: SessionCookie[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookies) {
          cookiesToSet.push(...cookies)

          try {
            cookies.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Ignore errors when running in environments without mutable cookies
          }
        },
      },
    }
  )

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  const response = NextResponse.json(
    { user, cookies: cookiesToSet, error: error?.message ?? null },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )

  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set({ name, value, ...options })
  })

  return response
}
