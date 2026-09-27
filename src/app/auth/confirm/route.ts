import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { STAFF } from '@/lib/brand/palette'
import { createClient } from '@/lib/supabase/server'

const STATE_COOKIE = 'oj-reset-state'
const STATE_COOKIE_PATH = '/auth/confirm'
const FIVE_MINUTES = 60 * 5

/*
 * The interstitial is a bare HTML response with no app stylesheet, so it is styled inline with the
 * literal token values from STAFF (pinned to globals.css by tests/ds/brand-palette.test.ts) and
 * drawn as the sign-in card (src/app/auth/_components/AuthCard.tsx), like global-error.tsx: the
 * same logo, card, title, lead and full-width primary button, so the reset journey keeps one look.
 */
/** --shadow-lg, the sign-in card's shadow. */
const CARD_SHADOW = '0 12px 28px -8px rgba(15, 23, 42, 0.18)'

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
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Confirm Password Reset</title>
<body style="margin: 0; padding: 16px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: ${STAFF.bg}; color: ${STAFF.text}; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <form method="post" style="box-sizing: border-box; width: 100%; max-width: 384px; padding: 36px; background: ${STAFF.surface}; border: 1px solid ${STAFF.border}; border-radius: 14px; box-shadow: ${CARD_SHADOW};">
    <img src="/orange-jelly/logo-horizontal.png" alt="Orange Jelly" width="240" height="52" style="display: block; width: 240px; max-width: 100%; height: auto;">
    <p style="margin: 0 0 24px; font-size: 12px; color: ${STAFF.textMuted};">Management Tools</p>
    <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; letter-spacing: -0.015em; color: ${STAFF.textStrong};">Finish Password Reset</h1>
    <p style="margin: 0 0 20px; font-size: 13px; line-height: 1.5; color: ${STAFF.textMuted};">Click continue to securely confirm your identity and choose a new password.</p>
    <button type="submit" style="width: 100%; height: 36px; padding: 0 16px; border: 1px solid ${STAFF.primary}; border-radius: 8px; background: ${STAFF.primary}; color: ${STAFF.primaryFg}; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer;">Continue</button>
    <p style="margin: 28px 0 0; text-align: center; font-size: 12px; color: ${STAFF.textSoft};">If you didn’t request this, you can safely close this page.</p>
  </form>
</body>
</html>`,
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
