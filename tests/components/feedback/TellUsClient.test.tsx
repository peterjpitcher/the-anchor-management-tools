import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TellUsClient } from '@/app/(feedback)/feedback/tell-us/TellUsClient'

/**
 * The redesign is styling only, so these tests pin behaviour and the accessible
 * surface rather than appearance: the honeypot, the disclosure wiring, the
 * validation rules and the alert role on inline errors.
 */
describe('TellUsClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function renderForm(): void {
    render(<TellUsClient src={null} />)
  }

  it('renders the intro copy verbatim under a single h1', () => {
    renderForm()

    expect(screen.getByText('The Anchor')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: "We're sorry it wasn't quite right" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('never renders a second <main>: the shell owns the only one', () => {
    const { container } = render(<TellUsClient src={null} />)
    expect(container.querySelector('main')).toBeNull()
  })

  it('keeps the off-screen honeypot hidden from assistive tech but present', () => {
    const { container } = render(<TellUsClient src={null} />)
    const honeypot = container.querySelector('#company')

    expect(honeypot).not.toBeNull()
    expect(honeypot).toHaveAttribute('tabindex', '-1')
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull()
    // aria-hidden takes it out of the accessibility tree, so no screen reader
    // offers it, while the field is still posted with the form.
    expect(screen.queryByRole('textbox', { name: 'Company' })).toBeNull()
  })

  it('keeps the sr-only label on the comments box', () => {
    renderForm()
    const comments = screen.getByLabelText('Tell us what happened')

    expect(comments.tagName).toBe('TEXTAREA')
    expect(comments).toHaveAttribute('rows', '5')
  })

  it('wires the contact disclosure with aria-expanded and aria-controls', async () => {
    const user = userEvent.setup()
    renderForm()

    const toggle = screen.getByRole('button', {
      name: "Add your contact details if you'd like us to follow up",
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'contact-details')
    expect(screen.queryByLabelText('Name')).toBeNull()

    await user.click(toggle)

    expect(screen.getByRole('button', { name: 'Hide contact details' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Phone')).toBeInTheDocument()
    expect(
      screen.getByLabelText(
        "Leave your details only if you're happy for us to contact you about your feedback."
      )
    ).toHaveAttribute('type', 'checkbox')
  })

  it('disables the submit until a rating is chosen', async () => {
    const user = userEvent.setup()
    renderForm()

    const submit = screen.getByRole('button', { name: 'Send feedback' })
    expect(submit).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '4 stars' }))
    expect(submit).toBeEnabled()
  })

  it('reports an invalid email in a role="alert" banner and does not post', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderForm()

    await user.click(screen.getByRole('button', { name: '2 stars' }))
    await user.click(
      screen.getByRole('button', { name: "Add your contact details if you'd like us to follow up" })
    )
    // `sam@anchor` is valid to the browser's own `type="email"` check, which
    // would otherwise block submission before EMAIL_PATTERN ever runs, but it
    // has no dot in the domain so the app's stricter pattern rejects it.
    await user.type(screen.getByLabelText('Email'), 'sam@anchor')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a valid email address.'
    )
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('requires consent when contact details are given', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderForm()

    await user.click(screen.getByRole('button', { name: '1 star' }))
    await user.click(
      screen.getByRole('button', { name: "Add your contact details if you'd like us to follow up" })
    )
    await user.type(screen.getByLabelText('Name'), 'Sam')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tick the box so we can contact you, or clear your details.'
    )
    expect(fetchMock).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('posts with an idempotency key and the source when the form is valid', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    render(<TellUsClient src="sms" />)

    await user.click(screen.getByRole('button', { name: '5 stars' }))
    await user.type(screen.getByLabelText('Tell us what happened'), 'The wait was long.')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/feedback')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/)
    expect(JSON.parse(init.body as string)).toMatchObject({
      rating: 5,
      comments: 'The wait was long.',
      contactConsent: false,
      src: 'sms',
    })

    vi.unstubAllGlobals()
  })
})
