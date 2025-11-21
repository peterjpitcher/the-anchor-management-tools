import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
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
            request.cookies.set({
              name,
              value,
              ...options,
            })
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            })
            response.cookies.set({
              name,
              value,
              ...options,
            })
          })
        },
      },
    }
  )

  // Do not run getUser() blindly. 
  // We will return the client and let the middleware decide when to call getUser() 
  // to avoid unnecessary database calls on static assets if not filtered properly,
  // though the middleware matcher should handle that.
  // However, for the standard pattern, we often return the user object to the middleware 
  // so it can make access decisions.
  
  const { data: { user } } = await supabase.auth.getUser()

  return { response, user }
}
