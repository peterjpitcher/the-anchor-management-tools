import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TimeOffStep from '@/app/(employee-onboarding)/onboarding/[token]/steps/TimeOffStep'

vi.mock('@/app/actions/employeeInvite', () => ({
  saveOnboardingTimeOff: vi.fn(),
}))

function renderStep() {
  return render(
    <TimeOffStep
      token="invite-token"
      initialAnswer={null}
      initialBlocks={[]}
      initialSubmissionVersion={0}
      onSuccess={vi.fn()}
    />,
  )
}

describe('onboarding time-off step', () => {
  it('heads each set of dates like the other step sections, as a named group', () => {
    renderStep()

    // The same sub-heading as "Primary Contact" or "GP Details", and the group a screen reader
    // announces with each of its fields.
    expect(screen.getByRole('heading', { level: 3, name: 'Dates 1' })).toBeInTheDocument()
    const group = screen.getByRole('group', { name: 'Dates 1' })
    expect(group).toContainElement(screen.getByLabelText(/First day/))
  })

  it('switches the dates off, keeping what was typed, when nothing is booked', () => {
    renderStep()

    const firstDay = screen.getByLabelText(/First day/)
    fireEvent.change(firstDay, { target: { value: '2026-10-05' } })
    expect(firstDay).toBeEnabled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    expect(screen.getByRole('group', { name: 'Dates 1' })).toBeDisabled()
    expect(firstDay).toBeDisabled()
    expect(firstDay).toHaveValue('2026-10-05')

    fireEvent.click(screen.getByRole('checkbox', { name: 'I have nothing booked' }))
    expect(firstDay).toBeEnabled()
    expect(firstDay).toHaveValue('2026-10-05')
  })
})
