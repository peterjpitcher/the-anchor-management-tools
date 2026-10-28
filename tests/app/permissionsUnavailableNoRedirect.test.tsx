import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/rbac', () => ({ getPermissionStatus: mocks.status }))

import ChecklistsLayout from '@/app/(authenticated)/checklists/layout'
import { PermissionsUnavailable } from '@/components/features/shared/PermissionsUnavailable'

describe('a failed permission lookup does not send staff to Access Denied (BK-095)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the retry screen instead of redirecting', async () => {
    mocks.status.mockResolvedValue('unavailable')
    const element = await ChecklistsLayout({ children: 'page' })
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect((element as { type: unknown }).type).toBe(PermissionsUnavailable)
  })

  it('still redirects a real refusal', async () => {
    mocks.status.mockResolvedValue('denied')
    await expect(ChecklistsLayout({ children: 'page' })).rejects.toThrow('NEXT_REDIRECT /unauthorized')
  })
})
