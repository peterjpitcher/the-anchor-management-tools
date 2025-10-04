import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PUBLIC_PATH_PREFIXES = [
  '/_next',
  '/static',
  '/auth',
  '/error',
  '/privacy',
  '/booking-confirmation',
  '/booking-success',
  '/table-booking',
  '/parking/guest',
  '/api',
]

function isPublicPath(pathname: string) {
  if (pathname === '/') return true
  if (pathname.includes('.')) return true
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isVipHost(hostname: string) {
  return hostname === 'vip-club.uk' || hostname.endsWith('.vip-club.uk')
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  if (isVipHost(hostname)) {
    return NextResponse.next()
  }

  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options })
        },
        remove(name, options) {
          response.cookies.delete({ name, ...options })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set(
      'redirectedFrom',
      request.nextUrl.pathname + (request.nextUrl.search || '')
    )
    return NextResponse.redirect(redirectUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
