import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const loadProfile = vi.fn()
vi.mock('@/app/actions/profile', () => ({ loadProfile: () => loadProfile() }))
vi.mock('@/app/(authenticated)/profile/_components/ProfileClient', () => ({ ProfileClient: () => null }))

import ProfilePage from '@/app/(authenticated)/profile/page'

const PROFILE = {
  id: 'user-1',
  email: 'sam@example.com',
  full_name: 'Sam Example',
  avatar_url: null,
  created_at: '2026-01-10T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
  sms_notifications: true,
  email_notifications: false,
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the profile on the server and passes it to the screen', async () => {
    loadProfile.mockResolvedValue({ success: true, profile: PROFILE })
    const element = (await ProfilePage()) as ReactElement<Record<string, unknown>>
    expect(loadProfile).toHaveBeenCalledTimes(1)
    expect(element.props.initialProfile).toEqual(PROFILE)
    expect(element.props.initialError).toBeUndefined()
  })

  it('passes the failure on so the screen shows its error and retry', async () => {
    loadProfile.mockResolvedValue({ error: 'Not authenticated' })
    const element = (await ProfilePage()) as ReactElement<Record<string, unknown>>
    expect(element.props.initialProfile).toBeNull()
    expect(element.props.initialError).toBe('Not authenticated')
  })
})
