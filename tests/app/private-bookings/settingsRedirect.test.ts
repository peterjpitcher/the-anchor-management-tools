import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.fn((href: string) => {
  throw new Error(`REDIRECT:${href}`)
})
vi.mock('next/navigation', () => ({ redirect: (href: string) => redirect(href) }))

const getCurrentUserModuleActions = vi.fn()
vi.mock('@/app/actions/rbac', () => ({
  getCurrentUserModuleActions: (...args: unknown[]) => getCurrentUserModuleActions(...args),
}))

import PrivateBookingsSettingsPage from '@/app/(authenticated)/private-bookings/settings/page'

async function redirectTarget(): Promise<string> {
  try {
    await PrivateBookingsSettingsPage()
  } catch (error) {
    return String((error as Error).message).replace('REDIRECT:', '')
  }
  throw new Error('expected a redirect')
}

describe('/private-bookings/settings', () => {
  beforeEach(() => {
    redirect.mockClear()
    getCurrentUserModuleActions.mockReset()
  })

  it('opens the first settings tab a manager can use', async () => {
    getCurrentUserModuleActions.mockResolvedValue({ actions: ['view', 'manage'] })
    expect(await redirectTarget()).toBe('/private-bookings/settings/catering')
  })

  it('opens the only tab a vendors-only role can use', async () => {
    getCurrentUserModuleActions.mockResolvedValue({ actions: ['view', 'manage_vendors'] })
    expect(await redirectTarget()).toBe('/private-bookings/settings/vendors')
  })

  it('refuses someone with no settings tab', async () => {
    getCurrentUserModuleActions.mockResolvedValue({ actions: ['view'] })
    expect(await redirectTarget()).toBe('/unauthorized')
  })

  it('sends a signed-out visitor to sign in', async () => {
    getCurrentUserModuleActions.mockResolvedValue({ error: 'Not authenticated' })
    expect(await redirectTarget()).toBe('/login')
  })
})
