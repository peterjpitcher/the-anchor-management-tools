import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The onboarding Sign Out buttons used the staff app's signOut, whose Supabase default scope ends
 * every session the account has. On the "Signed In as Someone Else" card that signed a manager out
 * on their phone and every other device. These buttons sign out this browser only.
 */

const auth = vi.hoisted(() => ({
  user: { id: 'manager-1', email: 'manager@example.com' } as { id: string; email: string } | null,
  signOutError: null as { code?: string; message: string } | null,
  signOut: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: auth.user }, error: null }),
      signOut: async (options: unknown) => {
        auth.signOut(options)
        return { error: auth.signOutError }
      },
    },
  }),
}))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

import { logAuditEvent } from '@/app/actions/audit'
import { signOutOnThisDevice } from '@/app/actions/onboardingSignOut'

describe('signOutOnThisDevice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.user = { id: 'manager-1', email: 'manager@example.com' }
    auth.signOutError = null
  })

  it('signs out this browser only, and records the sign out', async () => {
    expect(await signOutOnThisDevice()).toEqual({ success: true })

    expect(auth.signOut).toHaveBeenCalledTimes(1)
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'manager-1',
      operation_type: 'logout',
      resource_type: 'auth',
      operation_status: 'success',
      additional_info: { scope: 'local', source: 'onboarding' },
    }))
  })

  it('says so plainly when the sign out fails, and records nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    auth.signOutError = { code: 'unexpected_failure', message: 'AuthRetryableFetchError: fetch failed' }

    const result = await signOutOnThisDevice()

    expect(result).toEqual({ error: 'We could not sign you out. Please try again.' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it('succeeds with nobody signed in, so pressing it twice is harmless', async () => {
    auth.user = null

    expect(await signOutOnThisDevice()).toEqual({ success: true })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
