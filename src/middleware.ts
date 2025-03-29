import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // Create a response object
  const response = NextResponse.next()

  // Create server-side supabase client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          // Set the cookie on the response
          response.cookies.set({
            name,
            value,
            ...options,
            // Ensure cookies work in iframe
            sameSite: 'lax',
            httpOnly: true,
          })
        },
        remove(name: string, options: CookieOptions) {
          // Remove the cookie from the response
          response.cookies.set({
            name,
            value: '',
            ...options,
            maxAge: -1,
          })
        },
      },
    }
  )

  try {
    // Get the session - this will also refresh the session if needed
    const { data: { session } } = await supabase.auth.getSession()
    const pathname = request.nextUrl.pathname

    // Handle authentication redirects
    if (!session && pathname !== '/login') {
      // Redirect to login if not authenticated and not on login page
      const redirectUrl = new URL('/login', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    if (session && pathname === '/login') {
      // Redirect to home if authenticated and on login page
      const redirectUrl = new URL('/', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    return response
  } catch (error) {
    console.error('Auth error:', error)
    // On auth error, redirect to login
    const redirectUrl = new URL('/login', request.url)
    return NextResponse.redirect(redirectUrl)
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
} 