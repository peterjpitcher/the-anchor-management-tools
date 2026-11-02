// The employee signing tab: what staff are told after sending a document.
//
// Every failed link email showed an error toast telling staff to use "Send new link", even when
// the email may have reached the person. A new link cancels the one they may already hold, so an
// email we did not hear back about is a warning that says to check with them first.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartyDelivery } from '@/lib/signing/service'

const mocks = vi.hoisted(() => ({
  sendStaff: vi.fn(),
  sendAgreement: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/employees/e1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/app/actions/signing-staff', () => ({
  sendEmploymentAgreement: mocks.sendAgreement,
  sendStaffTemplateDocument: mocks.sendStaff,
}))
// The panel's own actions are tested with it; here it only has to show the send menu.
vi.mock('@/components/features/signing/SignaturePanel', () => ({
  SignaturePanel: ({ sendActions }: { sendActions?: React.ReactNode }) => <div>{sendActions}</div>,
}))
vi.mock('@/ds', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ds')>()
  return { ...original, toast: mocks.toast }
})

import { EmployeeSigningTab } from '@/components/features/signing/EmployeeSigningTab'

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList)
})

beforeEach(() => {
  vi.clearAllMocks()
})

function sentWith(delivery: Partial<PartyDelivery>): void {
  mocks.sendStaff.mockResolvedValue({
    success: true,
    data: {
      documentId: 'doc-1',
      deliveries: [{ partyId: 'p1', name: 'Sam Example', email: 'sam@example.com', email_status: 'sent', ...delivery }],
    },
  })
}

async function sendOptOut(): Promise<void> {
  const user = userEvent.setup()
  render(<EmployeeSigningTab employeeId="e1" isUnder18={false} hasEmail documents={[]} canSend />)
  await user.click(screen.getByRole('button', { name: 'Send for Signature' }))
  await user.click(await screen.findByText('48-Hour Week Opt-Out'))
  await user.click(await screen.findByRole('button', { name: 'Send Opt-Out' }))
  await waitFor(() => expect(mocks.sendStaff).toHaveBeenCalledWith({ kind: 'working_time_opt_out', employeeId: 'e1' }))
}

describe('after sending a staff document', () => {
  it('says it was sent when the email went', async () => {
    sentWith({})
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Sent for signature.'))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('warns that an email we did not hear back about may have reached them', async () => {
    sentWith({ email_status: 'failed', error: 'Request timed out', uncertain: true })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      '48-Hour Week Opt-Out created, but we could not confirm the email to Sam Example went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('calls it not sent only when the provider definitely refused it', async () => {
    sentWith({ email_status: 'failed', error: 'mailbox unavailable', uncertain: false })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      '48-Hour Week Opt-Out created, but the email to Sam Example was not sent. Use "Send New Link" or "Sign in Person".',
    ))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
  })

  it('says when email is switched off', async () => {
    sentWith({ email_status: 'failed', error: 'Email sending is currently suspended', code: 'email_suspended', uncertain: false })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      '48-Hour Week Opt-Out created, but email is switched off, so no link was emailed to Sam Example. Use "Sign in Person".',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('says to check the address, not to send a new link, when it has bounced before', async () => {
    sentWith({ email_status: 'failed', error: 'Recipient is on the suppression list', code: 'recipient_suppressed', uncertain: false })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(
      '48-Hour Week Opt-Out created, but the email to Sam Example was not sent because their address has bounced before. Check the address on their record, or use "Sign in Person".',
    ))
    expect(JSON.stringify(mocks.toast.error.mock.calls)).not.toContain('Send New Link')
    expect(mocks.toast.warning).not.toHaveBeenCalled()
  })

  it('names each signer under what happened to their email', async () => {
    mocks.sendStaff.mockResolvedValue({
      success: true,
      data: {
        documentId: 'doc-1',
        deliveries: [
          { partyId: 'p1', name: 'Sam Example', email: 'sam@example.com', email_status: 'failed', uncertain: true },
          { partyId: 'p2', name: 'Pat Example', email: 'pat@example.com', email_status: 'failed', uncertain: false },
        ],
      },
    })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      '48-Hour Week Opt-Out created, but we could not confirm the email to Sam Example went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).toHaveBeenCalledWith('48-Hour Week Opt-Out created, but the email to Pat Example was not sent. Use "Send New Link" or "Sign in Person".')
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('never shows the provider text', async () => {
    sentWith({ email_status: 'failed', error: '550 5.1.1 mailbox unavailable', uncertain: false })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())
    expect(JSON.stringify(mocks.toast.error.mock.calls)).not.toContain('550')
  })

  it('tells them to sign in person when there is no email address', async () => {
    sentWith({ email: null, email_status: 'none' })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Created. There is no email address, so use "Sign in Person".'))
  })
})

// The tab's toasts read 'Created, but ...' while every other signing panel names the document,
// so staff could not tell from the toast which document it was about.
describe('naming the document in a failed-email toast', () => {
  it('names the document that was sent, as the send menu does', async () => {
    mocks.sendAgreement.mockResolvedValue({
      success: true,
      data: {
        documentId: 'doc-2',
        deliveries: [{ partyId: 'p1', name: 'Sam Example', email: 'sam@example.com', email_status: 'failed', uncertain: true }],
      },
    })
    const user = userEvent.setup()
    render(<EmployeeSigningTab employeeId="e1" isUnder18={false} hasEmail documents={[]} canSend />)
    await user.click(screen.getByRole('button', { name: 'Send for Signature' }))
    await user.click(await screen.findByText('Worker Agreement'))
    await user.click(await screen.findByRole('button', { name: 'Send Agreement' }))
    await waitFor(() => expect(mocks.sendAgreement).toHaveBeenCalledWith({ employeeId: 'e1' }))

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Worker Agreement created, but we could not confirm the email to Sam Example went. It may have reached them, so check with them before sending a new link.',
    ))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})

// A send that stopped after its request may have been created showed a danger alert in the open
// dialog, next to the Send button, which invites a second request and a second email.
describe('a send that stopped after the request may have been created', () => {
  it('warns, closes the dialog and does not offer to send again on the spot', async () => {
    const message = 'The request may have been created and the email may have gone. Check the Signing tab before sending again.'
    mocks.sendStaff.mockResolvedValue({ error: message, mayHaveGone: true })
    await sendOptOut()

    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(message))
    expect(mocks.toast.error).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Send Opt-Out' })).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps an ordinary refusal in the dialog, to fix and send', async () => {
    mocks.sendStaff.mockResolvedValue({ error: 'A worker under 18 cannot opt out of the working time limits.' })
    await sendOptOut()

    expect(await screen.findByRole('alert')).toHaveTextContent('A worker under 18 cannot opt out of the working time limits.')
    expect(screen.getByRole('button', { name: 'Send Opt-Out' })).toBeInTheDocument()
    expect(mocks.toast.warning).not.toHaveBeenCalled()
  })
})
