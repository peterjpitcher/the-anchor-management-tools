import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

type CookieOptions = {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  priority?: 'low' | 'medium' | 'high'
}

type PendingCookie = {
  name: string
  value: string
  options?: CookieOptions
}

export function createClient(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const pendingCookies: PendingCookie[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options: options as CookieOptions | undefined })
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  function applyCookies<T extends NextResponse>(target: T) {
    pendingCookies.forEach(({ name, value, options }) => {
      target.cookies.set(name, value, options)
    })

    return target
  }

  return { supabase, response: applyCookies(response), applyCookies }
}
