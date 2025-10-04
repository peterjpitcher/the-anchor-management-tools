# Authentication Setup & Password Recovery (Current)

This document reflects the hardened setup we now run in production. Key changes since the last rev:

- Password-reset links now land on **our** `/auth/confirm` route, where the token hash is verified server-side (no PKCE/localStorage, SafeLinks-safe).
- Middleware no longer inspects cookie names; it uses Supabase’s official `getUser()` pattern to refresh auth cookies on every request.
- `/auth/recover` is purely informational. `/auth/reset` hosts the “set new password” form once the confirm route has established a session.

## 1. Supabase Dashboard settings

- **Project**: `tfcasgxopxegwrabvwat`
- **Site URL**: `https://management.orangejelly.co.uk`
- **Redirect allow list**:
  - `https://management.orangejelly.co.uk/auth/login`
  - `https://management.orangejelly.co.uk/auth/recover`
  - `https://management.orangejelly.co.uk/auth/callback`
  - `https://management.orangejelly.co.uk/auth/confirm`
- **Reset password email template** (Auth → Email Templates → Reset Password):

  ```html
  {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset
  ```

  This ensures every email points at our confirm route with Supabase’s `TokenHash`. We don’t expose Supabase’s hosted `/verify` URL to users, so SafeLinks/scanners can’t burn the OTP.

- **Client-initiated resets** (`resetPasswordForEmail`) also pass the same redirect so Supabase includes it when we trigger mails from the UI.

## 2. Middleware & server auth guard

`src/middleware.ts` mirrors Supabase’s official Next.js guidance. It refreshes cookies via `getUser()` and redirects unauthenticated traffic to `/auth/login`.

```ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATH_PREFIXES = ['/_next', '/static', '/auth', '/error', '/privacy', '/booking-confirmation', '/booking-success', '/table-booking', '/parking/guest', '/api']

function isPublicPath(pathname: string) {
  if (pathname === '/' || pathname.includes('.')) return true
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function isVipHost(hostname: string) {
  return hostname === 'vip-club.uk' || hostname.endsWith('.vip-club.uk')
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
  if (isVipHost(request.headers.get('host') || '')) return NextResponse.next()
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next()

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })
  const supabase = createMiddlewareClient({ req: request, res: response })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/auth/login'
    redirectUrl.searchParams.set('redirectedFrom', sanitizeRedirectTarget(request.nextUrl))
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
```

On the server, protected pages (e.g. `/auth/reset`) call `supabase.auth.getUser()` using the SSR helper and redirect if no session is present.

## 3. Password reset flow

1. User requests a reset from `/auth/reset-password` (or admin triggers via dashboard).
2. Email contains `https://management.orangejelly.co.uk/auth/confirm?token_hash=…&type=recovery&next=/auth/reset`.
3. `/auth/confirm` does the following:
   - `HEAD` → returns `204` (mail scanners do nothing).
   - `GET` → sets a short-lived, HTTP-only cookie with the token hash + type + next path, then renders a minimal “Continue” form.
   - `POST` → reads the cookie and calls `supabase.auth.verifyOtp({ token_hash, type: 'recovery' })`. Supabase sets the session cookies server-side. Upon success, we redirect to `/auth/reset` and clear the cookie. On failure we redirect to `/error?code=…`.

```ts
// app/auth/confirm/route.ts (excerpt)
const STATE_COOKIE = 'oj-reset-state'

function encodeState(state: { token_hash: string; type: EmailOtpType; next: string }) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

export async function GET(request: NextRequest) {
  const tokenHash = new URL(request.url).searchParams.get('token_hash')
  // …validate, set cookie, render Continue form…
}

export async function POST(request: NextRequest) {
  const state = decodeState(request.cookies.get(STATE_COOKIE)?.value)
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: state.type, token_hash: state.token_hash })
  const redirectTarget = error
    ? new URL(`/error?code=${encodeURIComponent(error.message)}`, request.url)
    : new URL(state.next || '/auth/reset', request.url)
  const response = NextResponse.redirect(redirectTarget)
  response.cookies.set({ name: STATE_COOKIE, value: '', path: '/auth/confirm', maxAge: 0 })
  return response
}
```

4. `/auth/reset` (server component) ensures the user is now authenticated and renders a client form that calls `supabase.auth.updateUser({ password })`.

```tsx
// app/auth/reset/page.tsx
const supabase = await createClient()
const {
  data: { user },
} = await supabase.auth.getUser()
if (!user) redirect('/auth/login?redirectedFrom=%2Fauth%2Freset')
return <ResetPasswordForm email={user.email ?? undefined} />
```

```tsx
// app/auth/reset/reset-password-form.tsx (client)
const { error } = await supabase.auth.updateUser({ password })
if (error) { toast.error(error.message) } else { toast.success('Password updated'); router.replace('/dashboard') }
```

5. `/auth/recover` now simply displays “Check your inbox” guidance. `/auth/reset-password` sends the email and sets `redirectTo: ${origin}/auth/confirm?next=/auth/reset`.

## 4. Error handling & UX notes

- `/auth/confirm` redirects to `/error?code=…` if the token hash is missing/expired or `verifyOtp` fails. `/error` should decode and display the message (we can add friendly mappings: `otp_expired`, `over_email_send_rate_limit`, etc.).
- When requesting another reset, the UI now states that earlier links are invalidated immediately.
- SafeLinks/Proofpoint can no longer consume tokens because they don’t submit the POST form. Users who copy/paste the link manually still work (the token hash is stored in the HTTP-only cookie when they hit the GET).

## 5. Open questions / next refinements

- We may want to add a rate-limited endpoint to resend reset emails if users claim they didn’t receive one (currently the Supabase default).
- Consider server-rendering the “error” responses with friendlier copy.
- If corporate scanners start attempting POST requests, we can require a small amount of user interaction (e.g., `name` field) before submitting.

Let me know if any part of this setup looks suspect or if you want code snippets for the Supabase server client helper (`src/lib/supabase/server.ts`).
