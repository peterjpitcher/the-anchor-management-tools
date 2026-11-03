import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// Sign-in keeps a safe portal link (build contract 5.7): a portal-only user who opened an emailed
// /portal/training link while signed out lands back on it, never on another site.

vi.mock('@/services/auth', () => ({
  AuthService: {
    signIn: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { AuthService } from '@/services/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { signIn } from '@/app/actions/auth'

const mockedSignIn = AuthService.signIn as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

function mockAdminRoles(roles: Array<{ roles: { name: string | null } | null }>): void {
  const returns = vi.fn().mockResolvedValue({ data: roles, error: null })
  const eq = vi.fn().mockReturnValue({ returns })
  const select = vi.fn().mockReturnValue({ eq })
  mockedCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) })
}

describe('signIn with a saved link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSignIn.mockResolvedValue({ success: true, userId: 'user-1' })
  })

  it('sends a portal-only user back to the training link they opened', async () => {
    mockAdminRoles([])
    const result = await signIn('staff@example.com', 'password', '/portal/training/9b2f4a8e-1c1d-4e0e-9a51-0c6b2c1e7f00')
    expect(result).toEqual({ success: true, redirectTo: '/portal/training/9b2f4a8e-1c1d-4e0e-9a51-0c6b2c1e7f00' })
  })

  it('does the same for a portal shift manager', async () => {
    mockAdminRoles([{ roles: { name: 'portal_shift_manager' } }])
    const result = await signIn('lance@example.com', 'password', '/portal/leave')
    expect(result).toEqual({ success: true, redirectTo: '/portal/leave' })
  })

  it.each([
    ['no link', undefined],
    ['the login default', '/dashboard'],
    ['another site', 'https://evil.example/portal/training'],
    ['a protocol-relative link', '//evil.example/portal/training'],
    ['a climb out of the portal', '/portal/../dashboard'],
    ['a backslash trick', `/${String.fromCharCode(92)}evil.example`],
  ])('falls back to My Shifts for %s', async (_label, next) => {
    mockAdminRoles([])
    const result = await signIn('staff@example.com', 'password', next)
    expect(result).toEqual({ success: true, redirectTo: '/portal/shifts' })
  })

  it('leaves a management user to the login screen, link or not', async () => {
    mockAdminRoles([{ roles: { name: 'manager' } }])
    const result = await signIn('manager@example.com', 'password', '/portal/training')
    expect(result).toEqual({ success: true })
  })

  it('never redirects when the password is wrong', async () => {
    mockedSignIn.mockRejectedValue(new Error('Invalid login credentials'))
    const result = await signIn('staff@example.com', 'wrong', '/portal/training')
    expect(result).toEqual({ error: 'Invalid login credentials' })
    expect(mockedCreateAdminClient).not.toHaveBeenCalled()
  })
})
