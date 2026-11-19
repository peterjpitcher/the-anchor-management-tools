import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TextBookersDialog } from '@/app/(authenticated)/events/[id]/TextBookersDialog'
import { previewEventBookerText, sendEventBookerText } from '@/app/actions/event-booker-texts'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, toast }
})

vi.mock('@/app/actions/event-booker-texts', () => ({
  previewEventBookerText: vi.fn(),
  sendEventBookerText: vi.fn(),
}))

const PREVIEW = {
  recipients: [
    { customerId: 'c1', name: 'Tracey Williams', seats: 4, pendingPayment: false },
    { customerId: 'c2', name: 'Leo', seats: 1, pendingPayment: false },
  ],
  excluded: [{ customerId: 'c3', name: 'Katie Fowles', seats: 6, reason: 'Has opted out of texts' }],
}

function renderDialog() {
  render(<TextBookersDialog open eventId="evt-1" eventName="Tasting Night" onClose={vi.fn()} />)
}

async function writeAndSend() {
  const button = await screen.findByRole('button', { name: 'Send to 2 people' })
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Doors at 6.30pm' } })
  fireEvent.click(button)
}

describe('TextBookersDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(previewEventBookerText).mockResolvedValue({ data: PREVIEW })
  })

  it('shows who will be texted and who will not, with the reason', async () => {
    renderDialog()
    expect(await screen.findByText('Will text 2 people')).toBeInTheDocument()
    expect(screen.getByText('Tracey Williams, Leo')).toBeInTheDocument()
    expect(screen.getByText(/Katie Fowles \(6 seats\): Has opted out of texts/)).toBeInTheDocument()
  })

  it('reloads the list when staff include bookings waiting for payment', async () => {
    renderDialog()
    await screen.findByText('Will text 2 people')
    fireEvent.click(screen.getByLabelText('Include bookings waiting for payment'))
    await waitFor(() =>
      expect(previewEventBookerText).toHaveBeenLastCalledWith({ eventId: 'evt-1', includePendingPayment: true })
    )
  })

  it('sends and reports the outcome', async () => {
    vi.mocked(sendEventBookerText).mockResolvedValue({ success: true, sent: 1, held: 1, failed: 0, failures: [] })
    renderDialog()
    await writeAndSend()
    expect(await screen.findByText('1 held by quiet hours, going out from 9am')).toBeInTheDocument()
    expect(sendEventBookerText).toHaveBeenCalledWith({ eventId: 'evt-1', includePendingPayment: false, message: 'Doors at 6.30pm' })
    expect(toast.success).toHaveBeenCalledWith('Texted 2 bookers')
  })

  it('shows the failure when the send is refused', async () => {
    vi.mocked(sendEventBookerText).mockResolvedValue({ success: false, error: 'SMS sending is currently suspended', stoppedEarly: true })
    renderDialog()
    await writeAndSend()
    expect(await screen.findByText('SMS sending is currently suspended')).toBeInTheDocument()
    expect(screen.getByText(/so nobody is texted twice/)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('SMS sending is currently suspended')
  })

  it('shows the failure when the server cannot be reached', async () => {
    vi.mocked(sendEventBookerText).mockRejectedValue(new Error('network'))
    renderDialog()
    await writeAndSend()
    expect(await screen.findByText(/The texts could not be sent/)).toBeInTheDocument()
  })

  it('shows an error and blocks sending when the bookers cannot be loaded', async () => {
    vi.mocked(previewEventBookerText).mockResolvedValue({ error: 'Could not load the bookers for this event. Nothing was sent.' })
    renderDialog()
    expect(await screen.findByText(/Could not load the bookers for this event/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to 0 people' })).toBeDisabled()
  })
})
