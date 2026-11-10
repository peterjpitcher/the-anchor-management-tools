import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { noStoreFetch } from '@/lib/supabase/no-store-fetch'

/**
 * A real Supabase session for the account MCP requests act as.
 *
 * The session is made the way a sign-in link would make it: the admin API generates a magic
 * link for the account (no email is sent) and the token from it is verified on the server. The
 * result is an ordinary session, so `auth.getUser()` validates it against Supabase Auth and row
 * level security sees the account exactly as it sees Peter's browser.
 *
 * One session is kept per server instance and reused until it is within five minutes of
 * expiring, then refreshed with its refresh token. A fresh session is only made when there is
 * none, the account changes, or the refresh is refused.
 */

const REFRESH_MARGIN_MS = 5 * 60 * 1000

interface CachedSession {
  userId: string
  accessToken: string
  refreshToken: string
  expiresAtMs: number
}

let cached: CachedSession | null = null
let pending: Promise<CachedSession> | null = null

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is not set')
  return url
}

function anonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable is not set')
  return key
}

function newAnonClient(): SupabaseClient {
  return createSupabaseClient(supabaseUrl(), anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: noStoreFetch },
  })
}

function toCached(
  userId: string,
  session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number },
): CachedSession {
  const expiresAtMs = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + (session.expires_in ?? 3600) * 1000
  return {
    userId,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAtMs,
  }
}

async function mintSession(userId: string): Promise<CachedSession> {
  const admin = createAdminClient()
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId)
  const email = userData?.user?.email
  if (userError || !email) {
    throw new Error(
      `The MCP acting account ${userId} could not be loaded: ${userError?.message ?? 'it has no email address'}`,
    )
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const tokenHash = linkData?.properties?.hashed_token
  if (linkError || !tokenHash) {
    throw new Error(`A session for the MCP acting account could not be started: ${linkError?.message ?? 'no token'}`)
  }

  const { data: verified, error: verifyError } = await newAnonClient().auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  })
  if (verifyError || !verified.session) {
    throw new Error(
      `A session for the MCP acting account could not be verified: ${verifyError?.message ?? 'no session'}`,
    )
  }
  if (verified.session.user.id !== userId) {
    throw new Error('The MCP acting session belongs to a different account')
  }

  return toCached(userId, verified.session)
}

async function refreshSession(current: CachedSession): Promise<CachedSession | null> {
  const { data, error } = await newAnonClient().auth.refreshSession({ refresh_token: current.refreshToken })
  if (error || !data.session || data.session.user.id !== current.userId) {
    return null
  }
  return toCached(current.userId, data.session)
}

async function freshSession(userId: string): Promise<CachedSession> {
  const current = cached
  if (current && current.userId === userId && current.expiresAtMs - Date.now() > REFRESH_MARGIN_MS) {
    return current
  }

  if (!pending) {
    pending = (async () => {
      const refreshed = current && current.userId === userId ? await refreshSession(current) : null
      const next = refreshed ?? (await mintSession(userId))
      cached = next
      return next
    })().finally(() => {
      pending = null
    })
  }

  const next = await pending
  if (next.userId !== userId) {
    // Another request was minting for a different account. Never hand its session over.
    return freshSession(userId)
  }
  return next
}

/** A client signed in as `userId`, for one MCP request. */
export async function createActingClient(userId: string): Promise<SupabaseClient> {
  const session = await freshSession(userId)
  const client = newAnonClient()
  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  })
  if (error) {
    cached = null
    throw new Error(`The MCP acting session was refused: ${error.message}`)
  }
  return client
}

