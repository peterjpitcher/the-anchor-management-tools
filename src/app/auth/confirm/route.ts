import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { STAFF } from '@/lib/brand/palette'
import { createClient } from '@/lib/supabase/server'

const STATE_COOKIE = 'oj-reset-state'
const STATE_COOKIE_PATH = '/auth/confirm'
const FIVE_MINUTES = 60 * 5

/** The card's shadow: the text colour at 8% opacity (hex alpha 14), so the page stays on the stone neutrals. */
const CARD_SHADOW = `0 10px 30px ${STAFF.text}14`

function encodeState(state: { token_hash: string; type: EmailOtpType; next: string }) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeState(raw?: string | null) {
  if (!raw) return null
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    return JSON.parse(decoded) as { token_hash: string; type: EmailOtpType; next: string }
  } catch {
    return null
  }
}

function sanitizeNext(next?: string | null) {
  const cleaned = (next ?? '').trim()
  if (!cleaned) return '/auth/reset'
  const collapsed = cleaned.replace(/\s+/g, '')
  if (!collapsed.startsWith('/')) return '/auth/reset'
  return collapsed
}

export function HEAD() {
  return new Response(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = (url.searchParams.get('type') || 'recovery').toLowerCase() as EmailOtpType
  const nextParam = sanitizeNext(url.searchParams.get('next'))

  if (!tokenHash) {
    const redirectUrl = new URL('/error?code=missing_token', request.url)
    return NextResponse.redirect(redirectUrl)
  }

  const allowedTypes: EmailOtpType[] = ['recovery', 'email', 'signup', 'magiclink', 'email_change']
  const type: EmailOtpType = allowedTypes.includes(rawType) ? rawType : 'recovery'

  const response = new NextResponse(
    `<!doctype html>
<meta name="robots" content="noindex">
<title>Confirm Password Reset</title>
<body style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: ${STAFF.bg}; color: ${STAFF.text};">
  <form method="post" style="background: ${STAFF.surface}; padding: 32px; border-radius: 12px; box-shadow: ${CARD_SHADOW}; text-align: center; max-width: 360px; width: 100%;">
    <h1 style="font-size: 1.5rem; margin-bottom: 0.75rem;">Finish password reset</h1>
    <p style="margin-bottom: 1.5rem; color: ${STAFF.textMuted};">Click continue to securely confirm your identity and choose a new password.</p>
    <button type="submit" style="background: ${STAFF.primary}; color: ${STAFF.primaryFg}; border: none; border-radius: 8px; padding: 0.75rem 1.5rem; font-weight: 600; cursor: pointer;">Continue</button>
    <p style="margin-top: 1rem; font-size: 0.75rem; color: ${STAFF.textMuted};">If you didn’t request this, you can safely close this page.</p>
  </form>
</body>`,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    }
  )

  response.cookies.set({
    name: STATE_COOKIE,
    value: encodeState({ token_hash: tokenHash, type, next: nextParam }),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    maxAge: FIVE_MINUTES,
    path: STATE_COOKIE_PATH,
  })

  return response
}

export async function POST(request: NextRequest) {
  const state = decodeState(request.cookies.get(STATE_COOKIE)?.value)
  if (!state) {
    const redirectUrl = new URL('/error?code=missing_state', request.url)
    return NextResponse.redirect(redirectUrl)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    type: state.type,
    token_hash: state.token_hash,
  })

  const safeNext = sanitizeNext(state.next)
  const redirectTarget = error
    ? new URL(`/error?code=${encodeURIComponent(error.message)}`, request.url)
    : new URL(safeNext, request.url)

  const response = NextResponse.redirect(redirectTarget)
  response.cookies.set({ name: STATE_COOKIE, value: '', path: STATE_COOKIE_PATH, maxAge: 0 })
  return response
}
