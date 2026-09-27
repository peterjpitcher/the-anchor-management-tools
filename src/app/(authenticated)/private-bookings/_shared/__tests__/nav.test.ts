import { describe, expect, it } from 'vitest'
import {
  PB_SETTINGS_NAV,
  PB_SETTINGS_TITLE,
  canOpenPrivateBookingSettings,
  privateBookingSettingsNav,
  privateBookingsNav,
} from '../nav'

const labels = (items: { label: string }[]): string[] => items.map((item) => item.label)

describe('private bookings tab rows', () => {
  it('hides the SMS Queue and Reports tabs from people who cannot open them', () => {
    expect(labels(privateBookingsNav({ canViewSmsQueue: false, canViewReports: false }))).toEqual([
      'Bookings',
      'Calendar',
      'Settings',
    ])
    expect(labels(privateBookingsNav({ canViewSmsQueue: true, canViewReports: true }))).toEqual([
      'Bookings',
      'Calendar',
      'SMS Queue',
      'Reports',
      'Settings',
    ])
  })

  it('shows every settings tab to a manager', () => {
    expect(privateBookingSettingsNav(new Set(['view', 'manage']))).toEqual(PB_SETTINGS_NAV)
  })

  it('has no General tab', () => {
    expect(labels(PB_SETTINGS_NAV)).toEqual(['Catering', 'Vendors', 'Spaces'])
  })

  it('shows only the settings tabs whose page this person can open', () => {
    // Catering, Vendors and Spaces each send you to /unauthorized without their own action.
    expect(labels(privateBookingSettingsNav(new Set(['view'])))).toEqual([])
    expect(labels(privateBookingSettingsNav(new Set(['view', 'manage_vendors'])))).toEqual(['Vendors'])
    expect(
      labels(privateBookingSettingsNav(new Set(['view', 'manage_catering', 'manage_spaces']))),
    ).toEqual(['Catering', 'Spaces'])
    expect(labels(privateBookingSettingsNav(new Set(['manage_catering'])))).toEqual(['Catering'])
  })

  it('hides the Settings tab from people who cannot open any settings tab', () => {
    expect(canOpenPrivateBookingSettings(new Set(['view']))).toBe(false)
    expect(canOpenPrivateBookingSettings(new Set(['view', 'manage_spaces']))).toBe(true)
    expect(labels(privateBookingsNav({ canOpenSettings: false }))).not.toContain('Settings')
    expect(labels(privateBookingsNav({ canOpenSettings: true }))).toContain('Settings')
  })

  it('titles every settings tab with the sub-area name', () => {
    expect(PB_SETTINGS_TITLE).toBe('Private Bookings Settings')
  })
})
