import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/marketing/contacts',
}))

vi.mock('@/app/actions/marketing-contacts', () => ({
  getBusinessContactEngagement: vi.fn(),
  resubscribeBusinessContact: vi.fn(),
  unsubscribeBusinessContact: vi.fn(),
  updateBusinessContact: vi.fn(),
}))

// The dialogs are not under test and reach for server actions of their own.
vi.mock('@/app/(authenticated)/marketing/contacts/EligibilityModal', () => ({ EligibilityModal: () => null }))
vi.mock('@/app/(authenticated)/marketing/contacts/ImportModal', () => ({ ImportModal: () => null }))

import { ContactsClient } from '@/app/(authenticated)/marketing/contacts/ContactsClient'

function renderContacts(canManageSettings: boolean) {
  return render(
    <ContactsClient
      initialContacts={[]}
      initialTotal={0}
      initialPage={1}
      pageSize={50}
      initialFilters={{ search: '', tag: '', cluster: '', eligibility: '', status: '' }}
      tags={[]}
      clusters={[]}
      pendingReviewCount={0}
      canEdit={false}
      canCreate={false}
      canManageSettings={canManageSettings}
    />,
  )
}

afterEach(cleanup)

// The Settings tab only shows with marketing:manage, so the note under the list must not send
// anyone else looking for it.
describe('ContactsClient sending note', () => {
  it('points someone who can open Settings at the Settings tab', () => {
    renderContacts(true)

    expect(screen.getAllByRole('tab', { name: 'Settings' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/Sending is controlled in the Settings tab\./)).toBeInTheDocument()
  })

  it('does not mention a Settings tab to someone who cannot see it', () => {
    renderContacts(false)

    expect(screen.queryByRole('tab', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Settings tab/)).not.toBeInTheDocument()
    expect(screen.getByText(/Sending is controlled by whoever manages marketing settings\./)).toBeInTheDocument()
  })
})
