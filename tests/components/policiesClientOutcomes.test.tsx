// The policies page: what the bulk button says and does, and how a send is reported.
//
// FF-55: the dialog said everyone would be emailed a link, including people with no email address;
// the button said "Send to the N Who Have Not Confirmed" while leaving out people with a link
// already waiting; and people with no email address were reported as sent.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/policies',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/signing-staff', () => ({ sendPolicyAcknowledgements: sendMock }))
vi.mock('@/ds', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ds')>()
  return { ...original, toast: toastMock }
})

import PoliciesClient from '@/app/(authenticated)/employees/policies/PoliciesClient'
import type { PolicyOverview, PolicyStaffRow } from '@/app/actions/signing-staff'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
})

function person(id: string, name: string, state: PolicyStaffRow['state'], email: string | null): PolicyStaffRow {
  return { employeeId: id, name, email, state, documentId: null, at: null, confirmedVersion: null }
}

const overview: PolicyOverview = {
  slug: 'allergens',
  title: 'Allergens policy',
  version: 2,
  isActive: true,
  staff: [
    person('e1', 'Mandy (Amanda Smith)', 'not_sent', 'mandy@example.com'),
    person('e2', 'Alex Unknown', 'not_sent', null),
    person('e3', 'Jo Rowe', 'waiting', 'jo@example.com'),
    person('e4', 'Sam Rowe', 'confirmed', 'sam@example.com'),
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

function renderPage() {
  render(<PoliciesClient templates={[{ slug: 'allergens', title: 'Allergens policy', version: 2, isActive: true }]} overview={overview} loadError={null} canSend />)
}

describe('the bulk send on the policies page', () => {
  it('names who it sends to, and the dialog says who is emailed, who signs in person and who is left out', async () => {
    const user = userEvent.setup()
    renderPage()

    const button = screen.getByRole('button', { name: 'Send to the 2 With No Link Waiting' })
    await user.click(button)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/1 person will be emailed a link to read and confirm "Allergens policy"\./)).toBeInTheDocument()
    expect(within(dialog).getByText(/1 person has no email address, so nothing is emailed: they read and confirm it in person\./)).toBeInTheDocument()
    expect(within(dialog).getByText(/1 person already has a link waiting and is left out/)).toBeInTheDocument()
  })

  it('reports people with no email address apart from those emailed', async () => {
    const user = userEvent.setup()
    sendMock.mockResolvedValue({ success: true, data: { sent: 1, signInPerson: [{ name: 'Alex Unknown' }], failed: [] } })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Send to the 2 With No Link Waiting' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled())
    expect(sendMock).toHaveBeenCalledWith({ slug: 'allergens', employeeIds: ['e1', 'e2'] })
    expect(toastMock.success).toHaveBeenCalledWith('Emailed to 1 person. No email address, so to confirm in person: Alex Unknown.')
  })
})
