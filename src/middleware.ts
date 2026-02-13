import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { isShortLinkHost, isShortLinkPath } from '@/lib/short-links/routing'

const PUBLIC_PATH_PREFIXES = [
  '/_next',     // Next.js internal
  '/static',    // Static files directory
  '/api',       // API routes (often public or handle their own auth)
  
  // Auth Routes
  '/auth',
  '/error',
  '/privacy',
  
  // Public Features
  '/booking-confirmation',
  '/booking-success',
  '/table-booking',
  '/parking/guest',
  '/g',
  '/r',
];

const PUBLIC_FILE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.ico', '.json', '.xml', '.txt', '.css', '.js'
];

function isPublicPath(pathname: string) {
  if (pathname === '/') return true;
  
  // Check for specific public prefixes
  if (PUBLIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }

  // Check for file extensions (e.g., /logo.png)
  // This is safer than `pathname.includes('.')` which would expose `/user/john.doe`
  if (PUBLIC_FILE_EXTENSIONS.some(ext => pathname.toLowerCase().endsWith(ext))) {
    return true;
  }

  return false;
}

function sanitizeRedirectTarget(url: URL) {
  try {
    const decodedPath = decodeURIComponent(url.pathname).trim()
    const collapsedPath = decodedPath.replace(/\s+/g, '')
    const finalPath = collapsedPath.startsWith('/') ? collapsedPath : '/dashboard'
    const search = url.search ? url.search.replace(/\s+/g, '') : ''
    return finalPath + search
  } catch {
    return '/dashboard'
  }
}

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  if (isShortLinkHost(hostname) && isShortLinkPath(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  // 1. Create an unmodified response
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

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
            request.cookies.set(name, value)
          })
          response = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // 2. Refresh session if expired - required for Server Components
  const { data: { user } } = await supabase.auth.getUser()

  // 3. Protect routes
  if (!isPublicPath(request.nextUrl.pathname) && !user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectedFrom', sanitizeRedirectTarget(request.nextUrl))

    // Redirect while maintaining the session
    const redirectResponse = NextResponse.redirect(redirectUrl)
    
    // IMPORTANT: Copy over the cookies from the response object to the redirect response
    // so that any session refresh that happened above is not lost.
    const setCookieHeader = response.headers.get('set-cookie')
    if (setCookieHeader) {
      redirectResponse.headers.set('set-cookie', setCookieHeader)
    }

    return redirectResponse
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
