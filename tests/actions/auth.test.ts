import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

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

function mockAdminRoles(roles: Array<{ roles: { name: string | null } | null }>) {
  const returns = vi.fn().mockResolvedValue({ data: roles, error: null })
  const eq = vi.fn().mockReturnValue({ returns })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })

  mockedCreateAdminClient.mockReturnValue({ from })

  return { from, select, eq, returns }
}

describe('auth actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSignIn.mockResolvedValue({ success: true, userId: 'user-1' })
  })

  describe('signIn', () => {
    it('redirects users with no roles to the staff portal', async () => {
      mockAdminRoles([])

      const result = await signIn('staff@example.com', 'password')

      expect(result).toEqual({ success: true, redirectTo: '/portal/shifts' })
    })

    it('keeps portal shift managers portal-only', async () => {
      mockAdminRoles([{ roles: { name: 'portal_shift_manager' } }])

      const result = await signIn('lance@example.com', 'password')

      expect(result).toEqual({ success: true, redirectTo: '/portal/shifts' })
    })

    it('does not redirect management users to the staff portal', async () => {
      mockAdminRoles([{ roles: { name: 'manager' } }])

      const result = await signIn('manager@example.com', 'password')

      expect(result).toEqual({ success: true })
    })
  })
})
