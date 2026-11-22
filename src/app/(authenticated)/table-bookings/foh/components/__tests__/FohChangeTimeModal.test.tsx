import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FohChangeTimeModal } from '../FohChangeTimeModal'
import type { TimeSlotOption } from '../../utils'

function slot(time: string, overrides: Partial<TimeSlotOption> = {}): TimeSlotOption {
  const [hours, minutes] = time.split(':').map(Number)
  return {
    minutes: hours! * 60 + minutes!,
    time,
    available: true,
    blockedBy: null,
    isCurrent: false,
    ...overrides,
  }
}

const OPTIONS: TimeSlotOption[] = [
  slot('17:30'),
  slot('17:45'),
  slot('18:00', { isCurrent: true, available: false }),
  slot('18:15'),
  slot('18:30', { available: false, blockedBy: 'taken' }),
  slot('19:00', { available: false, blockedBy: 'private' }),
]

function renderModal(overrides: Partial<React.ComponentProps<typeof FohChangeTimeModal>> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <FohChangeTimeModal
      open
      bookingLabel="Smith"
      currentTime="18:00"
      isSeated={false}
      options={OPTIONS}
      submitting={false}
      error={null}
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onConfirm, onClose }
}

describe('FohChangeTimeModal', () => {
  it('shows who is being moved and when they are currently booked', () => {
    renderModal()
    expect(screen.getByText('Smith')).toBeInTheDocument()
    // The heading states the current time, and the grid separately marks that tile as current.
    expect(screen.getByText(/currently booked for/i)).toHaveTextContent('6pm')
    expect(screen.getByRole('button', { name: /6pm, current booking time/i })).toBeInTheDocument()
  })

  it('always warns that the guest will be told', () => {
    renderModal()
    expect(screen.getByText(/guest is told about every time change/i)).toBeInTheDocument()
  })

  it('warns harder when the party is already seated', () => {
    renderModal({ isSeated: true })
    expect(screen.getByText(/already seated/i)).toBeInTheDocument()
    expect(screen.getByText(/free their table for the old time/i)).toBeInTheDocument()
  })

  it('marks the current time and refuses to submit it', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()

    const current = screen.getByRole('button', { name: /6pm, current booking time/i })
    expect(current).toBeDisabled()
    await user.click(current)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables a blocked slot and names the reason for assistive technology', () => {
    renderModal()
    const taken = screen.getByRole('button', { name: /6:30pm, unavailable, taken/i })
    expect(taken).toBeDisabled()
    const priv = screen.getByRole('button', { name: /7pm, unavailable, private/i })
    expect(priv).toBeDisabled()
  })

  it('needs an explicit confirm after picking, because the guest gets a message', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()

    // Nothing chosen yet, so there is nothing to confirm.
    expect(screen.getByRole('button', { name: /change time/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '6:15pm' }))
    // Picking a slot does not send anything on its own.
    expect(onConfirm).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: /change to 6:15pm/i })
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('18:15')
  })

  it('offers quick nudges either side of the current time', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderModal()

    await user.click(screen.getByRole('button', { name: /15 minutes earlier, 5:45pm/i }))
    await user.click(screen.getByRole('button', { name: /change to 5:45pm/i }))
    expect(onConfirm).toHaveBeenCalledWith('17:45')
  })

  it('disables a nudge that lands on a blocked time rather than hiding it', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /30 minutes later, 6:30pm, unavailable/i })).toBeDisabled()
  })

  it('shows a refusal inside the modal, where staff are looking', () => {
    renderModal({ error: 'Selected time conflicts with another booking or private block.' })
    expect(screen.getByRole('alert')).toHaveTextContent(/conflicts with another booking/i)
  })

  it('locks every control while the change is in flight', async () => {
    const user = userEvent.setup()
    renderModal({ submitting: true })
    expect(screen.getByRole('button', { name: /changing/i })).toBeDisabled()
    const slot1815 = screen.getByRole('button', { name: '6:15pm' })
    expect(slot1815).toBeDisabled()
    await user.click(slot1815)
    expect(screen.getByRole('button', { name: /changing/i })).toBeDisabled()
  })

  it('says so plainly when there is nowhere to move to', () => {
    renderModal({ options: [] })
    expect(screen.getByText(/no other time is available/i)).toBeInTheDocument()
  })
})
