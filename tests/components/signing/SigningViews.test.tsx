import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SigningGuestView } from '@/components/features/guest/signing/SigningGuestView'
import { SigningStaffView } from '@/components/features/signing/SigningStaffView'
import type { SigningViewModel } from '@/components/features/signing/useSigningFlow'

const AGREED = 'I have read "Worker agreement" and I agree to it. I understand that typing my name here has the same effect as signing it by hand.'

function model(overrides: Partial<SigningViewModel> = {}): SigningViewModel {
  return {
    brand: 'staff',
    mode: 'sign',
    title: 'Worker agreement',
    summary: 'Your agreement with The Anchor.',
    senderName: 'Orange Jelly Limited',
    recipientName: 'Sam Example',
    agreedText: AGREED,
    initialPhase: 'form',
    blockedMessage: null,
    documentViewed: false,
    expiresOn: '11 November 2026',
    inPerson: false,
    isPortal: false,
    otherSigners: [],
    alsoToSign: [],
    endpoints: {
      document: '/api/sign/tok/document',
      identity: '/api/sign/tok/identity',
      sign: '/api/sign/tok/sign',
      decline: '/api/sign/tok/decline',
    },
    ...overrides,
  }
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each([
  ['staff', SigningStaffView],
  ['guest', SigningGuestView],
] as const)('the signing screen in the %s look', (brand, View) => {
  it('keeps the name and tick box locked until the document has been opened', async () => {
    const user = userEvent.setup()
    render(<View model={model({ brand })} />)

    const name = screen.getByLabelText(/type your full name/i)
    const tick = screen.getByRole('checkbox')
    expect(name).toBeDisabled()
    expect(tick).toBeDisabled()
    expect(screen.getByText(/open the document first/i)).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /open the document/i })
    expect(link).toHaveAttribute('href', '/api/sign/tok/document')
    // jsdom does not follow links; the click is what unlocks the form.
    link.addEventListener('click', (event) => event.preventDefault())
    await user.click(link)

    expect(name).toBeEnabled()
    expect(tick).toBeEnabled()
    expect(screen.queryByText(/open the document first/i)).not.toBeInTheDocument()
  })

  it('does not unlock on a click beside the link', async () => {
    const user = userEvent.setup()
    render(<View model={model({ brand })} />)
    // The wrapper is as wide as the card. A click on it, off the link, is not opening the document.
    const wrapper = screen.getByRole('link', { name: /open the document/i }).parentElement as HTMLElement
    await user.click(wrapper)
    expect(screen.getByLabelText(/type your full name/i)).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it('will not submit without a name and a tick, then sends exactly the words shown', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(respond(201, { success: true, signed: true, completed: true }))
    render(<View model={model({ brand, documentViewed: true })} />)

    await user.click(screen.getByRole('button', { name: /^sign document$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/type your full name/i)
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/type your full name/i), '  Sam Example ')
    await user.click(screen.getByRole('button', { name: /^sign document$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/tick the box/i)
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign document$/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sign/tok/sign')
    expect(JSON.parse(init.body as string)).toEqual({ typed_name: 'Sam Example', agreed: true, agreed_text: AGREED })
    expect(await screen.findByText(/signed, thank you/i)).toBeInTheDocument()
    expect(screen.getByText(/on its way to you by email/i)).toBeInTheDocument()
  })

  it('shows our error and keeps the form when the signature was not saved', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(respond(500, { success: false, error: { code: 'SERVER_ERROR', message: 'Sorry, something went wrong on our side and this was not saved.' } }))
    render(<View model={model({ brand, documentViewed: true })} />)

    await user.type(screen.getByLabelText(/type your full name/i), 'Sam Example')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign document$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/was not saved/i)
    expect(screen.queryByText(/signed, thank you/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/type your full name/i)).toHaveValue('Sam Example')
  })

  it('never claims success when the network fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<View model={model({ brand, documentViewed: true })} />)

    await user.type(screen.getByLabelText(/type your full name/i), 'Sam Example')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign document$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not go through/i)
    expect(screen.queryByText(/signed, thank you/i)).not.toBeInTheDocument()
  })

  it('lets them decline, with a reason', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(respond(201, { success: true, declined: true }))
    render(<View model={model({ brand })} />)

    await user.click(screen.getByRole('button', { name: /i do not want to sign this/i }))
    await user.type(screen.getByLabelText(/reason/i), 'The start date is wrong')
    await user.click(screen.getByRole('button', { name: 'Decline' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sign/tok/decline')
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'The start date is wrong' })
    expect(await screen.findByText(/nothing has been signed/i)).toBeInTheDocument()
  })

  it('asks a new starter for their date of birth before showing anything else', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(respond(403, { success: false, error: { code: 'IDENTITY_CHECK_FAILED', message: 'That does not match our records. You have 4 tries left.' } }))
      .mockResolvedValueOnce(respond(200, { success: true, verified: true }))
    render(<View model={model({ brand, initialPhase: 'identity' })} />)

    expect(screen.queryByRole('link', { name: /open the document/i })).not.toBeInTheDocument()
    const dob = screen.getByLabelText(/date of birth/i)
    fireEvent.change(dob, { target: { value: '1999-01-01' } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/4 tries left/i)

    fireEvent.change(dob, { target: { value: '2000-03-14' } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('link', { name: /open the document/i })).toBeInTheDocument()
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ date_of_birth: '2000-03-14' })
  })

  it('shows why there is nothing to sign, and no form', () => {
    render(<View model={model({ brand, initialPhase: 'blocked', blockedMessage: 'This document has been withdrawn. There is nothing for you to sign.' })} />)
    expect(screen.getByText(/has been withdrawn/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign document$/i })).not.toBeInTheDocument()
  })

  it('says there is a second document to sign, before signing and once this one is signed', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(respond(201, { success: true, signed: true, completed: true }))
    render(<View model={model({ brand, documentViewed: true, alsoToSign: ['Self-catering agreement'] })} />)
    // Each document is signed on its own, so the screen never lets one signature pass for both.
    expect(screen.getByText(/you also have "Self-catering agreement" to sign\. It is signed separately/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/type your full name/i), 'Sam Example')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign document$/i }))
    expect(await screen.findByText(/you also have "Self-catering agreement" to sign/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sign document$/i })).not.toBeInTheDocument()
  })

  it('says nothing about other documents when there are none', () => {
    render(<View model={model({ brand, documentViewed: true })} />)
    expect(screen.queryByText(/you also have/i)).not.toBeInTheDocument()
  })

  it('uses confirm wording for a policy, and names the other signers', () => {
    render(
      <View
        model={model({
          brand,
          mode: 'acknowledge',
          documentViewed: true,
          agreedText: 'I confirm that I have read and understood "Allergens policy".',
          otherSigners: [{ name: 'Pat Young', roleLabel: 'Parent or guardian', signed: true }],
        })}
      />
    )
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /read and understood "Allergens policy"/i })).toBeInTheDocument()
    expect(screen.getByText(/Pat Young \(Parent or guardian, signed\)/)).toBeInTheDocument()
  })
})

describe('the signing screen in the staff portal', () => {
  it('does not talk about a personal link', () => {
    render(<SigningStaffView model={model({ isPortal: true, endpoints: { document: '/d', sign: '/s', decline: '/x' } })} />)
    expect(screen.getByText(/please respond by 11 November 2026/i)).toBeInTheDocument()
    expect(screen.queryByText(/this link is personal/i)).not.toBeInTheDocument()
  })

  it('does not promise a month to someone signing in person', () => {
    render(<SigningStaffView model={model({ inPerson: true })} />)
    expect(screen.getByText(/works for 30 minutes/i)).toBeInTheDocument()
    expect(screen.queryByText(/this link is personal/i)).not.toBeInTheDocument()
  })

  it('tells someone signing on a handed-over device to hand it back', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(respond(201, { success: true, signed: true, completed: false }))
    render(<SigningStaffView model={model({ documentViewed: true, inPerson: true })} />)
    await user.type(screen.getByLabelText(/type your full name/i), 'Sam Example')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign document$/i }))
    expect(await screen.findByText(/hand the device back/i)).toBeInTheDocument()
  })
})
