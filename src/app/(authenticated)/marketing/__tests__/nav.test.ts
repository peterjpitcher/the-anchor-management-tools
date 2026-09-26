import { describe, expect, it } from 'vitest'

import { MARKETING_BACK, marketingLayout, marketingNavItems } from '../_shared/nav'

describe('Marketing tab row', () => {
  it('shows Settings only to someone who can open it (marketing:manage)', () => {
    expect(marketingNavItems({ canManageSettings: true }).map((item) => item.label)).toEqual([
      'Campaigns',
      'Contacts',
      'Settings',
    ])
    expect(marketingNavItems({ canManageSettings: false }).map((item) => item.label)).toEqual([
      'Campaigns',
      'Contacts',
    ])
  })

  it('gives every tab the section title and the same filtered tabs', () => {
    const permissions = { canManageSettings: false }
    const campaigns = marketingLayout('campaigns', permissions)
    const contacts = marketingLayout('contacts', permissions)

    expect(campaigns.title).toBe('Marketing')
    expect(contacts.title).toBe('Marketing')
    expect(contacts.navItems).toEqual(campaigns.navItems)
  })

  it('labels the back button on a campaign with the parent page title', () => {
    expect(MARKETING_BACK).toEqual({ label: 'Back to Marketing', href: '/marketing' })
  })
})
