import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkUserPermission = vi.fn()
const buildSettingsTileGroups = vi.fn((_flags: Record<string, boolean>) => [])

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: (...args: unknown[]) => checkUserPermission(...args),
}))
vi.mock('@/app/actions/maintenance', () => ({ currentUserCanUseMaintenance: vi.fn(async () => false) }))
vi.mock('@/app/actions/site-settings', () => ({ getSiteSettings: vi.fn(async () => ({ settings: null })) }))
vi.mock('@/app/(authenticated)/settings/_components/SettingsClient', () => ({ SettingsClient: () => null }))
vi.mock('@/app/(authenticated)/settings/_shared/tiles', () => ({
  buildSettingsTileGroups: (flags: Record<string, boolean>) => buildSettingsTileGroups(flags),
}))

import SettingsPage from '@/app/(authenticated)/settings/page'
import { canViewCalendarNotes } from '@/app/actions/calendar-notes'

function grant(eventsView: boolean, settingsManage: boolean) {
  checkUserPermission.mockImplementation(async (module: string, action: string) => {
    if (module === 'events' && action === 'view') return eventsView
    if (module === 'settings' && action === 'manage') return settingsManage
    return false
  })
}

describe('SettingsPage permission checks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks for settings:manage once', async () => {
    grant(true, true)
    await SettingsPage()
    const settingsManageCalls = checkUserPermission.mock.calls.filter(
      ([module, action]) => module === 'settings' && action === 'manage',
    )
    expect(settingsManageCalls).toHaveLength(1)
    expect(checkUserPermission).toHaveBeenCalledWith('events', 'view')
  })

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('shows calendar notes exactly as canViewCalendarNotes would (events:view %s, settings:manage %s)', async (eventsView, settingsManage) => {
    grant(eventsView, settingsManage)
    const expected = await canViewCalendarNotes()

    await SettingsPage()

    expect(buildSettingsTileGroups).toHaveBeenCalledTimes(1)
    expect(buildSettingsTileGroups.mock.calls[0][0].calendarNotesView).toBe(expected)
    expect(expected).toBe(eventsView || settingsManage)
  })
})
