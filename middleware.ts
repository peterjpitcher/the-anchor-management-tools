import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Allow cron endpoints without authentication
  if (request.nextUrl.pathname.startsWith('/api/cron')) {
    return NextResponse.next()
  }

  // Your existing middleware logic here...
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api/cron|_next/static|_next/image|favicon.ico|login).*)',
  ],
} 