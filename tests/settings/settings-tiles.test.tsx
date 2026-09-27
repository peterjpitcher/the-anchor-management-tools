import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  buildSettingsTileGroups,
  type SettingsTilePermissions,
} from '@/app/(authenticated)/settings/_shared/tiles'
import { SettingsClient } from '@/app/(authenticated)/settings/_components/SettingsClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/settings',
}))

vi.mock('@/app/actions/site-settings', () => ({
  updateSiteSettings: vi.fn(),
  updateSiteToggle: vi.fn(),
}))

const NONE: SettingsTilePermissions = {
  settingsView: false,
  settingsManage: false,
  usersView: false,
  rolesView: false,
  eventsManage: false,
  calendarNotesView: false,
  customersView: false,
  messagesView: false,
  messageTemplatesManage: false,
  menuManage: false,
  maintenanceAreas: false,
}

const ALL: SettingsTilePermissions = Object.fromEntries(
  Object.keys(NONE).map((key) => [key, true]),
) as SettingsTilePermissions

function hrefs(permissions: SettingsTilePermissions): string[] {
  return buildSettingsTileGroups(permissions).flatMap((group) => group.tiles.map((tile) => tile.href))
}

// A tile that opens a page the user cannot see is a dead end. Before 26 Sep 2026 six of the
// eight tiles sent a settings:view-only user to /unauthorized, and nine settings pages had no tile.
describe('the settings tiles', () => {
  it('shows a settings:view-only user only the pages they can open', () => {
    expect(hrefs({ ...NONE, settingsView: true })).toEqual([
      '/profile',
      '/settings/api-keys',
      '/settings/design-system',
    ])
  })

  it('hides every settings:manage page from someone without it', () => {
    const shown = hrefs({ ...ALL, settingsManage: false })
    for (const href of [
      '/settings/rota',
      '/settings/pay-bands',
      '/settings/budgets',
      '/settings/categories',
      '/settings/business-hours',
      '/settings/table-bookings',
      '/settings/sms-failures',
      '/settings/audit-logs',
      '/settings/background-jobs',
      '/settings/gdpr',
    ]) {
      expect(shown).not.toContain(href)
    }
  })

  it('lists every settings page, plus Users, Roles and My Profile, for somebody who can open them all', () => {
    expect(hrefs(ALL).sort()).toEqual(
      [
        '/users',
        '/roles',
        '/profile',
        '/settings/rota',
        '/settings/pay-bands',
        '/settings/budgets',
        '/settings/categories',
        '/settings/business-hours',
        '/settings/table-bookings',
        '/settings/event-categories',
        '/settings/calendar-notes',
        '/settings/customer-labels',
        '/settings/message-templates',
        '/settings/import-messages',
        '/settings/sms-failures',
        '/settings/menu-target',
        '/settings/api-keys',
        '/settings/audit-logs',
        '/settings/background-jobs',
        '/settings/gdpr',
        '/settings/maintenance',
        '/settings/design-system',
      ].sort(),
    )
  })

  it('points every tile at a page that exists', () => {
    for (const href of hrefs(ALL)) {
      const page = join(process.cwd(), 'src/app/(authenticated)', href, 'page.tsx')
      expect(existsSync(page), `${href} has no page.tsx`).toBe(true)
    }
  })

  it('drops a group with nothing in it', () => {
    const groups = buildSettingsTileGroups({ ...NONE, menuManage: false })
    expect(groups.map((group) => group.title)).not.toContain('Finance')
  })
})

describe('the settings page', () => {
  it('renders the tiles it is given and no in-page tab switcher', () => {
    render(
      <SettingsClient
        tileGroups={buildSettingsTileGroups({ ...NONE, settingsView: true })}
        canManageSettings={false}
        siteSettings={null}
      />,
    )

    expect(screen.getAllByRole('heading', { name: 'Settings', level: 1 }).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /API Keys/ })).toHaveAttribute('href', '/settings/api-keys')
    expect(screen.getByRole('link', { name: /My Profile/ })).toHaveAttribute('href', '/profile')
    expect(screen.queryByRole('link', { name: /Audit Logs/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    // Site settings that failed to load are an error, not an empty state.
    expect(screen.getByText('Could not load site settings.')).toBeInTheDocument()
  })
})
